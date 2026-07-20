/**
 * Event Bridge — WebSocket server that broadcasts events to browser clients
 *
 * In Electron, mainWindow.webContents.send(channel, ...data) pushes events to the renderer.
 * In browser mode, this module replicates that by broadcasting over WebSocket.
 */

const { WebSocketServer } = require('ws');

class EventBridge {
  constructor() {
    this._wss = null;
    this._clients = new Set();
    // Track which channels each client is subscribed to
    this._subscriptions = new Map(); // ws -> Set<channel>
  }

  /**
   * Attach the WebSocket server to an HTTP server
   */
  attach(server) {
    this._wss = new WebSocketServer({ server, path: '/ws/events' });

    this._wss.on('connection', (ws) => {
      this._clients.add(ws);
      this._subscriptions.set(ws, new Set());
      console.log(`[EventBridge] Client connected (total: ${this._clients.size})`);

      ws.on('message', (raw) => {
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
