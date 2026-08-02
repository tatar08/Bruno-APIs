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

// Channels retryableInvoke() (below) will attach a stable idempotency key
// to and retry on network failure (Improvement.md P1.2) — a hand-picked
// allowlist of pure creates identified by a name/path the handler already
// treats as unique, so replaying the original response on retry is always
// safe. Kept in sync by hand with IDEMPOTENT_CHANNELS in bruno-server's
// security/idempotency.js; duplicated here as plain literals rather than
// pulling in a new @usebruno/rpc-contract dependency (and the build/jest
// wiring that would need) for bruno-app just for this short, stable list.
const IDEMPOTENT_CHANNELS = new Set([
  'renderer:new-request',
  'renderer:new-folder',
  'renderer:clone-folder',
  'renderer:create-environment',
  'renderer:create-global-environment',
  'renderer:import-collection',
  'renderer:import-collection-zip'
]);

export const RETRYABLE_INVOKE_MAX_ATTEMPTS = 3;
export const RETRYABLE_INVOKE_RETRY_DELAY_MS = 500;

// fetch() itself throws a TypeError (e.g. "Failed to fetch") for a genuine
// network-level failure (DNS, connection refused, offline) as opposed to
// an HTTP error response, which resolves normally instead of throwing.
function isRetryableNetworkFailure(err) {
  return err instanceof IpcTimeoutError || err instanceof TypeError;
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
 * Thrown by uploadZipFile()/downloadWithProgress() (Improvement.md P1.1
 * Transfer Center progress/cancel) when the caller aborts an in-flight
 * transfer via its AbortSignal — distinguished from a real network/server
 * failure so callers can skip showing an error toast for a user-initiated
 * cancel.
 */
export class TransferCancelledError extends Error {
  constructor(message = 'Transfer cancelled') {
    super(message);
    this.name = 'TransferCancelledError';
  }
}

/**
 * Thrown by uploadZipFile()/downloadWithProgress()/_downloadViaBridge()
 * (Improvement.md P1.1 Transfer Center checksums) when the SHA-256 digest
 * computed client-side from the transferred bytes doesn't match the digest
 * the Bridge computed server-side — signals in-transit corruption/truncation
 * distinct from a network/server-error failure, so callers can surface a
 * "try again" message rather than a generic error toast.
 */
export class TransferIntegrityError extends Error {
  constructor(message = 'Transferred file failed integrity verification (checksum mismatch)') {
    super(message);
    this.name = 'TransferIntegrityError';
  }
}

/**
 * Computes a lowercase hex SHA-256 digest of a Blob/File via the Web Crypto
 * API. Both uploadZipFile()'s File and downloadWithProgress()'s constructed
 * Blob are always fully materialized in memory before this is called, so a
 * one-shot digest() call is sufficient — no streaming/incremental hashing is
 * needed at this scale (Transfer Center files are scratch zips, not
 * multi-gigabyte payloads).
 */
async function sha256Hex(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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

  // Electron already has a real local path for any picked/dropped file
  // (webUtils.getPathForFile via getFilePath) — there's nothing to upload,
  // so there's no meaningful progress to report and nothing to cancel.
  uploadZipFile(file, _options) {
    return Promise.resolve(this.getFilePath(file));
  }

  openExternal(url) {
    return window.ipcRenderer.openExternal(url);
  }

  // Electron's IPC is a direct in-process channel with no network hop, so
  // there's nothing to retry — a failed call already failed for a reason
  // unrelated to a lost response (see BrowserTransport.retryableInvoke()).
  retryableInvoke(channel, ...args) {
    return this.invoke(channel, ...args);
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
        // browser transport should provide the same behaviour. Sent as a
        // single batched frame rather than one message per channel — the app
        // registers dozens of distinct event channels at mount, and one
        // message per channel used to blow past event-bridge.js's per-socket
        // message-rate limit on every single reconnect, closing the socket
        // again immediately and looping forever.
        const resubscribeChannels = [...this._listeners.keys()];
        if (resubscribeChannels.length) {
          this._ws.send(JSON.stringify({ type: 'subscribe-batch', channels: resubscribeChannels }));
        }

        // Any subscribe/unsubscribe queued while offline already mutated
        // this._listeners (the source of truth used above), so nothing
        // further needs to be sent for it here — a fresh server-side
        // connection also starts with an empty subscription set, making a
        // queued 'unsubscribe' a no-op regardless.
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
      if (typeof window.browseFolderOnBridge !== 'function') {
        const selectedPath = promptForPath('Enter a directory path on the Bruno bridge server:');
        if (!selectedPath) return false;
        return (await this.invoke('renderer:is-directory', selectedPath)) ? selectedPath : false;
      }
      try {
        const [selectedPath] = await window.browseFolderOnBridge({ title: 'Select Directory' });
        return selectedPath || false;
      } catch (err) {
        return false;
      }
    }

    if (channel === 'renderer:browse-files') {
      const [filters, properties] = args;
      if (typeof window.browseFilesOnBridge !== 'function') {
        const value = promptForPath('Enter file path(s) on the Bruno bridge server, separated by new lines:');
        if (!value) return [];
        const paths = value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
        const valid = await Promise.all(paths.map(async (filePath) => (await this.invoke('renderer:exists-sync', filePath)) ? filePath : null));
        return valid.filter(Boolean);
      }
      try {
        const selectedPaths = await window.browseFilesOnBridge({
          title: 'Select File(s)',
          multiple: Array.isArray(properties) && properties.includes('multiSelections'),
          filters: Array.isArray(filters) ? filters : []
        });
        return selectedPaths || [];
      } catch (err) {
        return [];
      }
    }

    if (channel === 'renderer:open-collection') {
      if (typeof window.browseFolderOnBridge !== 'function') {
        const value = promptForPath('Enter collection folder path(s) on the Bruno bridge server, separated by new lines:');
        if (!value) return;
        const paths = value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
        return this.invoke('renderer:open-multiple-collections', paths, args[0] || {});
      }
      try {
        const paths = await window.browseFolderOnBridge({ title: 'Select Collection Folder(s)', multiple: true });
        if (!paths?.length) return;
        return this.invoke('renderer:open-multiple-collections', paths, args[0] || {});
      } catch (err) {
        return;
      }
    }

    if (channel === 'renderer:open-workspace-dialog') {
      if (typeof window.browseFolderOnBridge !== 'function') {
        const selectedPath = promptForPath('Enter a workspace folder path on the Bruno bridge server:');
        return selectedPath ? this.invoke('renderer:open-workspace', selectedPath) : null;
      }
      try {
        const [selectedPath] = await window.browseFolderOnBridge({ title: 'Select Workspace Folder' });
        return selectedPath ? this.invoke('renderer:open-workspace', selectedPath) : null;
      } catch (err) {
        return null;
      }
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
      return this._downloadViaBridge(channel, [args[0], args[1]]);
    }

    if (channel === 'renderer:save-response-to-file') {
      return this._saveResponseToFileLocally(args[0], args[1], args[2]);
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
      return await this._dispatchIpc(channel, args);
    } catch (err) {
      if (err.message && !err.message.includes('IPC call')) {
        console.error(`[BrowserTransport] invoke("${channel}") failed:`, err);
      }
      throw err;
    }
  }

  /**
   * Shared request/response handling for invoke() and retryableInvoke():
   * runs _fetchIpc(), retries exactly once on a 401 (session expiry), and
   * turns a non-ok response / an { error } body into a thrown Error the
   * same way both callers expect. `extra` is forwarded into the request
   * body (e.g. { idempotencyKey } — see retryableInvoke()).
   */
  async _dispatchIpc(channel, args, extra = {}) {
    await ensureBridgeAuth();

    let response = await this._fetchIpc(channel, args, extra);

    if (response.status === 401) {
      // Session likely expired server-side (or auth was just turned on) —
      // force a fresh bootstrap-token prompt and retry exactly once.
      forgetBridgeAuth();
      await ensureBridgeAuth();
      response = await this._fetchIpc(channel, args, extra);
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
  }

  /**
   * retryableInvoke(channel, ...args) — like invoke(), but for the
   * hand-picked set of create/save channels in IDEMPOTENT_CHANNELS
   * (Improvement.md P1.2): attaches one idempotency key shared by every
   * attempt, and retries up to RETRYABLE_INVOKE_MAX_ATTEMPTS times on a
   * network-level failure (a request that never reached the server, or
   * whose response never came back — see isRetryableNetworkFailure()).
   * bruno-server replays the original response for a repeated
   * (channel, idempotencyKey) pair instead of re-running the handler, so a
   * retry after a lost response can't create a second duplicate resource.
   *
   * A real error response from the server (validation failure, disk error,
   * etc.) is never retried here — only the transport-level failure modes
   * above are, since a real failure may not be safe or useful to repeat
   * automatically. Channels outside the allowlist fall back to a plain,
   * single-attempt invoke() so callers don't need to check eligibility
   * themselves.
   */
  async retryableInvoke(channel, ...args) {
    if (!IDEMPOTENT_CHANNELS.has(channel)) {
      return this.invoke(channel, ...args);
    }

    const idempotencyKey = generateRequestId();
    let lastErr;

    for (let attempt = 1; attempt <= RETRYABLE_INVOKE_MAX_ATTEMPTS; attempt++) {
      try {
        return await this._dispatchIpc(channel, args, { idempotencyKey });
      } catch (err) {
        lastErr = err;

        if (!isRetryableNetworkFailure(err) || attempt === RETRYABLE_INVOKE_MAX_ATTEMPTS) {
          console.error(`[BrowserTransport] retryableInvoke("${channel}") failed after ${attempt} attempt(s):`, err);
          throw err;
        }

        console.warn(`[BrowserTransport] retryableInvoke("${channel}") attempt ${attempt} failed, retrying:`, err.message);
        await new Promise((resolve) => setTimeout(resolve, RETRYABLE_INVOKE_RETRY_DELAY_MS * attempt));
      }
    }

    throw lastErr;
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
   * Downloads a server-generated file (renderer:export-collection-zip /
   * renderer:export-workspace, Improvement.md P1.1 Transfer Center) via
   * POST /api/downloads/:channel and triggers a real browser save, instead
   * of writing to a path on the Bridge's own filesystem the browser has no
   * way to retrieve.
   */
  async _downloadViaBridge(channel, args) {
    await ensureBridgeAuth();

    const requestId = generateRequestId();
    const headers = { 'Content-Type': 'application/json', 'X-Request-Id': requestId };
    if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;

    const response = await fetch(`${BRIDGE_SERVER_URL}/api/downloads/${encodeURIComponent(channel)}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ args })
    });

    if (!response.ok) {
      let message = `Export failed (HTTP ${response.status})`;
      try {
        const body = await response.json();
        message = body.error || message;
      } catch (err) {}
      throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const fileName = match ? match[1] : `${String(args[1] || 'export').replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`;

    const expectedSha256 = response.headers.get('x-content-sha256');
    if (expectedSha256 && (await sha256Hex(blob)) !== expectedSha256) {
      throw new TransferIntegrityError();
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    return { success: true, filePath: fileName };
  }

  /**
   * Same as _downloadViaBridge() but reports download progress and supports
   * cancellation (Improvement.md P1.1 Transfer Center) — kept as a separate
   * public method rather than adding options to _downloadViaBridge/invoke()
   * because invoke()'s generic (channel, ...args) signature already treats a
   * trailing arg as a real handler argument (e.g. export's optional
   * destinationPath string), so there's no ambiguity-free way to smuggle an
   * options object through it. Callers that want progress/cancel call this
   * directly instead of going through invoke('renderer:export-collection-zip', ...).
   *
   * @param {string} channel one of DOWNLOADABLE_CHANNELS on the server
   * @param {any[]} args the handler's real arguments, e.g. [pathname, name]
   * @param {{ onProgress?: (percent: number|null) => void, signal?: AbortSignal }} [options]
   *   onProgress receives null when the response has no Content-Length
   *   (percent can't be computed), otherwise a 0-100 integer.
   */
  async downloadWithProgress(channel, args, { onProgress, signal } = {}) {
    await ensureBridgeAuth();

    const requestId = generateRequestId();
    const headers = { 'Content-Type': 'application/json', 'X-Request-Id': requestId };
    if (_csrfToken) headers['X-CSRF-Token'] = _csrfToken;

    let response;
    try {
      response = await fetch(`${BRIDGE_SERVER_URL}/api/downloads/${encodeURIComponent(channel)}`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ args }),
        signal
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new TransferCancelledError();
      throw err;
    }

    if (!response.ok) {
      let message = `Export failed (HTTP ${response.status})`;
      try {
        const body = await response.json();
        message = body.error || message;
      } catch (err) {}
      throw new Error(message);
    }

    const disposition = response.headers.get('content-disposition') || '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const fileName = match ? match[1] : `${String(args[1] || 'export').replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`;

    let blob;
    if (onProgress && response.body?.getReader) {
      const total = Number(response.headers.get('content-length')) || 0;
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          onProgress(total ? Math.round((received / total) * 100) : null);
        }
      } catch (err) {
        if (signal?.aborted || err.name === 'AbortError') throw new TransferCancelledError();
        throw err;
      }
      blob = new Blob(chunks);
    } else {
      blob = await response.blob();
    }

    const expectedSha256 = response.headers.get('x-content-sha256');
    if (expectedSha256 && (await sha256Hex(blob)) !== expectedSha256) {
      throw new TransferIntegrityError();
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    return { success: true, filePath: fileName };
  }

  /**
   * Saves a network response's bytes to disk (renderer:save-response-to-file,
   * Improvement.md P1.1 Transfer Center) entirely client-side — the response
   * bytes are already in the browser tab's memory (response.dataBuffer) by
   * the time this channel is invoked, so no Bridge round-trip is needed at
   * all, unlike export-collection-zip/export-workspace above.
   */
  _saveResponseToFileLocally(response, url, pathname) {
    const getHeaderValue = (headerName) => {
      const headersArray = typeof response?.headers === 'object' ? Object.entries(response.headers) : [];
      const header = headersArray.find(([key]) => key.toLowerCase() === headerName);
      return header ? header[1] : undefined;
    };

    const getFileNameFromContentDisposition = () => {
      const raw = getHeaderValue('content-disposition');
      if (!raw) return null;
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(raw);
      return match ? decodeURIComponent(match[1]) : null;
    };

    const getFileNameFromUrlPath = () => {
      try {
        const lastSegment = new URL(url).pathname.split('/').pop();
        return lastSegment && /\..+/.test(lastSegment) ? lastSegment : null;
      } catch (err) {
        return null;
      }
    };

    const fileName
      = getFileNameFromContentDisposition()
        || getFileNameFromUrlPath()
        || (pathname ? pathname.split(/[\\/]/).pop() : null)
        || 'response';

    const byteString = window.atob(response?.dataBuffer || '');
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);

    const objectUrl = URL.createObjectURL(new Blob([bytes]));
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    return { success: true, filePath: fileName };
  }

  /**
   * Uploads a browser File (drag-drop / <input type=file>) to the Bridge's
   * scratch directory via POST /api/uploads/scratch-file and returns a real
   * path on the Bridge — needed because channels like
   * renderer:import-collection-zip/renderer:import-workspace only accept a
   * path that already exists on the Bridge's filesystem, which a browser
   * File object never has (Improvement.md P1.1 Transfer Center). Scoped
   * narrowly to the zip-import call sites; other getFilePath() callers are
   * unaffected.
   */
  /**
   * @param {File} file
   * @param {{ onProgress?: (percent: number) => void, signal?: AbortSignal }} [options]
   *   onProgress is called with a 0-100 integer as upload bytes are sent —
   *   plain fetch() has no upload-progress event in any browser, hence
   *   XMLHttpRequest here instead of the fetch() used elsewhere in this file.
   *   signal lets the caller cancel a large in-flight upload (Improvement.md
   *   P1.1 Transfer Center).
   */
  async uploadZipFile(file, { onProgress, signal } = {}) {
    await ensureBridgeAuth();

    if (signal?.aborted) {
      throw new TransferCancelledError();
    }

    const formData = new FormData();
    formData.append('file', file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BRIDGE_SERVER_URL}/api/uploads/scratch-file`);
      xhr.withCredentials = true;
      if (_csrfToken) xhr.setRequestHeader('X-CSRF-Token', _csrfToken);

      const onAbort = () => xhr.abort();
      signal?.addEventListener('abort', onAbort);
      const cleanup = () => signal?.removeEventListener('abort', onAbort);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = async () => {
        cleanup();
        let body = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch (err) {}

        if (xhr.status >= 200 && xhr.status < 300) {
          if (body.sha256 && (await sha256Hex(file)) !== body.sha256) {
            reject(new TransferIntegrityError());
            return;
          }
          resolve(body.data);
        } else {
          reject(new Error(body.error || `Upload failed (HTTP ${xhr.status})`));
        }
      };

      xhr.onerror = () => {
        cleanup();
        reject(new Error('Upload failed (network error)'));
      };

      xhr.onabort = () => {
        cleanup();
        reject(new TransferCancelledError());
      };

      xhr.send(formData);
    });
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
