const http = require('http');
const { EventEmitter } = require('events');
const { EventBridge } = require('../event-bridge');

function makeMockClient({ sessionId = null, readyState = 1 } = {}) {
  const ws = new EventEmitter();
  ws.send = jest.fn();
  ws.close = jest.fn();
  ws.readyState = readyState;
  ws._sessionId = sessionId;
  return ws;
}

describe('EventBridge', () => {
  describe('broadcast / sendToSession (pure routing logic)', () => {
    let bridge;

    beforeEach(() => {
      bridge = new EventBridge();
      bridge._wss = {}; // truthy stand-in, only used as a "server attached" guard
    });

    it('broadcast sends to every connected client regardless of session', () => {
      const a = makeMockClient({ sessionId: 'session-a' });
      const b = makeMockClient({ sessionId: 'session-b' });
      const anon = makeMockClient({ sessionId: null });
      [a, b, anon].forEach((c) => {
        bridge._clients.add(c);
        bridge._subscriptions.set(c, new Set());
      });

      bridge.broadcast('main:app-loaded', { ok: true });

      expect(a.send).toHaveBeenCalledTimes(1);
      expect(b.send).toHaveBeenCalledTimes(1);
      expect(anon.send).toHaveBeenCalledTimes(1);
    });

    it('sendToSession only reaches clients with a matching session id', () => {
      const a = makeMockClient({ sessionId: 'session-a' });
      const b = makeMockClient({ sessionId: 'session-b' });
      const anon = makeMockClient({ sessionId: null });
      [a, b, anon].forEach((c) => {
        bridge._clients.add(c);
        bridge._subscriptions.set(c, new Set());
      });

      bridge.sendToSession('session-a', 'terminal:data', 'hello');

      expect(a.send).toHaveBeenCalledTimes(1);
      expect(b.send).not.toHaveBeenCalled();
      expect(anon.send).not.toHaveBeenCalled();
    });

    it('sendToSession is a no-op without a sessionId', () => {
      const a = makeMockClient({ sessionId: 'session-a' });
      bridge._clients.add(a);
      bridge._subscriptions.set(a, new Set());

      bridge.sendToSession(null, 'terminal:data', 'hello');

      expect(a.send).not.toHaveBeenCalled();
    });

    it('still respects per-channel subscriptions within a session', () => {
      const a = makeMockClient({ sessionId: 'session-a' });
      bridge._clients.add(a);
      bridge._subscriptions.set(a, new Set(['terminal:data']));

      bridge.sendToSession('session-a', 'other:channel', 'nope');
      expect(a.send).not.toHaveBeenCalled();

      bridge.sendToSession('session-a', 'terminal:data', 'yep');
      expect(a.send).toHaveBeenCalledTimes(1);
    });

    it('skips clients that are not OPEN', () => {
      const a = makeMockClient({ sessionId: 'session-a', readyState: 3 /* CLOSED */ });
      bridge._clients.add(a);
      bridge._subscriptions.set(a, new Set());

      bridge.sendToSession('session-a', 'terminal:data', 'hello');
      expect(a.send).not.toHaveBeenCalled();
    });
  });

  describe('application-level heartbeat ping/pong (Improvement.md P1.2)', () => {
    let bridge;
    let server;

    beforeEach(() => {
      server = new http.Server();
      bridge = new EventBridge();
      bridge.attach(server);
    });

    afterEach(() => {
      bridge._wss.close();
    });

    it('replies with a pong echoing the same ts when a client sends a ping', () => {
      const ws = makeMockClient();
      bridge._wss.emit('connection', ws, { headers: {} });

      ws.emit('message', Buffer.from(JSON.stringify({ type: 'ping', ts: 12345 })));

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong', ts: 12345 }));
    });

    it('does not reply to a ping from a client that is not OPEN', () => {
      const ws = makeMockClient({ readyState: 3 /* CLOSED */ });
      bridge._wss.emit('connection', ws, { headers: {} });

      ws.emit('message', Buffer.from(JSON.stringify({ type: 'ping', ts: 1 })));

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('a pong reply does not count against the client message rate limit', () => {
      const ws = makeMockClient();
      bridge._wss.emit('connection', ws, { headers: {} });

      for (let i = 0; i < 60; i++) {
        ws.emit('message', Buffer.from(JSON.stringify({ type: 'ping', ts: i })));
      }

      // The rate limiter only counts inbound client messages, so 60 pings
      // (over the 50-message MESSAGE_RATE_LIMIT) still trips the same close
      // path as any other message type -- pong replies aren't a bypass.
      expect(ws.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
    });
  });

  describe('attach() base path (Improvement.md P1.3)', () => {
    it('mounts at /ws/events by default', () => {
      const server = new http.Server();
      const bridge = new EventBridge();
      bridge.attach(server);

      expect(bridge._wss.options.path).toBe('/ws/events');
      bridge._wss.close();
    });

    it('prefixes the WS path with a given base path', () => {
      const server = new http.Server();
      const bridge = new EventBridge();
      bridge.attach(server, '/bridge');

      expect(bridge._wss.options.path).toBe('/bridge/ws/events');
      bridge._wss.close();
    });
  });

  describe('connection handling', () => {
    let bridge;
    let server;

    beforeEach(() => {
      server = new http.Server();
      bridge = new EventBridge();
      bridge.attach(server);
    });

    afterEach(() => {
      bridge._wss.close();
    });

    it('captures the session id from the upgrade request cookie', () => {
      const ws = new EventEmitter();
      ws.send = jest.fn();

      bridge._wss.emit('connection', ws, { headers: { cookie: 'bruno_session=abc123; other=x' } });

      expect(ws._sessionId).toBe('abc123');
      expect(bridge._clients.has(ws)).toBe(true);
    });

    it('leaves session id null when there is no session cookie', () => {
      const ws = new EventEmitter();
      ws.send = jest.fn();

      bridge._wss.emit('connection', ws, { headers: {} });

      expect(ws._sessionId).toBeNull();
    });

    it('cleans up client + subscription + session id on close', () => {
      const ws = new EventEmitter();
      ws.send = jest.fn();

      bridge._wss.emit('connection', ws, { headers: { cookie: 'bruno_session=abc123' } });
      expect(bridge._clients.has(ws)).toBe(true);

      ws.emit('close');
      expect(bridge._clients.has(ws)).toBe(false);
      expect(bridge._subscriptions.has(ws)).toBe(false);
    });
  });

  describe('close (Improvement.md P1.3 graceful shutdown)', () => {
    it('is a no-op when attach() was never called', async () => {
      const bridge = new EventBridge();
      await expect(bridge.close()).resolves.toBeUndefined();
    });

    it('terminates all connected clients and clears tracking state', async () => {
      const server = new http.Server();
      const bridge = new EventBridge();
      bridge.attach(server);

      const a = new EventEmitter();
      a.send = jest.fn();
      a.terminate = jest.fn();
      const b = new EventEmitter();
      b.send = jest.fn();
      b.terminate = jest.fn();

      bridge._wss.emit('connection', a, { headers: {} });
      bridge._wss.emit('connection', b, { headers: {} });
      expect(bridge._clients.size).toBe(2);

      await bridge.close();

      expect(a.terminate).toHaveBeenCalledTimes(1);
      expect(b.terminate).toHaveBeenCalledTimes(1);
      expect(bridge._clients.size).toBe(0);
      expect(bridge._subscriptions.size).toBe(0);
    });

    it('stops the heartbeat interval', async () => {
      const server = new http.Server();
      const bridge = new EventBridge();
      bridge.attach(server);
      expect(bridge._heartbeatInterval).not.toBeNull();

      await bridge.close();

      expect(bridge._heartbeatInterval).toBeNull();
    });

    it('tolerates a client whose terminate() throws', async () => {
      const server = new http.Server();
      const bridge = new EventBridge();
      bridge.attach(server);

      const a = new EventEmitter();
      a.send = jest.fn();
      a.terminate = jest.fn(() => {
        throw new Error('boom');
      });
      bridge._wss.emit('connection', a, { headers: {} });

      await expect(bridge.close()).resolves.toBeUndefined();
    });
  });
});
