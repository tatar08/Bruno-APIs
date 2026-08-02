/**
 * Bruno Bridge Server
 *
 * Express + WebSocket server that enables Bruno to run in a web browser.
 * It reuses the IPC handler logic from bruno-electron but exposes it
 * via HTTP REST + WebSocket instead of Electron IPC.
 *
 * Usage:
 *   node packages/bruno-server/src/index.js
 *   # or
 *   npm run dev:server
 */

// When dumping the channel registry for audit-parity.js, keep stdout
// reserved for the JSON payload alone — every registration step below logs
// via console.log/warn, so route those to stderr instead for this run only.
if (process.env.BRUNO_RPC_CONTRACT_DUMP === 'true') {
  console.log = console.error;
  console.warn = console.error;
}

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const { EventBridge } = require('./ws/event-bridge');
const { WindowShim, createFakeEvent } = require('./adapters/window-shim');
const { HandlerRegistry } = require('./handler-registry');
const { createIpcProxyRouter } = require('./routes/ipc-proxy');
const { createAuthRouter } = require('./routes/auth');
const { createAdminRouter } = require('./routes/admin');
const { createOauth2CallbackRouter } = require('./routes/oauth2');
const { createUploadsRouter } = require('./routes/uploads');
const { createDownloadsRouter } = require('./routes/downloads');
const { isOriginAllowed } = require('./security/origin-policy');
const { isAuthRequired, requireAuth, bootstrapToken } = require('./security/auth');
const { getOrCreateMasterKey, createSafeStorageShim } = require('./security/master-key');
const { redactSecrets } = require('./security/log-redaction');
const { validateStartupConfig } = require('./config-validation');
const { getBuildInfo } = require('./health');
const { injectRuntimeConfig } = require('./static-frontend');

// Fail fast on invalid config rather than letting a typo'd env var silently
// fall back to its default deep inside some other module (Improvement.md P1.3).
const startupConfigErrors = validateStartupConfig();
if (startupConfigErrors.length > 0) {
  console.error('\n❌ Invalid Bruno Bridge Server configuration:\n');
  startupConfigErrors.forEach((message) => console.error(`   - ${message}`));
  console.error('');
  process.exit(1);
}

const PORT = process.env.BRUNO_SERVER_PORT || 4000;
// Loopback by default so the Bridge isn't reachable from the LAN/internet
// without an explicit opt-in. Set BRUNO_SERVER_HOST=0.0.0.0 to allow that.
const HOST = process.env.BRUNO_SERVER_HOST || '127.0.0.1';
const JSON_BODY_LIMIT = process.env.BRUNO_SERVER_JSON_LIMIT || '25mb';

// Reverse proxy base path (Improvement.md P1.3) — when the Bridge is mounted
// under a path prefix (e.g. https://host/bridge/...) instead of the origin
// root, every API/health/WS route and the static frontend below need to
// agree on the same prefix. Validated by config-validation.js at startup.
// Liveness/readiness probes deliberately stay unprefixed (see below) since
// orchestrators typically hit the container directly, bypassing any proxy.
const BASE_PATH = process.env.BRUNO_SERVER_BASE_PATH || '';

// Fixed OAuth2 loopback callback the Bridge forces as the redirect_uri for
// every OAuth2 request it proxies (Improvement.md P1.5). Overridable for
// deployments that sit behind a reverse proxy/different public origin than
// HOST:PORT; otherwise computed from the same values the server itself
// binds to. oauth2.js/authorize-user-in-system-browser.js key their
// Bridge-vs-desktop branching on `!!app.browserBridge` alone (not on
// whether auth is enabled), since redirect-URI forcing and the
// window.webContents.send() delivery path both apply either way.
const OAUTH2_CALLBACK_URL =
  process.env.BRUNO_SERVER_OAUTH2_CALLBACK_URL || `http://${HOST}:${PORT}${BASE_PATH}/api/oauth2/callback`;

