const http = require('http');

// `renderer:run-collection-folder` is registered via `ipcMain.handle` inside `registerNetworkIpc`,
// so it's only reachable by capturing the callback electron would normally receive.
const mockHandlers = {};
jest.mock('electron', () => ({
  ipcMain: {
    handle: (channel, fn) => {
      mockHandlers[channel] = fn;
    }
  }
}));

// gRPC/WS registration isn't exercised by an HTTP runner test, and both modules
// require('electron').app, which the minimal mock above doesn't provide.
jest.mock('../../src/ipc/network/grpc-event-handlers', () => jest.fn());
jest.mock('../../src/ipc/network/ws-event-handlers', () => ({ registerWsEventHandlers: jest.fn() }));

const registerAllNetworkIpc = require('../../src/ipc/network/index');

describe('runner: variable flow across requests (Improvement.md B1/B2)', () => {
  let server;
  let baseUrl;
  let receivedTokenHeader;
  let mainWindow;
  let sentEvents;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/set-token') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ token: 'abc123' }));
        return;
      }
      if (req.url === '/echo-token') {
        receivedTokenHeader = req.headers['x-token'] || null;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    receivedTokenHeader = null;
    sentEvents = [];
    mainWindow = { webContents: { send: (channel, payload) => sentEvents.push({ channel, payload }) } };
    registerAllNetworkIpc(mainWindow);
  });

  const runFolder = (folder, collection, environment, datasetRows = null, datasetInfo = null) => {
    const handler = mockHandlers['renderer:run-collection-folder'];
    return handler(
      {},
      folder,
      collection,
      environment,
      {},
      false, // recursive
      0, // delay
      null, // tags
      null, // selectedRequestUids
      datasetRows,
      datasetInfo
    );
  };

  const buildCollection = () => ({
    uid: 'collection-uid',
    pathname: '/tmp/bruno-runner-test-collection',
    root: {},
    globalEnvironmentVariables: {},
    brunoConfig: {}
  });

  const buildEnvironment = () => ({
    name: 'Test Env',
    variables: [{ name: 'token', value: '', type: 'text', enabled: true }]
  });

  const buildTwoRequestFolder = () => ({
    uid: 'folder-uid',
    items: [
      {
        uid: 'req-1-set-token',
        name: 'Set token',
        seq: 1,
        type: 'http-request',
        request: {
          method: 'GET',
          url: `${baseUrl}/set-token`,
          headers: [],
          params: [],
          body: { mode: 'none' },
          auth: { mode: 'none' },
          script: { res: 'bru.setEnvVar(\'token\', res.getBody().token);' }
        }
      },
      {
        uid: 'req-2-echo-token',
        name: 'Echo token',
        seq: 2,
        type: 'http-request',
        request: {
          method: 'GET',
          url: `${baseUrl}/echo-token`,
          headers: [{ name: 'X-Token', value: '{{token}}', enabled: true }],
          params: [],
          body: { mode: 'none' },
          auth: { mode: 'none' }
        }
      }
    ]
  });

  it('persists a variable set by request 1\'s post-response script into request 2\'s interpolation (B1)', async () => {
    await runFolder(buildTwoRequestFolder(), buildCollection(), buildEnvironment());

    expect(receivedTokenHeader).toBe('abc123');
  });

  it('does not leak dataset row columns into the environment-update event (B2)', async () => {
    const folder = buildTwoRequestFolder();
    // Give request 1 an env var name that collides with a dataset column, so a leak
    // would be observable: if dataset columns got merged into envVars, `secret`
    // would show up in the environment-update payload alongside `token`.
    const datasetRows = [{ secret: 'from-dataset-should-not-leak-into-env' }];

    await runFolder(folder, buildCollection(), buildEnvironment(), datasetRows, {
      fileName: 'dataset.csv',
      columns: ['secret']
    });

    const envUpdateEvents = sentEvents.filter((e) => e.channel === 'main:script-environment-update');
    expect(envUpdateEvents.length).toBeGreaterThan(0);
    for (const event of envUpdateEvents) {
      expect(event.payload.envVariables).not.toHaveProperty('secret');
    }
  });

  it('carries an env var set in one dataset iteration forward into the next iteration (regression guard for B1)', async () => {
    // A single request whose pre-request script increments a counter stored in
    // envVars, then sends the current value as a header (interpolated after the
    // pre-request script runs). If envVars were reset -- or cloned from the
    // original environment -- at the start of each dataset iteration (the
    // original B1 bug), every iteration would see the counter start over, and
    // the outgoing header would read '1' every time instead of incrementing.
    const folder = {
      uid: 'folder-uid',
      items: [
        {
          uid: 'req-counter',
          name: 'Counter',
          seq: 1,
          type: 'http-request',
          request: {
            method: 'GET',
            url: `${baseUrl}/echo-token`,
            headers: [{ name: 'X-Counter', value: '{{counter}}', enabled: true }],
            params: [],
            body: { mode: 'none' },
            auth: { mode: 'none' },
            script: { req: 'bru.setEnvVar(\'counter\', (Number(bru.getEnvVar(\'counter\')) || 0) + 1);' }
          }
        }
      ]
    };
    const datasetRows = [{ iteration: '1' }, { iteration: '2' }];

    await runFolder(folder, buildCollection(), buildEnvironment(), datasetRows, {
      fileName: 'dataset.csv',
      columns: ['iteration']
    });

    const counterHeaders = sentEvents
      .filter((e) => e.channel === 'main:run-folder-event' && e.payload.type === 'request-sent')
      .map((e) => e.payload.requestSent.headers['X-Counter']);

    expect(counterHeaders).toEqual(['1', '2']);
  });
});
