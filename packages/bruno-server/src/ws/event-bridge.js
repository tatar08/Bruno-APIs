/**
 * Event Bridge — WebSocket server that broadcasts events to browser clients
 *
 * In Electron, mainWindow.webContents.send(channel, ...data) pushes events to the renderer.
 * In browser mode, this module replicates that by broadcasting over WebSocket.
 */

const { WebSocketServer } = require('ws');
const { isOriginAllowed } = require('../security/origin-policy');
const { isSessionCookieValid, parseCookies, SESSION_COOKIE_NAME } = require('../security/auth');
const { redactSecrets } = require('../security/log-redaction');

function getSessionIdFromCookieHeader(cookieHeader) {
  return parseCookies(cookieHeader)[SESSION_COOKIE_NAME] || null;
}

// Client messages are only small subscribe/unsubscribe control frames, so a
// generous-but-bounded payload cap blocks memory-pressure abuse without
// affecting legitimate use.
const MAX_PAYLOAD_BYTES = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 30000;
const MESSAGE_RATE_LIMIT = 50;
const MESSAGE_RATE_WINDOW_MS = 10000;

class EventBridge {
  constructor() {
    this._wss = null;
    this._clients = new Set();
    // Track which channels each client is subscribed to
    this._subscriptions = new Map(); // ws -> Set<channel>
    this._heartbeatInterval = null;
  }

  /**
   * Attach the WebSocket server to an HTTP server.
   *
   * @param {string} basePath reverse proxy mount prefix (Improvement.md
   *   P1.3), e.g. '/bridge'. Empty string mounts at the origin root, same
   *   as before this parameter existed.
   */
  attach(server, basePath = '') {
    this._wss = new WebSocketServer({
      server,
      path: `${basePath}/ws/events`,
      maxPayload: MAX_PAYLOAD_BYTES,
      verifyClient: ({ origin, req }, callback) => {
        if (!isOriginAllowed(origin)) return callback(false, 403, 'Origin not allowed');
        if (!isSessionCookieValid(req.headers.cookie)) return callback(false, 401, 'Authentication required');
        callback(true);
      }
    });

    this._wss.on('connection', (ws, req) => {
      this._clients.add(ws);
      this._subscriptions.set(ws, new Set());
      // null when auth (P0.1) is disabled, or the session cookie is absent —
      // such connections only ever receive broadcast()-routed events, never
      // sendToSession()-routed ones, which matches today's global-broadcast
      // behavior for the (default) no-auth case.
      ws._sessionId = getSessionIdFromCookieHeader(req.headers.cookie);
      ws.isAlive = true;
      ws._messageTimestamps = [];
      console.log(`[EventBridge] Client connected (total: ${this._clients.size})`);

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (raw) => {
        const now = Date.now();
        ws._messageTimestamps = ws._messageTimestamps.filter((t) => now - t < MESSAGE_RATE_WINDOW_MS);
        ws._messageTimestamps.push(now);
        if (ws._messageTimestamps.length > MESSAGE_RATE_LIMIT) {
          console.warn('[EventBridge] Client exceeded message rate limit, closing connection');
          ws.close(1008, 'Rate limit exceeded');
          return;
        }

        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'subscribe' && msg.channel) {
            this._subscriptions.get(ws)?.add(msg.channel);
          } else if (msg.type === 'unsubscribe' && msg.channel) {
            this._subscriptions.get(ws)?.delete(msg.channel);
          } else if (msg.type === 'ping') {
            // Application-level heartbeat (Improvement.md P1.2): the browser
            // client can't observe protocol-level ping/pong frames, so it
            // sends its own and expects this reply to detect a stale socket.
            if (ws.readyState === 1 /* WebSocket.OPEN */) {
              ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
            }
          }
        } catch (err) {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        this._clients.delete(ws);
        this._subscriptions.delete(ws);
        console.log(`[EventBridge] Client disconnected (total: ${this._clients.size})`);
      });

      ws.on('error', (err) => {
        console.error('[EventBridge] WebSocket error:', redactSecrets(err.message));
        this._clients.delete(ws);
        this._subscriptions.delete(ws);
      });
    });

    this._heartbeatInterval = setInterval(() => {
      for (const ws of [...this._clients]) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
    this._heartbeatInterval.unref?.();

    this._wss.on('close', () => clearInterval(this._heartbeatInterval));
  }

  /**
   * Sends `message` to every client for which `shouldSend(client)` is true
   * and which is subscribed to `channel` (or has no subscriptions tracked).
   */
  _sendToClients(channel, message, shouldSend) {
    for (const client of this._clients) {
      if (!shouldSend(client)) continue;

      const subs = this._subscriptions.get(client);
      if (subs && subs.size > 0 && !subs.has(channel)) {
        continue;
      }

      if (client.readyState === 1 /* WebSocket.OPEN */) {
        try {
          client.send(message);
        } catch (err) {
          console.error(`[EventBridge] Failed to send to client:`, redactSecrets(err.message));
        }
      }
    }
  }

  /**
   * Broadcast an event to all connected browser clients.
   * This is the equivalent of mainWindow.webContents.send(channel, ...data)
   * for the (default) no-auth case, where there is no per-client session to
   * target — every connected client is assumed to be the one desktop user.
   */
  broadcast(channel, ...data) {
    if (!this._wss || this._clients.size === 0) return;
    const message = JSON.stringify({ channel, data });
    this._sendToClients(channel, message, () => true);
  }

  /**
   * Send an event only to WebSocket connections authenticated as
   * `sessionId` (Improvement.md P0.4) — used when a session-scoped IPC call
   * triggers an event, so other browser tabs/users don't see it.
   */
  sendToSession(sessionId, channel, ...data) {
    if (!this._wss || this._clients.size === 0 || !sessionId) return;
    const message = JSON.stringify({ channel, data });
    this._sendToClients(channel, message, (client) => client._sessionId === sessionId);
  }

  /**
   * Get the number of connected clients
   */
  get clientCount() {
    return this._clients.size;
  }

  /**
   * Graceful shutdown (Improvement.md P1.3): terminate every connected
   * client, stop the heartbeat, and close the underlying WebSocketServer.
   * Safe to call even if attach() was never invoked.
   */
  close() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }

    for (const ws of this._clients) {
      try {
        ws.terminate();
      } catch (err) {
        // Best-effort — the process is shutting down regardless.
      }
    }
    this._clients.clear();
    this._subscriptions.clear();

    if (!this._wss) return Promise.resolve();
    return new Promise((resolve) => this._wss.close(() => resolve()));
  }
}

module.exports = { EventBridge };
