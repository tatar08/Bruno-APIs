const http = require('http');
const { EventEmitter } = require('events');
const { EventBridge } = require('../event-bridge');

function makeMockClient({ sessionId = null, readyState = 1 } = {}) {
  const ws = new EventEmitter();
  ws.send = jest.fn();
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
});