// Same directory bruno-electron's store/*.js files (ai-keys.json, oauth2.json,
// cookies.json, ...) resolve via app.getPath('userData') below.
const USER_DATA_DIR = path.join(require('os').homedir(), '.config', 'bruno');

// A real, persistent, per-deployment encryption key for the Bridge
// (Improvement.md P1.4). Without this, bruno-electron's encryption.js falls
// through to a key derived from machineIdSync() — one shared, unmanaged key
// for every session on this server process. Kept in its own subdirectory
// (not beside the ciphertext files above) with restrictive file permissions.
const MASTER_KEY_PATH = process.env.BRUNO_SERVER_MASTER_KEY_PATH || path.join(USER_DATA_DIR, '.keys', 'bridge-master.key');
const masterKey = getOrCreateMasterKey(MASTER_KEY_PATH);
const safeStorageShim = createSafeStorageShim(masterKey);

// --- Initialize core components ---

const app = express();
const server = http.createServer(app);

// Event bridge for WebSocket push events
const eventBridge = new EventBridge();
eventBridge.attach(server, BASE_PATH);

// Window shim that routes webContents.send() to the event bridge
const windowShim = new WindowShim(eventBridge);

// Handler registry that captures IPC handlers
const handlerRegistry = new HandlerRegistry();

// Populated by registerHandlers() once bruno-electron's collection-watcher
// singleton is required below; read lazily via getCollectionWatcher() since
// route registration (createAuthRouter, below) happens before that.
let collectionWatcher = null;
const getCollectionWatcher = () => collectionWatcher;

// Captured for graceful shutdown (Improvement.md P1.3) — the modules that
// create these normally rely on Electron-only lifecycle hooks
// ('window-all-closed') to tear them down, which never fire under the
// Bridge's electron shim (see registerHandlers() below and the shutdown()
// handler near the bottom of this file).
let workspaceWatcher = null;
let terminalManager = null;
let wsEventHandlers = null;
let grpcEventHandlers = null;

// --- Middleware ---

app.use(cors({
  origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  credentials: true,
  // Content-Disposition and X-Content-SHA256 aren't on the CORS
  // response-header safelist by default; without this, fetch() in
  // ipc-transport.js can't read the server-suggested filename or the
  // integrity checksum for a Bridge export download (Improvement.md P1.1
  // Transfer Center) whenever bruno-app is served from a different origin
  // than bruno-server (e.g. local dev).
  exposedHeaders: ['Content-Disposition', 'X-Content-SHA256']
}));

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

// --- Register IPC handlers from bruno-electron ---

/**
 * Override Node's require so that when bruno-electron modules
 * do `require('electron')`, they get our shims instead.
 */
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;

// Create shims for Electron modules
const electronShim = {
  ipcMain: handlerRegistry.createIpcMainShim(),
  BrowserWindow: {
    fromWebContents: () => windowShim,
    getAllWindows: () => [windowShim]
  },
  app: {
    getPath: (name) => {
      const os = require('os');
      const paths = {
        userData: USER_DATA_DIR,
        home: os.homedir(),
        temp: os.tmpdir(),
        desktop: path.join(os.homedir(), 'Desktop'),
        documents: path.join(os.homedir(), 'Documents'),
        downloads: path.join(os.homedir(), 'Downloads'),
        appData: path.join(os.homedir(), '.config')
      };
      return paths[name] || os.tmpdir();
    },
    getName: () => 'Bruno',
    getVersion: () => '2.0.0',
    isReady: () => true,
    quit: () => {},
    exit: () => {},
    on: () => {},
    once: () => {},
    removeAsDefaultProtocolClient: () => {},
    setAsDefaultProtocolClient: () => {},
    requestSingleInstanceLock: () => true,
    setPath: () => {},
    commandLine: { appendSwitch: () => {} },
    focus: () => {},
    addRecentDocument: () => {},
    // Presence of this property (not its value) is how bruno-electron code
    // detects it's running under the Browser Bridge rather than desktop
    // Electron — see oauth2.js and authorize-user-in-system-browser.js.
    browserBridge: {
      oauth2CallbackUrl: OAUTH2_CALLBACK_URL
    }
  },
  dialog: require('./adapters/dialog-shim'),
  shell: {
    openExternal: (url) => {
      console.log(`[Shell] openExternal: ${url}`);
      return Promise.resolve();
    },
    openPath: (p) => {
      console.log(`[Shell] openPath: ${p}`);
      return Promise.resolve('');
    }
  },
  session: {
    defaultSession: {
      getAllExtensions: () => [],
      loadExtension: () => Promise.resolve(),
      extensions: {
        getAllExtensions: () => []
      }
    }
  },
  nativeTheme: {
    themeSource: 'system',
    shouldUseDarkColors: false
  },
  Menu: {
    buildFromTemplate: () => ({}),
    setApplicationMenu: () => {}
  },
  globalShortcut: {
    register: () => {},
    unregisterAll: () => {}
  },
  // Backed by a real per-deployment master key (security/master-key.js),
  // not a stub — see MASTER_KEY_PATH above (Improvement.md P1.4).
  safeStorage: safeStorageShim,
  webUtils: {
    getPathForFile: (file) => file.path || file.name || ''
  },
  // Default export that returns sub-modules
  default: {}
};

