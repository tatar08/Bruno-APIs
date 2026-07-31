/**
 * Improvement.md P1.2 — Connection & Recovery UX tests for BrowserTransport:
 * connection-state machine, exponential backoff with jitter, application-level
 * heartbeat/staleness detection, and the bounded/deduplicated outbound queue.
 */
import {
  BrowserTransport,
  CONNECTION_STATE,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MAX_MISSED,
  INVOKE_TIMEOUT_MS,
  IpcTimeoutError
} from './ipc-transport';

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    FakeWebSocket.instances.push(this);
  }

  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sent.push(JSON.parse(data));
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose && this.onclose();
  }

  // --- test helpers ---
  _open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen && this.onopen();
  }

  _receive(payload) {
    this.onmessage && this.onmessage({ data: JSON.stringify(payload) });
  }

  static latest() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
}
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSING = 2;
FakeWebSocket.CLOSED = 3;

describe('BrowserTransport (Improvement.md P1.2)', () => {
  let transport;

  beforeEach(() => {
    jest.useFakeTimers();
    FakeWebSocket.instances = [];
    global.WebSocket = FakeWebSocket;
    transport = new BrowserTransport();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('connection state machine', () => {
    it('starts CONNECTING before the socket opens', () => {
      expect(transport.getConnectionState()).toBe(CONNECTION_STATE.CONNECTING);
    });

    it('transitions to ONLINE once the socket opens', () => {
      FakeWebSocket.latest()._open();
      expect(transport.getConnectionState()).toBe(CONNECTION_STATE.ONLINE);
    });

    it('transitions to OFFLINE when the socket closes, then back to CONNECTING on retry', () => {
      FakeWebSocket.latest()._open();
      FakeWebSocket.latest().close();
      expect(transport.getConnectionState()).toBe(CONNECTION_STATE.OFFLINE);

      jest.advanceTimersByTime(RECONNECT_MAX_DELAY_MS);
      expect(transport.getConnectionState()).toBe(CONNECTION_STATE.CONNECTING);
    });

    it('onConnectionStateChange fires immediately with the current state, then on every transition', () => {
      const handler = jest.fn();
      const unsubscribe = transport.onConnectionStateChange(handler);
      expect(handler).toHaveBeenLastCalledWith(CONNECTION_STATE.CONNECTING);

      FakeWebSocket.latest()._open();
      expect(handler).toHaveBeenLastCalledWith(CONNECTION_STATE.ONLINE);

      unsubscribe();
      FakeWebSocket.latest().close();
      expect(handler).not.toHaveBeenCalledWith(CONNECTION_STATE.OFFLINE);
    });
  });

  describe('exponential backoff with jitter', () => {
    it('grows the retry delay exponentially, capped at RECONNECT_MAX_DELAY_MS', () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      // 1st disconnect (from the constructor's initial socket)
      FakeWebSocket.latest().close();
      let delay = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1][1];
      expect(delay).toBeGreaterThanOrEqual(RECONNECT_BASE_DELAY_MS / 2);
      expect(delay).toBeLessThanOrEqual(RECONNECT_BASE_DELAY_MS);

      // Drive several more attempts and confirm the cap is respected and never trivially small
      for (let i = 0; i < 10; i++) {
        jest.runOnlyPendingTimers(); // fires _connectWebSocket
        FakeWebSocket.latest().close();
      }

      delay = setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1][1];
      expect(delay).toBeLessThanOrEqual(RECONNECT_MAX_DELAY_MS);
      expect(delay).toBeGreaterThanOrEqual(RECONNECT_MAX_DELAY_MS / 2);

      setTimeoutSpy.mockRestore();
    });
  });

  describe('heartbeat / staleness detection', () => {
    it('sends an application-level ping once connected, on every HEARTBEAT_INTERVAL_MS tick', () => {
      const ws = FakeWebSocket.latest();
      ws._open();

      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(ws.sent).toEqual([{ type: 'ping', ts: expect.any(Number) }]);
    });

    it('stays ONLINE when pongs keep arriving', () => {
      const ws = FakeWebSocket.latest();
      ws._open();

      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      ws._receive({ type: 'pong', ts: Date.now() });
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      ws._receive({ type: 'pong', ts: Date.now() });

      expect(transport.getConnectionState()).toBe(CONNECTION_STATE.ONLINE);
    });

    it('marks the connection DEGRADED after one missed pong', () => {
      const ws = FakeWebSocket.latest();
      ws._open();

      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS); // ping #1 sent, no reply
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS); // still no pong -> missed

      expect(transport.getConnectionState()).toBe(CONNECTION_STATE.DEGRADED);
    });

    it('recovers to ONLINE if a pong arrives after being marked DEGRADED', () => {
      const ws = FakeWebSocket.latest();
      ws._open();

      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(transport.getConnectionState()).toBe(CONNECTION_STATE.DEGRADED);

      ws._receive({ type: 'pong', ts: Date.now() });
      expect(transport.getConnectionState()).toBe(CONNECTION_STATE.ONLINE);
    });

    it('forces a reconnect after HEARTBEAT_MAX_MISSED consecutive missed pongs', () => {
      const ws = FakeWebSocket.latest();
      ws._open();

      for (let i = 0; i < HEARTBEAT_MAX_MISSED + 1; i++) {
        jest.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      }

      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(transport.getConnectionState()).toBe(CONNECTION_STATE.OFFLINE);
    });
  });

  describe('bounded + deduplicated outbound queue', () => {
    it('queues subscribe/unsubscribe actions while offline and flushes them once reconnected', () => {
      // socket never opened yet -> still queuing
      const unsubscribe = transport.on('main:app-loaded', jest.fn());
      expect(transport._wsQueue.get('main:app-loaded')).toBe('subscribe');

      const ws = FakeWebSocket.latest();
      ws._open();

      expect(ws.sent).toEqual(
        expect.arrayContaining([{ type: 'subscribe', channel: 'main:app-loaded' }])
      );
      expect(transport._wsQueue.size).toBe(0);

      unsubscribe();
      expect(ws.sent).toEqual(
        expect.arrayContaining([{ type: 'unsubscribe', channel: 'main:app-loaded' }])
      );
    });

    it('coalesces repeated subscribe/unsubscribe toggles on the same channel into a single queued action', () => {
      const handler = jest.fn();
      const unsubscribe = transport.on('main:app-loaded', handler);
      unsubscribe();
      transport.on('main:app-loaded', handler);

      // net effect: still subscribed -> exactly one pending action for this channel
      expect(transport._wsQueue.size).toBe(1);
      expect(transport._wsQueue.get('main:app-loaded')).toBe('subscribe');
    });
  });

  describe('invoke() request id, timeout, and cancellation (Improvement.md P1.2)', () => {
    const findIpcCall = () => global.fetch.mock.calls.find(([url]) => url.includes('/api/ipc/'));

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      delete global.fetch;
    });

    it('attaches a unique X-Request-Id header to every IPC call', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: 'ok' }) });

      await transport.invoke('renderer:some-channel');
      const [, firstOptions] = findIpcCall();
      const firstId = firstOptions.headers['X-Request-Id'];
      expect(typeof firstId).toBe('string');
      expect(firstId.length).toBeGreaterThan(0);

      await transport.invoke('renderer:some-channel');
      const ipcCalls = global.fetch.mock.calls.filter(([url]) => url.includes('/api/ipc/'));
      const secondId = ipcCalls[ipcCalls.length - 1][1].headers['X-Request-Id'];
      expect(secondId).not.toBe(firstId);
    });

    it('aborts the request and rejects with IpcTimeoutError once INVOKE_TIMEOUT_MS elapses without a response', async () => {
      global.fetch.mockImplementation((url, options) => {
        if (!url.includes('/api/ipc/')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const invokePromise = transport.invoke('renderer:hangs-forever');
      const rejection = invokePromise.catch((err) => err);

      await jest.advanceTimersByTimeAsync(INVOKE_TIMEOUT_MS);

      const err = await rejection;
      expect(err).toBeInstanceOf(IpcTimeoutError);
      expect(err.channel).toBe('renderer:hangs-forever');
      expect(err.requestId).toEqual(expect.any(String));
    });

    it('surfaces the server-echoed requestId on the thrown error for a failed call', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'handler blew up', requestId: 'server-req-123' })
      });

      await expect(transport.invoke('renderer:some-channel')).rejects.toMatchObject({
        requestId: 'server-req-123'
      });
    });
  });
});
