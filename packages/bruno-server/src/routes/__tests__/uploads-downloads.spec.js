/**
 * HTTP-level tests for the Transfer Center upload/download routes
 * (Improvement.md P1.1 — routes/uploads.js, routes/downloads.js).
 *
 * Mirrors app-routes.spec.js: builds a throwaway Express app wiring the
 * real routers (not index.js itself, which binds a real port and hijacks
 * `require('electron')`), and drives it with supertest.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

const { WindowShim, createFakeEvent } = require('../../adapters/window-shim');
const { HandlerRegistry } = require('../../handler-registry');
const { EventBridge } = require('../../ws/event-bridge');

// uploads.js/downloads.js/auth.js all read env vars (BRUNO_SERVER_UPLOAD_MAX_MB,
// BRUNO_SERVER_ALLOWED_ROOTS via allowed-roots.js, BRUNO_SERVER_REQUIRE_AUTH)
// at module-require time, so each scenario that needs a non-default value
// sets the env var and re-requires all three fresh via jest.isolateModules(),
// same technique as allowed-roots.spec.js.
const loadRoutes = () => {
  let uploadsMod;
  let downloadsMod;
  let authMod;
  jest.isolateModules(() => {
    uploadsMod = require('../uploads');
    downloadsMod = require('../downloads');
    authMod = require('../../security/auth');
  });
  return {
    createUploadsRouter: uploadsMod.createUploadsRouter,
    createDownloadsRouter: downloadsMod.createDownloadsRouter,
    requireAuth: authMod.requireAuth
  };
};

const buildApp = ({ createUploadsRouter, createDownloadsRouter, requireAuth }) => {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  const eventBridge = new EventBridge();
  const windowShim = new WindowShim(eventBridge);
  const handlerRegistry = new HandlerRegistry();

  // Stand-in for renderer:export-collection-zip: writes real bytes to the
  // destinationPath the route generates, exactly like the real
  // bruno-electron handler does with archiver — verifies the route wires
  // args through and streams whatever ends up on disk.
  handlerRegistry.register('renderer:export-collection-zip', async (event, collectionPath, collectionName, destinationPath) => {
    fs.writeFileSync(destinationPath, `zip-bytes-for:${collectionPath}:${collectionName}`);
    return { success: true, filePath: destinationPath };
  });
  handlerRegistry.register('renderer:export-workspace-that-fails', async () => ({ success: false, canceled: true }));

  app.use('/api/uploads', requireAuth, createUploadsRouter());
  app.use('/api/downloads', requireAuth, createDownloadsRouter(handlerRegistry, windowShim, createFakeEvent));

  return app;
};

describe('POST /api/uploads/scratch-file', () => {
  test('stores the uploaded file and returns a real scratch path', async () => {
    const routes = loadRoutes();
    const app = buildApp(routes);

    const res = await request(app)
      .post('/api/uploads/scratch-file')
      .attach('file', Buffer.from('hello bruno'), 'collection.zip');

    expect(res.status).toBe(200);
    expect(typeof res.body.data).toBe('string');
    expect(fs.existsSync(res.body.data)).toBe(true);
    expect(fs.readFileSync(res.body.data, 'utf8')).toBe('hello bruno');
    expect(path.extname(res.body.data)).toBe('.zip');

    fs.unlinkSync(res.body.data);
  });

  test('rejects a request with no file attached', async () => {
    const routes = loadRoutes();
    const app = buildApp(routes);

    const res = await request(app).post('/api/uploads/scratch-file');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ARGS');
  });

  test('rejects a file over BRUNO_SERVER_UPLOAD_MAX_MB', async () => {
    const originalEnv = process.env.BRUNO_SERVER_UPLOAD_MAX_MB;
    process.env.BRUNO_SERVER_UPLOAD_MAX_MB = '1';
    try {
      const routes = loadRoutes();
      const app = buildApp(routes);

      const oversized = Buffer.alloc(2 * 1024 * 1024, 'a');
      const res = await request(app)
        .post('/api/uploads/scratch-file')
        .attach('file', oversized, 'big.zip');

      expect(res.status).toBe(413);
      expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    } finally {
      if (originalEnv === undefined) delete process.env.BRUNO_SERVER_UPLOAD_MAX_MB;
      else process.env.BRUNO_SERVER_UPLOAD_MAX_MB = originalEnv;
    }
  });

  test('requires auth when BRUNO_SERVER_REQUIRE_AUTH is enabled', async () => {
    const originalEnv = process.env.BRUNO_SERVER_REQUIRE_AUTH;
    process.env.BRUNO_SERVER_REQUIRE_AUTH = 'true';
    try {
      const routes = loadRoutes();
      const app = buildApp(routes);

      const res = await request(app)
        .post('/api/uploads/scratch-file')
        .attach('file', Buffer.from('hello'), 'collection.zip');

      expect(res.status).toBe(401);
    } finally {
      if (originalEnv === undefined) delete process.env.BRUNO_SERVER_REQUIRE_AUTH;
      else process.env.BRUNO_SERVER_REQUIRE_AUTH = originalEnv;
    }
  });
});

describe('POST /api/downloads/:channel', () => {
  test('streams the exported file back with a Content-Disposition header', async () => {
    const routes = loadRoutes();
    const app = buildApp(routes);

    const res = await request(app)
      .post('/api/downloads/renderer:export-collection-zip')
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .send({ args: ['/some/collection/path', 'My Collection'] });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('My_Collection.zip');
    expect(res.body.toString('utf8')).toBe('zip-bytes-for:/some/collection/path:My Collection');
  });

  test('rejects a channel that is not on the download allowlist', async () => {
    const routes = loadRoutes();
    const app = buildApp(routes);

    const res = await request(app)
      .post('/api/downloads/renderer:export-workspace-that-fails')
      .send({ args: ['/some/path', 'name'] });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HANDLER_NOT_FOUND');
  });

  test('rejects a source path outside BRUNO_SERVER_ALLOWED_ROOTS when the sandbox is enabled', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-downloads-test-'));
    const allowedRoot = path.join(tmpDir, 'allowed');
    fs.mkdirSync(allowedRoot, { recursive: true });

    const originalEnv = process.env.BRUNO_SERVER_ALLOWED_ROOTS;
    process.env.BRUNO_SERVER_ALLOWED_ROOTS = allowedRoot;
    try {
      const routes = loadRoutes();
      const app = buildApp(routes);

      const res = await request(app)
        .post('/api/downloads/renderer:export-collection-zip')
        .send({ args: ['/outside/the/allowed/root', 'My Collection'] });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PATH_OUTSIDE_ALLOWED_ROOT');
    } finally {
      if (originalEnv === undefined) delete process.env.BRUNO_SERVER_ALLOWED_ROOTS;
      else process.env.BRUNO_SERVER_ALLOWED_ROOTS = originalEnv;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('rejects a malformed args array before dispatching to the handler', async () => {
    const routes = loadRoutes();
    const app = buildApp(routes);

    const res = await request(app)
      .post('/api/downloads/renderer:export-collection-zip')
      .send({ args: ['/some/collection/path'] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ARGS');
  });

  test('requires auth when BRUNO_SERVER_REQUIRE_AUTH is enabled', async () => {
    const originalEnv = process.env.BRUNO_SERVER_REQUIRE_AUTH;
    process.env.BRUNO_SERVER_REQUIRE_AUTH = 'true';
    try {
      const routes = loadRoutes();
      const app = buildApp(routes);

      const res = await request(app)
        .post('/api/downloads/renderer:export-collection-zip')
        .send({ args: ['/some/collection/path', 'My Collection'] });

      expect(res.status).toBe(401);
    } finally {
      if (originalEnv === undefined) delete process.env.BRUNO_SERVER_REQUIRE_AUTH;
      else process.env.BRUNO_SERVER_REQUIRE_AUTH = originalEnv;
    }
  });
});