// Track if we need to intercept electron requires
const electronModulePaths = new Set(['electron', 'electron-is-dev']);

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electron') {
    // Return a marker that our require hook will catch
    return '__electron_shim__';
  }
  if (request === 'electron-is-dev') {
    return '__electron_is_dev_shim__';
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Hook into require to intercept electron imports
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '__electron_shim__' || request === 'electron') {
    return electronShim;
  }
  if (request === '__electron_is_dev_shim__' || request === 'electron-is-dev') {
    return false; // Not in dev mode for the server
  }
  // For electron-util, provide a minimal shim
  if (request === 'electron-util') {
    return {
      setContentSecurityPolicy: () => {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

/**
 * Register handlers from bruno-electron IPC modules.
 *
 * We import the registration functions and call them with our shim.
 * The ipcMain shim captures all .handle() calls into our registry.
 */
const registerHandlers = () => {
  const electronSrcPath = path.join(__dirname, '../../bruno-electron/src');

  try {
    // Filesystem handlers — simple and safe to load first
    const registerFilesystemIpc = require(path.join(electronSrcPath, 'ipc/filesystem'));
    registerFilesystemIpc(windowShim);
    console.log('  ✅ Filesystem handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load filesystem handlers:', redactSecrets(err.message));
  }

  try {
    // Preferences handlers
    const registerPreferencesIpc = require(path.join(electronSrcPath, 'ipc/preferences'));
    registerPreferencesIpc(windowShim);
    console.log('  ✅ Preferences handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load preferences handlers:', redactSecrets(err.message));
  }

  try {
    // Snapshot handlers
    const registerSnapshotIpc = require(path.join(electronSrcPath, 'ipc/snapshot'));
    registerSnapshotIpc();
    console.log('  ✅ Snapshot handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load snapshot handlers:', redactSecrets(err.message));
  }

  try {
    // Network handlers (HTTP requests, gRPC, WebSocket)
    const registerNetworkIpc = require(path.join(electronSrcPath, 'ipc/network'));
    registerNetworkIpc(windowShim);
    // Same resolved absolute path as what ipc/network/index.js required
    // internally, so require() hits Node's module cache and returns the
    // exact same module objects (with wsClient/grpcClient already created).
    wsEventHandlers = require(path.join(electronSrcPath, 'ipc/network/ws-event-handlers'));
    grpcEventHandlers = require(path.join(electronSrcPath, 'ipc/network/grpc-event-handlers'));
    console.log('  ✅ Network handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load network handlers:', redactSecrets(err.message));
  }

  try {
    // Collection handlers
    const registerCollectionsIpc = require(path.join(electronSrcPath, 'ipc/collection'));
    // Use Bruno's real watcher so opened collections hydrate and stay in sync
    // exactly as they do in the desktop application.
    collectionWatcher = require(path.join(electronSrcPath, 'app/collection-watcher'));
    registerCollectionsIpc(windowShim, collectionWatcher);
    console.log('  ✅ Collection handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load collection handlers:', redactSecrets(err.message));
  }

  try {
    // Workspace handlers
    const registerWorkspaceIpc = require(path.join(electronSrcPath, 'ipc/workspace'));
    const WorkspaceWatcher = require(path.join(electronSrcPath, 'app/workspace-watcher'));
    workspaceWatcher = new WorkspaceWatcher();
    registerWorkspaceIpc(windowShim, workspaceWatcher);
    console.log('  ✅ Workspace handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load workspace handlers:', redactSecrets(err.message));
  }

  try {
    // Global environments handlers
    const registerGlobalEnvironmentsIpc = require(path.join(electronSrcPath, 'ipc/global-environments'));
    const { globalEnvironmentsManager } = require(path.join(electronSrcPath, 'store/workspace-environments'));
    registerGlobalEnvironmentsIpc(windowShim, globalEnvironmentsManager);
    console.log('  ✅ Global environments handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load global environments handlers:', redactSecrets(err.message));
  }

  try {
    // Git handlers
    const registerGitIpc = require(path.join(electronSrcPath, 'ipc/git'));
    registerGitIpc(windowShim);
    console.log('  ✅ Git handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load git handlers:', redactSecrets(err.message));
  }

  try {
    // System monitor handlers
    const registerSystemMonitorIpc = require(path.join(electronSrcPath, 'ipc/system-monitor'));
    const SystemMonitor = require(path.join(electronSrcPath, 'app/system-monitor'));
    const systemMonitor = new SystemMonitor();
    registerSystemMonitorIpc(windowShim, systemMonitor);
    console.log('  ✅ System monitor handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load system monitor handlers:', redactSecrets(err.message));
  }

  try {
    // Notifications handlers
    const registerNotificationsIpc = require(path.join(electronSrcPath, 'ipc/notifications'));
    const collectionWatcher = require(path.join(electronSrcPath, 'app/collection-watcher'));
    registerNotificationsIpc(windowShim, collectionWatcher);
    console.log('  ✅ Notifications handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load notifications handlers:', redactSecrets(err.message));
  }

  try {
    // API Spec handlers and filesystem watcher
    const registerApiSpecIpc = require(path.join(electronSrcPath, 'ipc/apiSpec'));
    const ApiSpecWatcher = require(path.join(electronSrcPath, 'app/apiSpecsWatcher'));
    registerApiSpecIpc(windowShim, new ApiSpecWatcher());
    console.log('  ✅ API Spec handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load API Spec handlers:', redactSecrets(err.message));
  }

  try {
    // OpenAPI synchronization handlers
    const registerOpenAPISyncIpc = require(path.join(electronSrcPath, 'ipc/openapi-sync'));
    registerOpenAPISyncIpc(windowShim);
    console.log('  ✅ OpenAPI Sync handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load OpenAPI Sync handlers:', redactSecrets(err.message));
  }

  try {
    // AI chat, generation and provider configuration handlers
    const registerAiIpc = require(path.join(electronSrcPath, 'ipc/ai'));
    registerAiIpc(windowShim);
    console.log('  ✅ AI handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load AI handlers:', redactSecrets(err.message));
  }

  try {
    const registerAiAutocompleteIpc = require(path.join(electronSrcPath, 'ipc/ai/autocomplete'));
    registerAiAutocompleteIpc(windowShim);
    console.log('  ✅ AI Autocomplete handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load AI Autocomplete handlers:', redactSecrets(err.message));
  }

  try {
    // TerminalManager registers its IPC handlers in the constructor.
    const TerminalManager = require(path.join(electronSrcPath, 'ipc/terminal'));
    terminalManager = new TerminalManager();
    console.log('  ✅ Terminal handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load Terminal handlers:', redactSecrets(err.message));
  }

  try {
    // Mount handlers
    const { registerMountIpc } = require(path.join(electronSrcPath, 'ipc/mount'));
    registerMountIpc();
    console.log('  ✅ Mount handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load mount handlers:', redactSecrets(err.message));
  }

  // Electron emits this from its BrowserWindow lifecycle. The browser has no
  // BrowserWindow, so complete the same lifecycle after renderer bootstrap has
  // loaded preferences and restored workspaces.
  const rendererReadyHandler = handlerRegistry.get('renderer:ready');
  if (rendererReadyHandler) {
    handlerRegistry.register('renderer:ready', async (event, ...args) => {
      const result = await rendererReadyHandler(event, ...args);
      windowShim.webContents.send('main:app-loaded', {
        isRunningInRosetta: false,
        mode: 'browser'
      });
      return result;
    });
  }

  // Register direct window/menu handlers normally owned by Electron index.js.
  ['renderer:window-minimize', 'renderer:window-maximize', 'renderer:window-close',
    'menu:reset-zoom', 'menu:zoom-in', 'menu:zoom-out'].forEach((channel) => {
    handlerRegistry.registerEvent(channel, async () => {});
  });

  // Register some direct handlers that are normally in index.js
  handlerRegistry.register('renderer:window-is-maximized', async () => false);
  handlerRegistry.register('renderer:window-is-fullscreen', async () => false);
  handlerRegistry.register('renderer:toggle-devtools', async () => {});
  handlerRegistry.register('renderer:reset-zoom', async () => {});
  handlerRegistry.register('renderer:zoom-in', async () => {});
  handlerRegistry.register('renderer:zoom-out', async () => {});
  handlerRegistry.register('renderer:set-zoom-level', async () => {});
  handlerRegistry.register('renderer:toggle-fullscreen', async () => {});
  handlerRegistry.register('renderer:open-docs', async () => {});
  handlerRegistry.register('renderer:open-about', async () => ({ version: '2.0.0' }));
  handlerRegistry.register('renderer:open-preferences', async () => {
    windowShim.webContents.send('main:open-preferences');
  });
  handlerRegistry.register('main:cache-clear', async () => {});
  handlerRegistry.register('main:complete-quit-flow', async () => {});

  console.log(`\n📋 Total registered handlers: ${handlerRegistry.getChannels().length}`);
};

// --- Routes ---

app.use(`${BASE_PATH}/api/auth`, createAuthRouter(handlerRegistry, windowShim, createFakeEvent, getCollectionWatcher));
app.use(`${BASE_PATH}/api/ipc`, requireAuth, createIpcProxyRouter(handlerRegistry, windowShim, createFakeEvent));
app.use(`${BASE_PATH}/api/uploads`, requireAuth, createUploadsRouter());
app.use(`${BASE_PATH}/api/downloads`, requireAuth, createDownloadsRouter(handlerRegistry, windowShim, createFakeEvent));
app.use(`${BASE_PATH}/api/admin`, requireAuth, createAdminRouter());
// Not behind requireAuth — see routes/oauth2.js's header comment for why an
// IdP redirect can never carry a Bridge session cookie/CSRF token.
app.use(`${BASE_PATH}/api/oauth2`, createOauth2CallbackRouter());

// Health check
app.get(`${BASE_PATH}/api/health`, (req, res) => {
  res.json({
    status: 'ok',
    mode: 'bridge-server',
    channels: handlerRegistry.getChannels().length,
    wsClients: eventBridge.clientCount
  });
});

// Runtime config (Improvement.md P1.3) — lets the frontend discover its
// reverse proxy base path at request time instead of needing it baked in at
// build time. Same-origin deployments (the Bridge serving its own static
// build, below) get this injected directly into index.html; anything else
// can still fetch it explicitly.
app.get(`${BASE_PATH}/api/runtime-config`, (req, res) => {
  res.json({ basePath: BASE_PATH });
});

// Liveness: the process is up and handling requests. Deliberately checks
// nothing about downstream state — a liveness probe should only fail when
// the process itself is deadlocked/crashed, not because of a transient
// dependency issue (that's what readiness is for).
app.get('/health/live', (req, res) => {
  res.json({ status: 'ok', ...getBuildInfo() });
});

// Readiness: the server has finished starting up and its core dependencies
// are in place. Individual handler-module load failures during
// registerHandlers() are already tolerated as non-fatal (logged, not
// thrown) so the server keeps serving everything else — readiness mirrors
// that same tolerance rather than flipping the whole server unready over
// one degraded module.
app.get('/health/ready', (req, res) => {
  const dependencies = {
    httpServer: server.listening,
    ipcHandlers: handlerRegistry.getChannels().length > 0,
    collectionWatcher: collectionWatcher !== null
  };
  const ready = Object.values(dependencies).every(Boolean);
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'not_ready',
    ...getBuildInfo(),
    channels: handlerRegistry.getChannels().length,
    dependencies
  });
});

// --- Static frontend (Improvement.md P1.3) ---
//
// Optional: only enabled when a bruno-app production build (`npm run build`
// in packages/bruno-app) is present at BRUNO_APP_DIST_DIR. When absent, the
// Bridge behaves exactly as it always has — API/WS only, with the frontend
// hosted separately (e.g. a dev server, or a CDN/static host pointed at the
// same build). Registered after every /api and /health route above so
// those always win; only unmatched GETs fall through to the SPA.
const BRUNO_APP_DIST_DIR = process.env.BRUNO_SERVER_STATIC_DIR || path.join(__dirname, '../../bruno-app/dist');
const STATIC_INDEX_HTML_PATH = path.join(BRUNO_APP_DIST_DIR, 'index.html');
const serveStaticFrontend = fs.existsSync(STATIC_INDEX_HTML_PATH);

if (serveStaticFrontend) {
  // Read + inject once at startup rather than per-request — BASE_PATH is
  // fixed for the process lifetime, so there's nothing to recompute.
  const indexHtmlWithRuntimeConfig = injectRuntimeConfig(
    fs.readFileSync(STATIC_INDEX_HTML_PATH, 'utf8'),
    { basePath: BASE_PATH }
  );
  const serveIndexHtml = (req, res) => {
    res.set('Content-Type', 'text/html').send(indexHtmlWithRuntimeConfig);
  };

  // `index: false` stops express.static from auto-serving the on-disk
  // index.html (without the injected runtime config) for `/`.
  app.use(BASE_PATH, express.static(BRUNO_APP_DIST_DIR, { index: false }));
  app.get(`${BASE_PATH}/`, serveIndexHtml);
  app.get(`${BASE_PATH}/index.html`, serveIndexHtml);
  // SPA fallback: any other GET under BASE_PATH that isn't a real static
  // asset falls through to index.html so client-side routing (deep links,
  // page refreshes) works. /api and /health are already handled above and
  // never reach here; the explicit check is just cheap insurance.
  app.get(`${BASE_PATH}/*splat`, (req, res, next) => {
    if (req.path.startsWith(`${BASE_PATH}/api/`) || req.path.startsWith('/health/')) return next();
    serveIndexHtml(req, res);
  });

  console.log(`\n🖥️  Serving bruno-app production build from ${BRUNO_APP_DIST_DIR}`);
} else {
  console.log(`\n🖥️  No bruno-app build found at ${BRUNO_APP_DIST_DIR} — API/WS only, frontend hosted separately`);
}

// --- Start Server ---

console.log('\n🚀 Starting Bruno Bridge Server...\n');
console.log('📦 Registering IPC handlers from bruno-electron:\n');

try {
  registerHandlers();
} catch (err) {
  console.error('\n❌ Fatal error registering handlers:', err);
  process.exit(1);
}

// Dump the real, currently-live channel -> source-file map as JSON and exit,
// without ever binding a port. Used by @usebruno/rpc-contract's
// scripts/audit-parity.js to detect drift between the committed channel
// fixture/constants and the handlers bruno-electron actually registers —
// see Improvement.md P0.5. Never set this in normal operation.
if (process.env.BRUNO_RPC_CONTRACT_DUMP === 'true') {
  const describeChannel = (channel) => ({ channel, sourceFile: handlerRegistry.getChannelSource(channel) });
  const dump = [
    ...handlerRegistry.getChannels().map(describeChannel),
    ...handlerRegistry.getEventChannels().map(describeChannel)
  ];
  process.stdout.write(JSON.stringify(dump));
  process.exit(0);
}

server.listen(PORT, HOST, () => {
  console.log(`\n✅ Bruno Bridge Server running on http://${HOST}:${PORT}${BASE_PATH}`);
  console.log(`   WebSocket events on ws://${HOST}:${PORT}${BASE_PATH}/ws/events`);
  console.log(`   Health check: http://${HOST}:${PORT}${BASE_PATH}/api/health`);
  console.log(`   IPC channels: http://${HOST}:${PORT}${BASE_PATH}/api/ipc/channels\n`);

  if (isAuthRequired()) {
    console.log('🔐 Authentication is REQUIRED (BRUNO_SERVER_REQUIRE_AUTH=true)');
    console.log(`   Bootstrap token (enter this in the browser when prompted):\n`);
    console.log(`   ${bootstrapToken}\n`);
    console.log('   This token is only shown once. Restart the server to generate a new one.\n');
  }
});

// Graceful shutdown (Improvement.md P1.3): stop accepting new connections,
// then tear down every resource the Bridge may be holding on behalf of
// connected sessions — terminals, WS/gRPC connections, filesystem watchers,
// and the event-bridge WebSocket server — before exiting. A hard timeout
// guards against any single step hanging forever.
const SHUTDOWN_TIMEOUT_MS = 10000;
let isShuttingDown = false;

const shutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal}, shutting down Bruno Bridge Server gracefully...`);

  const forceExitTimer = setTimeout(() => {
    console.error('⚠️  Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref?.();

  // server.close() synchronously stops accepting new connections but its
  // callback only fires once every connection on the underlying HTTP server
  // has ended — including the long-lived upgraded sockets that WS clients
  // hold open indefinitely. Kick it off now (so no new work comes in) but
  // don't await it until after eventBridge.close() has terminated those WS
  // sockets below, or a single connected browser tab would hang this whole
  // function until the timeout.
  const httpClosed = new Promise((resolve) => server.close(resolve));

  try {
    terminalManager?.killAll();
    console.log('  ✅ Terminals closed');
  } catch (err) {
    console.error('  ⚠️  Error closing terminals:', redactSecrets(err.message));
  }

  try {
    wsEventHandlers?.closeAllConnections?.();
    grpcEventHandlers?.closeAllConnections?.();
    console.log('  ✅ WebSocket/gRPC connections closed');
  } catch (err) {
    console.error('  ⚠️  Error closing WebSocket/gRPC connections:', redactSecrets(err.message));
  }

  try {
    await Promise.allSettled([
      collectionWatcher?.closeAllWatchers?.(),
      workspaceWatcher?.closeAllWatchers?.()
    ]);
    console.log('  ✅ Filesystem watchers closed');
  } catch (err) {
    console.error('  ⚠️  Error closing filesystem watchers:', redactSecrets(err.message));
  }

  try {
    await eventBridge.close();
    console.log('  ✅ Event bridge closed');
  } catch (err) {
    console.error('  ⚠️  Error closing event bridge:', redactSecrets(err.message));
  }

  try {
    await httpClosed;
    console.log('  ✅ HTTP server closed (no new connections accepted)');
  } catch (err) {
    console.error('  ⚠️  Error closing HTTP server:', redactSecrets(err.message));
  }

  clearTimeout(forceExitTimer);
  console.log('👋 Shutdown complete');
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
