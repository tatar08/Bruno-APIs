/**
 * HTTP-level contract/integration tests for the Bridge's Express app
 * (Improvement.md P1.6 step 5 — Express 5 migration).
 *
 * The rest of this package's tests exercise individual modules directly and
 * never construct a real Express app, so they can't catch route-wiring
 * regressions like Express 5's stricter path-to-regexp syntax (e.g. the bare
 * `/*` wildcard used for the SPA fallback, which Express 5 rejects outright
 * unless named — see the `/*splat` route below). This file wires up the same
 * routers and route shapes index.js registers, mounted on a throwaway app
 * instance, and drives them with supertest instead of spinning up index.js
 * itself (which binds a real port, hijacks `require('electron')`, and starts
 * real bruno-electron file watchers as a side effect of module load).
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const request = require('supertest');

const { EventBridge } = require('../ws/event-bridge');
const { WindowShim, createFakeEvent } = require('../adapters/window-shim');
const { HandlerRegistry } = require('../handler-registry');
const { createIpcProxyRouter } = require('../routes/ipc-proxy');
const { createAuthRouter } = require('../routes/auth');
const { createAdminRouter } = require('../routes/admin');
const { createOauth2CallbackRouter } = require('../routes/oauth2');
const { isOriginAllowed } = require('../security/origin-policy');
const { requireAuth } = require('../security/auth');
const { injectRuntimeConfig } = require('../static-frontend');

const buildApp = ({ staticDir, extraHandlers = {} } = {}) => {
  const app = express();

  const eventBridge = new EventBridge();
  const windowShim = new WindowShim(eventBridge);
  const handlerRegistry = new HandlerRegistry();
  let collectionWatcher = null;

  handlerRegistry.register('renderer:echo', async (event, value) => ({ echoed: value }));
  handlerRegistry.register('renderer:load-runner-dataset', async (event, upload) => ({ fileName: upload.fileName }));
  handlerRegistry.registerEvent('renderer:fire-and-forget', async () => {});
  Object.entries(extraHandlers).forEach(([channel, handler]) => handlerRegistry.register(channel, handler));

  app.use(cors({ origin: (origin, callback) => callback(null, isOriginAllowed(origin)), credentials: true }));
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  app.use('/api/auth', createAuthRouter(handlerRegistry, windowShim, createFakeEvent, () => collectionWatcher));
  app.use('/api/ipc', requireAuth, createIpcProxyRouter(handlerRegistry, windowShim, createFakeEvent));
  app.use('/api/admin', requireAuth, createAdminRouter());
  app.use('/api/oauth2', createOauth2CallbackRouter());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', mode: 'bridge-server', channels: handlerRegistry.getChannels().length, wsClients: eventBridge.clientCount });
  });

  app.get('/api/runtime-config', (req, res) => {
    res.json({ basePath: '' });
  });

  app.get('/health/live', (req, res) => {
    res.json({ status: 'ok' });
  });

  if (staticDir) {
    const indexHtmlPath = path.join(staticDir, 'index.html');
    const indexHtmlWithRuntimeConfig = injectRuntimeConfig(fs.readFileSync(indexHtmlPath, 'utf8'), { basePath: '' });
    const serveIndexHtml = (req, res) => {
      res.set('Content-Type', 'text/html').send(indexHtmlWithRuntimeConfig);
    };

    app.use('', express.static(staticDir, { index: false }));
    app.get('/', serveIndexHtml);
    app.get('/index.html', serveIndexHtml);
    // Same pattern as index.js's SPA fallback — Express 5 requires the
    // wildcard segment to be named (`*splat`), unlike Express 4's bare `*`.
    app.get('/*splat', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/health/')) return next();
      serveIndexHtml(req, res);
    });
  }

  return app;
};

describe('Bridge Express app (Express 5 routing contract)', () => {
  test('GET /api/health returns 200 with channel/client counts', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', mode: 'bridge-server' });
    expect(typeof res.body.channels).toBe('number');
  });

  test('GET /api/runtime-config returns the configured base path', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/runtime-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ basePath: '' });
  });

  test('GET /health/live returns 200', async () => {
    const app = buildApp();
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/ipc/:channel dispatches to the registered handler and parses a JSON body', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/ipc/renderer:echo').send({ args: ['hello'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { echoed: 'hello' } });
  });

  test('POST /api/ipc rejects host paths for runner datasets but accepts uploaded content', async () => {
    const app = buildApp();
    const pathResponse = await request(app)
      .post('/api/ipc/renderer:load-runner-dataset')
      .send({ args: ['/etc/data.json'] });
    expect(pathResponse.status).toBe(400);
    expect(pathResponse.body.code).toBe('INVALID_ARGS');

    const uploadResponse = await request(app)
      .post('/api/ipc/renderer:load-runner-dataset')
      .send({ args: [{ fileName: 'data.json', content: '[{"id":1}]' }] });
    expect(uploadResponse.status).toBe(200);
    expect(uploadResponse.body).toEqual({ data: { fileName: 'data.json' } });
  });

  test('POST /api/ipc/:channel returns 404 for an unregistered channel', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/ipc/renderer:does-not-exist').send({ args: [] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HANDLER_NOT_FOUND');
  });

  test('GET /api/ipc/channels lists registered channels without requiring auth (auth disabled by default)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/ipc/channels');
    expect(res.status).toBe(200);
    expect(res.body.channels).toContain('renderer:echo');
  });

  test('GET /api/admin/allowed-roots reports the filesystem sandbox status', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/admin/allowed-roots');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled');
    expect(res.body).toHaveProperty('roots');
  });

  test('GET /api/auth/status reports auth as not required by default', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authRequired: false, authenticated: true });
  });

  test('GET /api/oauth2/callback without a state param is rejected', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/oauth2/callback');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Authorization Failed');
  });

  describe('idempotency key replay (Improvement.md P1.2)', () => {
    test('a repeated idempotencyKey on an allowlisted channel replays the first response without re-invoking the handler', async () => {
      let callCount = 0;
      const app = buildApp({
        extraHandlers: {
          'renderer:new-request': async (event, name) => {
            callCount += 1;
            return { name, uid: `uid-${callCount}` };
          }
        }
      });

      const first = await request(app)
        .post('/api/ipc/renderer:new-request')
        .send({ args: ['My Request'], idempotencyKey: 'idem-test-1-a' });
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ data: { name: 'My Request', uid: 'uid-1' } });

      const retry = await request(app)
        .post('/api/ipc/renderer:new-request')
        .send({ args: ['My Request'], idempotencyKey: 'idem-test-1-a' });
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual(first.body);
      expect(callCount).toBe(1);
    });

    test('a different idempotencyKey on the same channel invokes the handler again', async () => {
      let callCount = 0;
      const app = buildApp({
        extraHandlers: {
          'renderer:new-request': async (event, name) => {
            callCount += 1;
            return { name, uid: `uid-${callCount}` };
          }
        }
      });

      await request(app).post('/api/ipc/renderer:new-request').send({ args: ['My Request'], idempotencyKey: 'idem-test-2-a' });
      const second = await request(app)
        .post('/api/ipc/renderer:new-request')
        .send({ args: ['My Request'], idempotencyKey: 'idem-test-2-b' });

      expect(second.body).toEqual({ data: { name: 'My Request', uid: 'uid-2' } });
      expect(callCount).toBe(2);
    });

    test('idempotencyKey is ignored for channels outside the allowlist', async () => {
      let callCount = 0;
      const app = buildApp({
        extraHandlers: {
          'renderer:echo-idempotency-test': async (event, value) => {
            callCount += 1;
            return { echoed: value, call: callCount };
          }
        }
      });

      const first = await request(app)
        .post('/api/ipc/renderer:echo-idempotency-test')
        .send({ args: ['x'], idempotencyKey: 'key-1' });
      const second = await request(app)
        .post('/api/ipc/renderer:echo-idempotency-test')
        .send({ args: ['x'], idempotencyKey: 'key-1' });

      expect(first.body).toEqual({ data: { echoed: 'x', call: 1 } });
      expect(second.body).toEqual({ data: { echoed: 'x', call: 2 } });
      expect(callCount).toBe(2);
    });

    test('a handler error is not cached — a retry with the same key re-invokes the handler', async () => {
      let callCount = 0;
      const app = buildApp({
        extraHandlers: {
          'renderer:new-folder': async () => {
            callCount += 1;
            if (callCount === 1) throw new Error('disk full');
            return { success: true };
          }
        }
      });

      const first = await request(app)
        .post('/api/ipc/renderer:new-folder')
        .send({ args: ['folder-name'], idempotencyKey: 'key-1' });
      expect(first.status).toBe(500);

      const retry = await request(app)
        .post('/api/ipc/renderer:new-folder')
        .send({ args: ['folder-name'], idempotencyKey: 'key-1' });
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual({ data: { success: true } });
      expect(callCount).toBe(2);
    });
  });

  describe('static frontend + SPA fallback (Express 5 named-wildcard routing)', () => {
    let staticDir;

    beforeAll(() => {
      staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-server-static-'));
      fs.writeFileSync(path.join(staticDir, 'index.html'), '<html><head></head><body>Bruno</body></html>');
      fs.mkdirSync(path.join(staticDir, 'assets'));
      fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log("bruno");');
    });

    afterAll(() => {
      fs.rmSync(staticDir, { recursive: true, force: true });
    });

    test('GET / serves index.html with the injected runtime config', async () => {
      const app = buildApp({ staticDir });
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('window.__BRUNO_RUNTIME_CONFIG__');
      expect(res.text).toContain('Bruno');
    });

    test('GET /assets/app.js is served as a real static asset', async () => {
      const app = buildApp({ staticDir });
      const res = await request(app).get('/assets/app.js');
      expect(res.status).toBe(200);
      expect(res.text).toContain('console.log');
    });

    test('GET /some/deep/client-route falls through to the SPA index.html via the named wildcard', async () => {
      const app = buildApp({ staticDir });
      const res = await request(app).get('/some/deep/client-route');
      expect(res.status).toBe(200);
      expect(res.text).toContain('window.__BRUNO_RUNTIME_CONFIG__');
    });

    test('GET /api/health still resolves through the real handler, not the SPA fallback', async () => {
      const app = buildApp({ staticDir });
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
