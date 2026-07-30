/**
 * Event Bridge — WebSocket server that broadcasts events to browser clients
 *
 * In Electron, mainWindow.webContents.send(channel, ...data) pushes events to the renderer.
 * In browser mode, this module replicates that by broadcasting over WebSocket.
 */

const { WebSocketServer } = require('ws');
const { isOriginAllowed } = require('../security/origin-policy');
const { isSessionCookieValid } = require('../security/auth');

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
   * Attach the WebSocket server to an HTTP server
   */
  attach(server) {
    this._wss = new WebSocketServer({
      server,
      path: '/ws/events',
      maxPayload: MAX_PAYLOAD_BYTES,
      verifyClient: ({ origin, req }, callback) => {
        if (!isOriginAllowed(origin)) return callback(false, 403, 'Origin not allowed');
        if (!isSessionCookieValid(req.headers.cookie)) return callback(false, 401, 'Authentication required');
        callback(true);
      }
    });

    this._wss.on('connection', (ws) => {
      this._clients.add(ws);
      this._subscriptions.set(ws, new Set());
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
        console.error('[EventBridge] WebSocket error:', err.message);
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
   * Broadcast an event to all connected browser clients.
   * This is the equivalent of mainWindow.webContents.send(channel, ...data)
   */
  broadcast(channel, ...data) {
    if (!this._wss || this._clients.size === 0) return;

    const message = JSON.stringify({ channel, data });

    for (const client of this._clients) {
      // Only send to clients subscribed to this channel (or all if no subscriptions tracked)
      const subs = this._subscriptions.get(client);
      if (subs && subs.size > 0 && !subs.has(channel)) {
        continue;
      }

      if (client.readyState === 1 /* WebSocket.OPEN */) {
        try {
          client.send(message);
        } catch (err) {
          console.error(`[EventBridge] Failed to send to client:`, err.message);
        }
      }
    }
  }

  /**
   * Get the number of connected clients
   */
  get clientCount() {
    return this._clients.size;
  }
}

module.exports = { EventBridge };
