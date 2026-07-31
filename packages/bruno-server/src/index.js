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
const express = require('express');
const cors = require('cors');

const { EventBridge } = require('./ws/event-bridge');
const { WindowShim, createFakeEvent } = require('./adapters/window-shim');
const { HandlerRegistry } = require('./handler-registry');
const { createIpcProxyRouter } = require('./routes/ipc-proxy');
const { createAuthRouter } = require('./routes/auth');
const { createAdminRouter } = require('./routes/admin');
const { isOriginAllowed } = require('./security/origin-policy');
const { isAuthRequired, requireAuth, bootstrapToken } = require('./security/auth');
const { validateStartupConfig } = require('./config-validation');
const { getBuildInfo } = require('./health');

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

// --- Initialize core components ---

const app = express();
const server = http.createServer(app);

// Event bridge for WebSocket push events
const eventBridge = new EventBridge();
eventBridge.attach(server);

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
  credentials: true
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
        userData: path.join(os.homedir(), '.config', 'bruno'),
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
    addRecentDocument: () => {}
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
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => Buffer.from(value)
  },
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
    console.warn('  ⚠️  Failed to load filesystem handlers:', err.message);
  }

  try {
    // Preferences handlers
    const registerPreferencesIpc = require(path.join(electronSrcPath, 'ipc/preferences'));
    registerPreferencesIpc(windowShim);
    console.log('  ✅ Preferences handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load preferences handlers:', err.message);
  }

  try {
    // Snapshot handlers
    const registerSnapshotIpc = require(path.join(electronSrcPath, 'ipc/snapshot'));
    registerSnapshotIpc();
    console.log('  ✅ Snapshot handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load snapshot handlers:', err.message);
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
    console.warn('  ⚠️  Failed to load network handlers:', err.message);
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
    console.warn('  ⚠️  Failed to load collection handlers:', err.message);
  }

  try {
    // Workspace handlers
    const registerWorkspaceIpc = require(path.join(electronSrcPath, 'ipc/workspace'));
    const WorkspaceWatcher = require(path.join(electronSrcPath, 'app/workspace-watcher'));
    workspaceWatcher = new WorkspaceWatcher();
    registerWorkspaceIpc(windowShim, workspaceWatcher);
    console.log('  ✅ Workspace handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load workspace handlers:', err.message);
  }

  try {
    // Global environments handlers
    const registerGlobalEnvironmentsIpc = require(path.join(electronSrcPath, 'ipc/global-environments'));
    const { globalEnvironmentsManager } = require(path.join(electronSrcPath, 'store/workspace-environments'));
    registerGlobalEnvironmentsIpc(windowShim, globalEnvironmentsManager);
    console.log('  ✅ Global environments handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load global environments handlers:', err.message);
  }

  try {
    // Git handlers
    const registerGitIpc = require(path.join(electronSrcPath, 'ipc/git'));
    registerGitIpc(windowShim);
    console.log('  ✅ Git handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load git handlers:', err.message);
  }

  try {
    // System monitor handlers
    const registerSystemMonitorIpc = require(path.join(electronSrcPath, 'ipc/system-monitor'));
    const SystemMonitor = require(path.join(electronSrcPath, 'app/system-monitor'));
    const systemMonitor = new SystemMonitor();
    registerSystemMonitorIpc(windowShim, systemMonitor);
    console.log('  ✅ System monitor handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load system monitor handlers:', err.message);
  }

  try {
    // Notifications handlers
    const registerNotificationsIpc = require(path.join(electronSrcPath, 'ipc/notifications'));
    const collectionWatcher = require(path.join(electronSrcPath, 'app/collection-watcher'));
    registerNotificationsIpc(windowShim, collectionWatcher);
    console.log('  ✅ Notifications handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load notifications handlers:', err.message);
  }

  try {
    // API Spec handlers and filesystem watcher
    const registerApiSpecIpc = require(path.join(electronSrcPath, 'ipc/apiSpec'));
    const ApiSpecWatcher = require(path.join(electronSrcPath, 'app/apiSpecsWatcher'));
    registerApiSpecIpc(windowShim, new ApiSpecWatcher());
    console.log('  ✅ API Spec handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load API Spec handlers:', err.message);
  }

  try {
    // OpenAPI synchronization handlers
    const registerOpenAPISyncIpc = require(path.join(electronSrcPath, 'ipc/openapi-sync'));
    registerOpenAPISyncIpc(windowShim);
    console.log('  ✅ OpenAPI Sync handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load OpenAPI Sync handlers:', err.message);
  }

  try {
    // AI chat, generation and provider configuration handlers
    const registerAiIpc = require(path.join(electronSrcPath, 'ipc/ai'));
    registerAiIpc(windowShim);
    console.log('  ✅ AI handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load AI handlers:', err.message);
  }

  try {
    const registerAiAutocompleteIpc = require(path.join(electronSrcPath, 'ipc/ai/autocomplete'));
    registerAiAutocompleteIpc(windowShim);
    console.log('  ✅ AI Autocomplete handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load AI Autocomplete handlers:', err.message);
  }

  try {
    // TerminalManager registers its IPC handlers in the constructor.
    const TerminalManager = require(path.join(electronSrcPath, 'ipc/terminal'));
    terminalManager = new TerminalManager();
    console.log('  ✅ Terminal handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load Terminal handlers:', err.message);
  }

  try {
    // Mount handlers
    const { registerMountIpc } = require(path.join(electronSrcPath, 'ipc/mount'));
    registerMountIpc();
    console.log('  ✅ Mount handlers registered');
  } catch (err) {
    console.warn('  ⚠️  Failed to load mount handlers:', err.message);
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

app.use('/api/auth', createAuthRouter(handlerRegistry, windowShim, createFakeEvent, getCollectionWatcher));
app.use('/api/ipc', requireAuth, createIpcProxyRouter(handlerRegistry, windowShim, createFakeEvent));
app.use('/api/admin', requireAuth, createAdminRouter());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'bridge-server',
    channels: handlerRegistry.getChannels().length,
    wsClients: eventBridge.clientCount
  });
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
  console.log(`\n✅ Bruno Bridge Server running on http://${HOST}:${PORT}`);
  console.log(`   WebSocket events on ws://${HOST}:${PORT}/ws/events`);
  console.log(`   Health check: http://${HOST}:${PORT}/api/health`);
  console.log(`   IPC channels: http://${HOST}:${PORT}/api/ipc/channels\n`);

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
    console.error('  ⚠️  Error closing terminals:', err.message);
  }

  try {
    wsEventHandlers?.closeAllConnections?.();
    grpcEventHandlers?.closeAllConnections?.();
    console.log('  ✅ WebSocket/gRPC connections closed');
  } catch (err) {
    console.error('  ⚠️  Error closing WebSocket/gRPC connections:', err.message);
  }

  try {
    await Promise.allSettled([
      collectionWatcher?.closeAllWatchers?.(),
      workspaceWatcher?.closeAllWatchers?.()
    ]);
    console.log('  ✅ Filesystem watchers closed');
  } catch (err) {
    console.error('  ⚠️  Error closing filesystem watchers:', err.message);
  }

  try {
    await eventBridge.close();
    console.log('  ✅ Event bridge closed');
  } catch (err) {
    console.error('  ⚠️  Error closing event bridge:', err.message);
  }

  try {
    await httpClosed;
    console.log('  ✅ HTTP server closed (no new connections accepted)');
  } catch (err) {
    console.error('  ⚠️  Error closing HTTP server:', err.message);
  }

  clearTimeout(forceExitTimer);
  console.log('👋 Shutdown complete');
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
