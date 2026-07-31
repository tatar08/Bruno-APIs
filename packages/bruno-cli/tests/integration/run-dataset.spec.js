const { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CLI_BIN = path.resolve(__dirname, '..', '..', 'bin', 'bru.js');

const writeFixtureFile = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

describe('CLI run --dataset (Improvement.md: dataset-driven CLI runs)', () => {
  let server;
  let baseUrl;
  let tmpDir;
  let receivedHeaders;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      receivedHeaders.push(req.headers['x-value']);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bru-cli-dataset-'));
    receivedHeaders = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // spawnSync blocks jest's event loop, starving the in-process HTTP server → ECONNREFUSED.
  // Use async spawn so the server stays responsive.
  const runCli = (args, cwd = tmpDir) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI_BIN, ...args], { cwd, env: { ...process.env } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

  const setupCollection = (requestBru, requestFileName = 'echo-value.bru') => {
    writeFixtureFile(
      path.join(tmpDir, 'bruno.json'),
      JSON.stringify({ version: '1', name: 'dataset-cli-collection', type: 'collection' }, null, 2) + '\n'
    );
    writeFixtureFile(
      path.join(tmpDir, 'collection.bru'),
      'meta {\n  name: dataset-cli-collection\n  seq: 1\n}\n'
    );
    writeFixtureFile(path.join(tmpDir, requestFileName), requestBru);
  };

  const ECHO_VALUE_BRU = (baseUrl) => `meta {
  name: echo-value
  type: http
  seq: 1
}

get {
  url: ${baseUrl}/ping
  body: none
  auth: none
}

headers {
  X-Value: {{value}}
}
`;

  it('runs the collection once per dataset row (CSV), interpolating each row into runtime variables', async () => {
    setupCollection(ECHO_VALUE_BRU(baseUrl));
    writeFixtureFile(path.join(tmpDir, 'data.csv'), 'value\nfirst\nsecond\nthird\n');

    const result = await runCli([
      'run', 'echo-value.bru', '--dataset', 'data.csv', '--sandbox', 'developer', '--noproxy',
      '--output', 'results.json', '--format', 'json'
    ]);

    if (result.code !== 0) {
      throw new Error(`CLI exited with code ${result.code}.\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
    }

    expect(receivedHeaders).toEqual(['first', 'second', 'third']);

    const output = JSON.parse(fs.readFileSync(path.join(tmpDir, 'results.json'), 'utf8'));
    expect(output.results).toHaveLength(3);
    expect(output.results.map((r) => r.iterationIndex)).toEqual([0, 1, 2]);
    output.results.forEach((r) => expect(r.iterationCount).toBe(3));
  }, 60_000);

  it('runs the collection once per dataset row (JSON dataset)', async () => {
    setupCollection(ECHO_VALUE_BRU(baseUrl));
    writeFixtureFile(path.join(tmpDir, 'data.json'), JSON.stringify([{ value: 'alpha' }, { value: 'beta' }]));

    const result = await runCli([
      'run', 'echo-value.bru', '--dataset', 'data.json', '--sandbox', 'developer', '--noproxy'
    ]);

    if (result.code !== 0) {
      throw new Error(`CLI exited with code ${result.code}.\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
    }

    expect(receivedHeaders).toEqual(['alpha', 'beta']);
  }, 60_000);

  // Mirrors the Desktop runner's B1 fix: envVars set by a post-response script must persist
  // forward across dataset iterations (a single shared envVars reference, never reset per row).
  it('carries an env var set by a script forward across dataset iterations', async () => {
    setupCollection(`meta {
  name: counter
  type: http
  seq: 1
}

get {
  url: ${baseUrl}/ping
  body: none
  auth: none
}

headers {
  X-Value: {{counter}}
}

script:pre-request {
  bru.setEnvVar("counter", (Number(bru.getEnvVar("counter")) || 0) + 1);
}
`, 'counter.bru');
    writeFixtureFile(path.join(tmpDir, 'environments', 'Test.bru'), 'vars {\n}\n');
    writeFixtureFile(path.join(tmpDir, 'data.csv'), 'row\n1\n2\n3\n');

    const result = await runCli([
      'run', 'counter.bru', '--dataset', 'data.csv', '--env', 'Test', '--sandbox', 'developer', '--noproxy'
    ]);

    if (result.code !== 0) {
      throw new Error(`CLI exited with code ${result.code}.\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
    }

    expect(receivedHeaders).toEqual(['1', '2', '3']);
  }, 60_000);

  it('exits with a file-not-found error when the dataset file does not exist', async () => {
    setupCollection(ECHO_VALUE_BRU(baseUrl));

    const result = await runCli([
      'run', 'echo-value.bru', '--dataset', 'missing.csv', '--sandbox', 'developer', '--noproxy'
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('does not exist');
    expect(receivedHeaders).toHaveLength(0);
  }, 60_000);

  it('exits with an error when the dataset file is malformed', async () => {
    setupCollection(ECHO_VALUE_BRU(baseUrl));
    writeFixtureFile(path.join(tmpDir, 'data.csv'), 'value\n');

    const result = await runCli([
      'run', 'echo-value.bru', '--dataset', 'data.csv', '--sandbox', 'developer', '--noproxy'
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('Failed to parse dataset file');
    expect(receivedHeaders).toHaveLength(0);
  }, 60_000);
});
