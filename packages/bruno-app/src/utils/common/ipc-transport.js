/**
 * IPC Transport Abstraction Layer
 *
 * Provides a unified interface for IPC communication that works in both
 * Electron and browser environments. Auto-detects the runtime and selects
 * the appropriate transport.
 *
 * Usage:
 *   import { transport } from 'utils/common/ipc-transport';
 *   const result = await transport.invoke('channel-name', arg1, arg2);
 *   const unsub = transport.on('event-name', handler);
 */

// Reverse proxy base path (Improvement.md P1.3) — set only when the Bridge
// serves this same build of bruno-app itself, injected into index.html as
// `window.__BRUNO_RUNTIME_CONFIG__` (see bruno-server/src/index.js and
// static-frontend.js). Absent when the frontend is hosted separately from
// the Bridge (dev server, CDN, etc.), in which case there is no base path
// to know about and every request goes to the origin root, same as before
// this existed.
const RUNTIME_CONFIG = (typeof window !== 'undefined' && window.__BRUNO_RUNTIME_CONFIG__) || null;

const BRIDGE_SERVER_URL = RUNTIME_CONFIG
  ? `${window.location.protocol}//${window.location.host}${RUNTIME_CONFIG.basePath || ''}`
  : typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:${window.__BRUNO_SERVER_PORT__ || 4000}`
    : 'http://localhost:4000';

const WS_URL = BRIDGE_SERVER_URL.replace(/^http/, 'ws');

/**
 * Bridge auth (Improvement.md P0.1) — a no-op when the server doesn't have
 * BRUNO_SERVER_REQUIRE_AUTH=true (the default). When it does, GET /api/auth/status
 * reports that, and every IPC call must carry a CSRF header obtained by
 * exchanging a one-time bootstrap token (shown in the bridge server's
 * console) for a session. The session itself lives in an HttpOnly cookie
 * the browser attaches automatically; only the CSRF token needs to be kept
 * in JS, and it's cached in sessionStorage so a page reload doesn't force
 * re-entering the token while the underlying session cookie is still valid.
 */
const CSRF_STORAGE_KEY = 'bruno_bridge_csrf_token';
let _csrfToken = typeof window !== 'undefined' ? window.sessionStorage?.getItem(CSRF_STORAGE_KEY) || null : null;
let _authCheckPromise = null;

async function promptForBootstrapToken() {
  while (true) {
    const token = window.prompt(
      'This Bruno Bridge server requires authentication.\nEnter the bootstrap token printed in the bridge server console:',
      ''
    );
    if (token === null) throw new Error('Bridge authentication cancelled');

    const response = await fetch(`${BRIDGE_SERVER_URL}/api/auth/session`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() })
    });

    if (response.ok) {
      const data = await response.json();
      _csrfToken = data.csrfToken;
      window.sessionStorage?.setItem(CSRF_STORAGE_KEY, _csrfToken);
      return;
    }

    window.alert('Invalid bootstrap token, please try again.');
  }
}

/**
 * Resolves once we know whether the bridge requires auth, and if so, once
 * we hold a usable CSRF token for the current session. Cached forever after
 * the first successful check — a 401 from an actual IPC call (session
 * expired server-side) triggers a fresh check via _reauthenticate().
 */
function ensureBridgeAuth() {
  if (_authCheckPromise) return _authCheckPromise;

  _authCheckPromise = (async () => {
    const response = await fetch(`${BRIDGE_SERVER_URL}/api/auth/status`, { credentials: 'include' });
    const status = await response.json();

    if (!status.authRequired) return;
    if (status.authenticated && _csrfToken) return;

    await promptForBootstrapToken();
  })();

  return _authCheckPromise;
}

function forgetBridgeAuth() {
  _csrfToken = null;
  window.sessionStorage?.removeItem(CSRF_STORAGE_KEY);
  _authCheckPromise = null;
}

/**
 * Connection & Recovery UX (Improvement.md P1.2) — connection-quality state
 * exposed by BrowserTransport, for a UI indicator to render.
 *   CONNECTING — actively attempting the WebSocket handshake (initial or retry)
 *   ONLINE     — connected and the application-level heartbeat is healthy
 *   DEGRADED   — connected but at least one heartbeat pong is overdue; the
 *                socket may be silently dead (routers/proxies can hold a TCP
 *                connection open long after the peer is gone)
 *   OFFLINE    — disconnected, waiting for the next backoff-scheduled retry
 */
export const CONNECTION_STATE = {
  CONNECTING: 'connecting',
  ONLINE: 'online',
  DEGRADED: 'degraded',
  OFFLINE: 'offline'
};

// Reconnect backoff: exponential with a cap, doubling per attempt.
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 30000;

// Application-level heartbeat: the browser's native WebSocket API never
// surfaces protocol-level ping/pong frames to JS (they're answered
// automatically below the JS layer), so staleness detection needs its own
// ping/pong message pair — see the `type: 'ping'`/`'pong'` handling below and
// the matching reply in bruno-server's event-bridge.js.
export const HEARTBEAT_INTERVAL_MS = 15000;
export const HEARTBEAT_MAX_MISSED = 2;

// Client-side safety net for invoke()/send() HTTP calls (Improvement.md P1.2).
// Deliberately set above the server's own execution timeout (ipc-limits.js,
// default 30000ms via BRUNO_SERVER_IPC_TIMEOUT_MS) so a normal slow handler
// gets a chance to finish and return its own clear 504 first; this only
// fires for requests that never get a response at all — a dropped
// connection, a proxy black hole, a browser tab suspended mid-request, etc.
export const INVOKE_TIMEOUT_MS = 45000;

function generateRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Thrown when an invoke()/send() HTTP call is aborted for exceeding
 * INVOKE_TIMEOUT_MS. Carries the same requestId sent in the X-Request-Id
 * header, so a hung request can be correlated with bruno-server's console
 * output (see ipc-proxy.js, which logs and echoes back the same id).
 */
export class IpcTimeoutError extends Error {
  constructor(channel, requestId, timeoutMs) {
    super(`Request to channel "${channel}" timed out after ${timeoutMs}ms (requestId=${requestId})`);
    this.name = 'IpcTimeoutError';
    this.channel = channel;
    this.requestId = requestId;
  }
}

/**
 * Electron Transport — delegates directly to window.ipcRenderer
 * (the existing preload.js bridge)
 */
class ElectronTransport {
  get isElectron() {
    return true;
  }

  invoke(channel, ...args) {
    return window.ipcRenderer.invoke(channel, ...args);
  }

  on(channel, handler) {
    return window.ipcRenderer.on(channel, handler);
  }

  send(channel, ...args) {
    return window.ipcRenderer.send(channel, ...args);
  }

  getFilePath(file) {
    return window.ipcRenderer.getFilePath(file);
  }

  openExternal(url) {
    return window.ipcRenderer.openExternal(url);
  }

  // Electron's IPC is a direct in-process channel with no network hop, so
  // there's nothing to degrade — always report ONLINE for API parity with
  // BrowserTransport (Improvement.md P1.2 connection indicator).
  getConnectionState() {
    return CONNECTION_STATE.ONLINE;
  }

  onConnectionStateChange(handler) {
    handler(CONNECTION_STATE.ONLINE);
    return () => {};
  }
}

/**
 * Browser Transport — uses HTTP fetch + WebSocket to communicate
 * with the Bruno bridge server (bruno-server package)
 */
class BrowserTransport {
  constructor() {
    this._ws = null;
    this._listeners = new Map(); // channel -> Set<handler>
    this._wsReady = false;
    // channel -> 'subscribe' | 'unsubscribe', flushed once the WS reconnects.
    // A Map (rather than an array of raw messages) naturally dedupes and
    // bounds the queue: repeatedly toggling the same channel while offline
    // just overwrites its pending action instead of piling up messages, and
    // the size is capped by the number of distinct channels ever toggled —
    // a small, fixed set of IPC event names, not user/request-driven.
    this._wsQueue = new Map();
    this._reconnectAttempts = 0;
    // Keep retrying like Electron's persistent main-process connection. The
    // bridge may be restarted independently during local development.
    this._maxReconnectAttempts = Number.POSITIVE_INFINITY;
    this._zoomPercentage = 100;
    this._connectionState = CONNECTION_STATE.CONNECTING;
    this._connectionStateListeners = new Set();
    this._heartbeatInterval = null;
    this._awaitingPong = false;
    this._missedHeartbeats = 0;
    this._connectWebSocket();
  }

  get isElectron() {
    return false;
  }

  getConnectionState() {
    return this._connectionState;
  }

  /**
   * Subscribes to connection-state changes (Improvement.md P1.2), e.g. for a
   * Connecting/Online/Degraded/Offline UI indicator. The handler is called
   * immediately with the current state, then again on every transition.
   * Returns an unsubscribe function.
   */
  onConnectionStateChange(handler) {
    this._connectionStateListeners.add(handler);
    handler(this._connectionState);
    return () => this._connectionStateListeners.delete(handler);
  }

  _setConnectionState(state) {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this._connectionStateListeners.forEach((handler) => {
      try {
        handler(state);
      } catch (err) {
        console.error('[BrowserTransport] Error in connection state handler:', err);
      }
    });
  }

  _connectWebSocket() {
    this._setConnectionState(CONNECTION_STATE.CONNECTING);
    try {
      this._ws = new WebSocket(`${WS_URL}/ws/events`);

      this._ws.onopen = () => {
        this._wsReady = true;
        this._reconnectAttempts = 0;
        this._setConnectionState(CONNECTION_STATE.ONLINE);
        console.log('[BrowserTransport] WebSocket connected');

        // A reconnect creates a new server-side client, so restore every
        // subscription registered by the renderer. Electron listeners remain
        // active across a renderer/main-process transport interruption and the
        // browser transport should provide the same behaviour.
        for (const channel of this._listeners.keys()) {
          this._ws.send(JSON.stringify({ type: 'subscribe', channel }));
        }

        // Flush the queued subscribe/unsubscribe actions accumulated while offline
        for (const [channel, action] of this._wsQueue) {
          this._ws.send(JSON.stringify({ type: action, channel }));
        }
        this._wsQueue.clear();

        this._startHeartbeat();
      };

      this._ws.onmessage = (event) => {
        let parsed;
        try {
          parsed = JSON.parse(event.data);
        } catch (err) {
          console.error('[BrowserTransport] Failed to parse WebSocket message:', err);
          return;
        }

        if (parsed.type === 'pong') {
          this._handlePong();
          return;
        }

        const { channel, data } = parsed;
        const handlers = this._listeners.get(channel);
        if (handlers) {
          handlers.forEach((handler) => {
            try {
              if (Array.isArray(data)) {
                handler(...data);
              } else {
                handler(data);
              }
            } catch (err) {
              console.error(`[BrowserTransport] Error in handler for "${channel}":`, err);
            }
          });
        }
      };

      this._ws.onclose = () => {
        this._wsReady = false;
        this._stopHeartbeat();
        this._setConnectionState(CONNECTION_STATE.OFFLINE);
        console.warn('[BrowserTransport] WebSocket disconnected');
        this._attemptReconnect();
      };

      this._ws.onerror = (err) => {
        console.error('[BrowserTransport] WebSocket error:', err);
      };
    } catch (err) {
      console.error('[BrowserTransport] Failed to create WebSocket:', err);
      this._setConnectionState(CONNECTION_STATE.OFFLINE);
      this._attemptReconnect();
    }
  }

  /**
   * Application-level heartbeat (Improvement.md P1.2). The browser's native
   * WebSocket API never surfaces protocol ping/pong frames to JS, so this
   * sends its own `{type: 'ping'}` message every HEARTBEAT_INTERVAL_MS and
   * expects event-bridge.js to reply with `{type: 'pong'}`. Missing one
   * pong marks the connection DEGRADED (still usable, but a proxy/router may
   * be silently holding a dead socket open); missing HEARTBEAT_MAX_MISSED in
   * a row forces a close, which triggers the normal reconnect flow.
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._awaitingPong = false;
    this._missedHeartbeats = 0;
    this._heartbeatInterval = setInterval(() => {
      if (this._awaitingPong) {
        this._missedHeartbeats++;
        console.warn(`[BrowserTransport] Missed heartbeat pong (${this._missedHeartbeats})`);
        if (this._missedHeartbeats >= HEARTBEAT_MAX_MISSED) {
          console.error('[BrowserTransport] Connection appears stale, forcing reconnect');
          this._ws?.close();
          return;
        }
        this._setConnectionState(CONNECTION_STATE.DEGRADED);
      }

      if (this._wsReady && this._ws) {
        this._awaitingPong = true;
        try {
          this._ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        } catch (err) {
          // A genuinely dead socket will fire onclose/onerror on its own.
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  _handlePong() {
    this._awaitingPong = false;
    if (this._missedHeartbeats > 0) {
      this._missedHeartbeats = 0;
      if (this._wsReady) this._setConnectionState(CONNECTION_STATE.ONLINE);
    }
  }

  _attemptReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.error('[BrowserTransport] Max reconnect attempts reached');
      return;
    }
    this._reconnectAttempts++;
    const exponentialDelay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this._reconnectAttempts - 1)
    );
    // Half jitter: never collapses to ~0 delay, but still prevents every tab
    // from retrying in lockstep after a shared bridge-server restart.
    const delay = Math.round(exponentialDelay / 2 + Math.random() * (exponentialDelay / 2));
    console.log(`[BrowserTransport] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts})`);
    setTimeout(() => this._connectWebSocket(), delay);
  }

  /**
   * invoke(channel, ...args) — equivalent to ipcRenderer.invoke()
   * Makes a POST request to the bridge server and returns the result.
   */
  async invoke(channel, ...args) {
    const promptForPath = (message) => {
      const value = window.prompt(message, '');
      return typeof value === 'string' ? value.trim() : '';
    };

    if (channel === 'renderer:browse-directory') {
      const selectedPath = promptForPath('Enter a directory path on the Bruno bridge server:');
      if (!selectedPath) return false;
      return (await this.invoke('renderer:is-directory', selectedPath)) ? selectedPath : false;
    }

    if (channel === 'renderer:browse-files') {
      const value = promptForPath('Enter file path(s) on the Bruno bridge server, separated by new lines:');
      if (!value) return [];
      const paths = value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
      const valid = await Promise.all(paths.map(async (filePath) => (await this.invoke('renderer:exists-sync', filePath)) ? filePath : null));
      return valid.filter(Boolean);
    }

    if (channel === 'renderer:open-collection') {
      const value = promptForPath('Enter collection folder path(s) on the Bruno bridge server, separated by new lines:');
      if (!value) return;
      const paths = value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
      return this.invoke('renderer:open-multiple-collections', paths, args[0] || {});
    }

    if (channel === 'renderer:open-workspace-dialog') {
      const selectedPath = promptForPath('Enter a workspace folder path on the Bruno bridge server:');
      return selectedPath ? this.invoke('renderer:open-workspace', selectedPath) : null;
    }

    if (channel === 'renderer:open-api-spec') {
      const selectedPath = promptForPath('Enter an OpenAPI file path on the Bruno bridge server:');
      return selectedPath ? this.invoke('renderer:open-api-spec-file', selectedPath, args[0] || null) : null;
    }

    if (channel === 'renderer:load-gql-schema-file' || channel === 'renderer:browse-pac-file') {
      const selectedPath = promptForPath('Enter a file path on the Bruno bridge server:');
      if (!selectedPath) return null;
      args = [selectedPath];
    }

    if (['renderer:export-collection-zip', 'renderer:export-workspace'].includes(channel)) {
      const suggestedName = String(args[1] || 'export').replace(/[^a-zA-Z0-9._-]/g, '_') + '.zip';
      const destinationPath = promptForPath('Enter the destination ZIP path on the Bruno bridge server (for example: /tmp/' + suggestedName + '):');
      if (!destinationPath) return { success: false, canceled: true };
      args.push(destinationPath);
    }

    if (channel === 'renderer:save-response-to-file') {
      const destinationPath = promptForPath('Enter the destination file path on the Bruno bridge server:');
      if (!destinationPath) return { success: false, cancelled: true };
      args.push(destinationPath);
    }

    if (channel === 'renderer:open-docs') {
      return this.openExternal('https://docs.usebruno.com');
    }

    if (channel === 'renderer:open-about') {
      window.alert('Bruno v2.0.0');
      return { version: '2.0.0' };
    }

    if (channel === 'renderer:window-is-fullscreen') {
      return Boolean(document.fullscreenElement);
    }

    if (channel === 'renderer:toggle-fullscreen') {
      return document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    }

    if (channel === 'renderer:reset-zoom') this._zoomPercentage = 100;
    if (channel === 'renderer:zoom-in') this._zoomPercentage = Math.min(200, this._zoomPercentage + 10);
    if (channel === 'renderer:zoom-out') this._zoomPercentage = Math.max(50, this._zoomPercentage - 10);
    if (['renderer:reset-zoom', 'renderer:zoom-in', 'renderer:zoom-out'].includes(channel)) {
      document.documentElement.style.zoom = String(this._zoomPercentage / 100);
      return;
    }

    try {
      await ensureBridgeAuth();

      let response = await this._fetchIpc(channel, args);

      if (response.status === 401) {
        // Session likely expired server-side (or auth was just turned on) —
        // force a fresh bootstrap-token prompt and retry exactly once.
        forgetBridgeAuth();
        await ensureBridgeAuth();
        response = await this._fetchIpc(channel, args);
      }

      const result = await response.json();

      if (!response.ok || result.error) {
        const error = new Error(result.error || result.message || `IPC call "${channel}" failed`);
        if (result.stack) {
          error.stack = result.stack;
        }
        if (result.requestId) {
          error.requestId = result.requestId;
        }
        throw error;
      }

      return result.data;
    } catch (err) {
      if (err.message && !err.message.includes('IPC call')) {
        console.error(`[BrowserTransport] invoke("${channel}") failed:`, err);
      }
      throw err;
    }
  }

  /**
   * Shared fetch call for invoke()/send() (Improvement.md P1.2): attaches
   * the CSRF header (a no-op when the bridge doesn't require auth, since
   * _csrfToken stays null) and credentials so the HttpOnly session cookie
   * round-trips, a per-call X-Request-Id for correlating a hung request with
   * bruno-server's console (see ipc-proxy.js), and an AbortController tied
   * to INVOKE_TIMEOUT_MS so a request that never gets a response doesn't
   * hang forever.
   */
  _fetchIpc(channel, args, extra = {}) {
    const requestId = generateRequestId();
    const headers = { 'Content-Type': 'application/json', 'X-Request-Id': requestId };
    if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), INVOKE_TIMEOUT_MS);

    return fetch(`${BRIDGE_SERVER_URL}/api/ipc/${encodeURIComponent(channel)}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ args, ...extra }),
      signal: controller.signal
    })
      .catch((err) => {
        if (err.name === 'AbortError') {
          throw new IpcTimeoutError(channel, requestId, INVOKE_TIMEOUT_MS);
        }
        throw err;
      })
      .finally(() => clearTimeout(timeoutId));
  }

  /**
   * on(channel, handler) — equivalent to ipcRenderer.on()
   * Subscribes to WebSocket events from the bridge server.
   * Returns an unsubscribe function.
   */
  on(channel, handler) {
    if (!this._listeners.has(channel)) {
      this._listeners.set(channel, new Set());
    }
    this._listeners.get(channel).add(handler);

    // Tell the server we want events for this channel
    if (this._wsReady && this._ws) {
      this._ws.send(JSON.stringify({ type: 'subscribe', channel }));
    } else {
      this._wsQueue.set(channel, 'subscribe');
    }

    // Return unsubscribe function (matches Electron API)
    return () => {
      const handlers = this._listeners.get(channel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this._listeners.delete(channel);
          // Unsubscribe from server
          if (this._wsReady && this._ws) {
            this._ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
          } else {
            this._wsQueue.set(channel, 'unsubscribe');
          }
        }
      }
    };
  }

  removeAllListeners(channel) {
    if (!channel) {
      this._listeners.clear();
      return;
    }

    this._listeners.delete(channel);
    if (this._wsReady && this._ws) {
      this._ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
    } else {
      this._wsQueue.set(channel, 'unsubscribe');
    }
  }

  /**
   * send(channel, ...args) — equivalent to ipcRenderer.send()
   * Fire-and-forget message to the server.
   */
  send(channel, ...args) {
    if (channel === 'renderer:window-maximize') {
      this.invoke('renderer:toggle-fullscreen').catch(() => {});
      return;
    }
    if (channel === 'renderer:window-close') {
      window.close();
      return;
    }
    if (channel === 'renderer:window-minimize') {
      return;
    }

    ensureBridgeAuth()
      .then(() => this._fetchIpc(channel, args, { fireAndForget: true }))
      .catch((err) => {
        console.error(`[BrowserTransport] send("${channel}") failed:`, err);
      });
  }

  /**
   * getFilePath(file) — browser fallback for Electron's webUtils.getPathForFile
   * In the browser, we return the file name since we don't have real path access.
   */
  getFilePath(file) {
    return file.name || file.path || '';
  }

  /**
   * openExternal(url) — browser fallback for shell.openExternal
   */
  openExternal(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  }
}

// --- Singleton Transport Instance ---

let _transport = null;

/**
 * Get the singleton transport instance.
 * Auto-detects Electron (window.ipcRenderer exists) vs Browser mode.
 */
export const getTransport = () => {
  if (_transport) return _transport;

  if (typeof window !== 'undefined' && window.ipcRenderer) {
    _transport = new ElectronTransport();
    console.log('[IPC Transport] Using Electron mode');
  } else {
    _transport = new BrowserTransport();
    // Some renderer paths still use the Electron preload API directly. Expose
    // the compatible transport so those paths also work in Browser Mode.
    window.ipcRenderer = _transport;
    console.log('[IPC Transport] Using Browser mode (bridge server)');
  }

  return _transport;
};

/**
 * The default transport instance — auto-initialized on first access.
 */
export const transport = new Proxy({}, {
  get(target, prop) {
    const t = getTransport();
    const value = t[prop];
    if (typeof value === 'function') {
      return value.bind(t);
    }
    return value;
  }
});

/**
 * Check if we're running in Electron mode.
 */
export const isElectronMode = () => {
  return getTransport().isElectron;
};

export { ElectronTransport, BrowserTransport };
