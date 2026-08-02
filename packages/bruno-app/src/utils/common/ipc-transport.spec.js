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
  RETRYABLE_INVOKE_MAX_ATTEMPTS,
  RETRYABLE_INVOKE_RETRY_DELAY_MS,
  MAX_DOWNLOAD_RESUME_ATTEMPTS,
  IpcTimeoutError,
  TransferCancelledError,
  TransferIntegrityError
} from './ipc-transport';

const nodeCrypto = require('crypto');
const sha256HexOf = (str) => nodeCrypto.createHash('sha256').update(str).digest('hex');

// Minimal XMLHttpRequest double for uploadZipFile() tests (Improvement.md
// P1.1 Transfer Center progress/cancel) — real fetch() has no upload
// progress event in any browser, so uploadZipFile() uses XHR instead, which
// jsdom doesn't implement well enough to drive real network I/O against.
class FakeXHR {
  constructor() {
    this.upload = {};
    this.status = 0;
    this.responseText = '';
    this._headers = {};
    FakeXHR.instances.push(this);
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this._headers[name] = value;
  }

  send(body) {
    this.sentBody = body;
  }

  abort() {
    this.aborted = true;
    this.onabort && this.onabort();
  }

  // --- test helpers ---
  _progress(loaded, total) {
    this.upload.onprogress && this.upload.onprogress({ lengthComputable: true, loaded, total });
  }

  _respond(status, body) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload && this.onload();
  }

  _networkError() {
    this.onerror && this.onerror();
  }

  static latest() {
    return FakeXHR.instances[FakeXHR.instances.length - 1];
  }
}

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
        expect.arrayContaining([{ type: 'subscribe-batch', channels: ['main:app-loaded'] }])
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

  describe('retryableInvoke() idempotent retry (Improvement.md P1.2)', () => {
    const findIpcCalls = () => global.fetch.mock.calls.filter(([url]) => url.includes('/api/ipc/'));
    const authStatusResponse = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      delete global.fetch;
    });

    it('attaches the same idempotencyKey to every retry attempt on an allowlisted channel', async () => {
      let ipcCallCount = 0;
      global.fetch.mockImplementation((url) => {
        if (url.includes('/api/auth/status')) return authStatusResponse();
        ipcCallCount += 1;
        if (ipcCallCount < 3) return Promise.reject(new TypeError('Failed to fetch'));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { uid: 'req-1' } }) });
      });

      const promise = transport.retryableInvoke('renderer:new-request', 'My Request');
      await jest.advanceTimersByTimeAsync(RETRYABLE_INVOKE_RETRY_DELAY_MS * RETRYABLE_INVOKE_MAX_ATTEMPTS);
      await expect(promise).resolves.toEqual({ uid: 'req-1' });

      const ipcCalls = findIpcCalls();
      expect(ipcCalls.length).toBe(3);
      const keys = ipcCalls.map(([, options]) => JSON.parse(options.body).idempotencyKey);
      expect(keys.every((key) => typeof key === 'string' && key.length > 0)).toBe(true);
      expect(new Set(keys).size).toBe(1);
      expect(ipcCalls.every(([, options]) => JSON.parse(options.body).args[0] === 'My Request')).toBe(true);
    });

    it('gives up after RETRYABLE_INVOKE_MAX_ATTEMPTS network failures and throws the last error', async () => {
      global.fetch.mockImplementation((url) => {
        if (url.includes('/api/auth/status')) return authStatusResponse();
        return Promise.reject(new TypeError('Failed to fetch'));
      });

      const promise = transport.retryableInvoke('renderer:new-request', 'My Request');
      const rejection = promise.catch((err) => err);
      await jest.advanceTimersByTimeAsync(RETRYABLE_INVOKE_RETRY_DELAY_MS * RETRYABLE_INVOKE_MAX_ATTEMPTS * 2);

      const err = await rejection;
      expect(err).toBeInstanceOf(TypeError);
      expect(findIpcCalls().length).toBe(RETRYABLE_INVOKE_MAX_ATTEMPTS);
    });

    it('does not retry a real server-side error response — fails on the first attempt', async () => {
      global.fetch.mockImplementation((url) => {
        if (url.includes('/api/auth/status')) return authStatusResponse();
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'name already exists' }) });
      });

      await expect(transport.retryableInvoke('renderer:new-request', 'Dup')).rejects.toThrow('name already exists');
      expect(findIpcCalls().length).toBe(1);
    });

    it('falls back to a single plain invoke() (no idempotencyKey) for a channel outside the allowlist', async () => {
      global.fetch.mockImplementation((url) => {
        if (url.includes('/api/auth/status')) return authStatusResponse();
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: 'ok' }) });
      });

      await expect(transport.retryableInvoke('renderer:save-request', 'x')).resolves.toBe('ok');

      const ipcCalls = findIpcCalls();
      expect(ipcCalls.length).toBe(1);
      expect(JSON.parse(ipcCalls[0][1].body).idempotencyKey).toBeUndefined();
    });
  });

  describe('uploadZipFile() progress + cancel (Improvement.md P1.1 Transfer Center)', () => {
    const file = new File(['zip-bytes'], 'collection.zip', { type: 'application/zip' });
    // These tests only await plain promise chains (ensureBridgeAuth() -> XHR
    // creation), no timers -- switch off the outer describe's fake timers so
    // a real setTimeout(…, 0) can flush them without manual timer-advancing.
    const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
      jest.useRealTimers();
      FakeXHR.instances = [];
      global.XMLHttpRequest = FakeXHR;
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
    });

    afterEach(() => {
      delete global.XMLHttpRequest;
      delete global.fetch;
    });

    it('reports 0-100 progress as the XHR fires upload.onprogress events', async () => {
      const onProgress = jest.fn();
      const promise = transport.uploadZipFile(file, { onProgress });
      await flushAsync();

      const xhr = FakeXHR.latest();
      xhr._progress(50, 200);
      xhr._progress(200, 200);
      xhr._respond(200, { data: '/scratch/collection.zip' });

      await expect(promise).resolves.toBe('/scratch/collection.zip');
      expect(onProgress).toHaveBeenNthCalledWith(1, 25);
      expect(onProgress).toHaveBeenNthCalledWith(2, 100);
    });

    it('rejects with TransferCancelledError and aborts the XHR when the signal fires mid-upload', async () => {
      const controller = new AbortController();
      const promise = transport.uploadZipFile(file, { signal: controller.signal });
      await flushAsync();

      controller.abort();

      await expect(promise).rejects.toBeInstanceOf(TransferCancelledError);
      expect(FakeXHR.latest().aborted).toBe(true);
    });

    it('rejects with TransferCancelledError immediately if the signal is already aborted, without starting a request', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(transport.uploadZipFile(file, { signal: controller.signal })).rejects.toBeInstanceOf(TransferCancelledError);
      expect(FakeXHR.instances.length).toBe(0);
    });

    it('rejects with the server-provided error message on a non-2xx response', async () => {
      const promise = transport.uploadZipFile(file);
      await flushAsync();

      FakeXHR.latest()._respond(413, { error: 'File too large' });

      await expect(promise).rejects.toThrow('File too large');
    });

    it('resolves normally when the response sha256 matches the uploaded file (Improvement.md P1.1 checksums)', async () => {
      const promise = transport.uploadZipFile(file);
      await flushAsync();

      FakeXHR.latest()._respond(200, { data: '/scratch/collection.zip', sha256: sha256HexOf('zip-bytes') });

      await expect(promise).resolves.toBe('/scratch/collection.zip');
    });

    it('rejects with TransferIntegrityError when the response sha256 does not match the uploaded file', async () => {
      const promise = transport.uploadZipFile(file);
      await flushAsync();

      FakeXHR.latest()._respond(200, { data: '/scratch/collection.zip', sha256: 'deadbeef'.repeat(8) });

      await expect(promise).rejects.toBeInstanceOf(TransferIntegrityError);
    });
  });

  describe('downloadWithProgress() progress + cancel (Improvement.md P1.1 Transfer Center)', () => {
    const makeReadableBody = (chunks) => {
      let i = 0;
      return {
        getReader: () => ({
          read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined })
        })
      };
    };

    beforeEach(() => {
      jest.useRealTimers();
      // jsdom doesn't implement these; downloadWithProgress uses them to
      // trigger the browser's real save-file flow via a hidden <a download>.
      global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = jest.fn();
    });

    afterEach(() => {
      delete global.fetch;
    });

    it('reports 0-100 progress from Content-Length as chunks stream in', async () => {
      const chunk = new Uint8Array(50);
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        return Promise.resolve({
          ok: true,
          headers: { get: (name) => (name === 'content-length' ? '200' : name === 'content-disposition' ? 'attachment; filename="Test.zip"' : null) },
          body: makeReadableBody([chunk, chunk, chunk, chunk])
        });
      });

      const onProgress = jest.fn();
      const result = await transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test'], { onProgress });

      expect(result).toEqual({ success: true, filePath: 'Test.zip' });
      expect(onProgress).toHaveBeenCalledWith(25);
      expect(onProgress).toHaveBeenCalledWith(50);
      expect(onProgress).toHaveBeenCalledWith(75);
      expect(onProgress).toHaveBeenCalledWith(100);
    });

    it('reports null progress when the response has no Content-Length', async () => {
      const chunk = new Uint8Array(10);
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        return Promise.resolve({ ok: true, headers: { get: () => null }, body: makeReadableBody([chunk]) });
      });

      const onProgress = jest.fn();
      await transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test'], { onProgress });

      expect(onProgress).toHaveBeenCalledWith(null);
    });

    it('rejects with TransferCancelledError when the fetch is aborted', async () => {
      global.fetch = jest.fn().mockImplementation((url, options) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        return new Promise((resolve, reject) => {
          const rejectAbort = () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          };
          // Real fetch() rejects immediately when handed a signal that's
          // already aborted — it doesn't wait for a future 'abort' event,
          // which (being one-shot) would never fire again in that case.
          if (options?.signal?.aborted) {
            rejectAbort();
            return;
          }
          options?.signal?.addEventListener('abort', rejectAbort);
        });
      });

      const controller = new AbortController();
      const promise = transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test'], { signal: controller.signal });
      controller.abort();

      await expect(promise).rejects.toBeInstanceOf(TransferCancelledError);
    });

    it('falls back to response.blob() when no onProgress callback is given', async () => {
      const mockBlob = { size: 3 };
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        return Promise.resolve({ ok: true, headers: { get: () => null }, blob: async () => mockBlob });
      });

      const result = await transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test']);
      expect(result).toEqual({ success: true, filePath: expect.any(String) });
    });

    it('resolves normally when X-Content-SHA256 matches the downloaded bytes (Improvement.md P1.1 checksums)', async () => {
      const bytes = 'download-bytes-for-checksum-test';
      const expectedSha256 = sha256HexOf(bytes);
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        return Promise.resolve({
          ok: true,
          headers: { get: (name) => (name === 'x-content-sha256' ? expectedSha256 : null) },
          blob: async () => new Blob([bytes])
        });
      });

      const result = await transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test']);
      expect(result).toEqual({ success: true, filePath: expect.any(String) });
    });

    it('rejects with TransferIntegrityError when X-Content-SHA256 does not match the downloaded bytes', async () => {
      const bytes = 'download-bytes-for-checksum-test';
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        return Promise.resolve({
          ok: true,
          headers: { get: (name) => (name === 'x-content-sha256' ? 'deadbeef'.repeat(8) : null) },
          blob: async () => new Blob([bytes])
        });
      });

      await expect(
        transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test'])
      ).rejects.toBeInstanceOf(TransferIntegrityError);
    });
  });

  describe('downloadWithProgress() resume on stream failure (Improvement.md P1.1 resumable downloads)', () => {
    beforeEach(() => {
      jest.useRealTimers();
      global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
      global.URL.revokeObjectURL = jest.fn();
    });

    afterEach(() => {
      delete global.fetch;
    });

    it('resumes via a resume-token fetch after a stream-read failure and completes the download', async () => {
      const chunk1 = new Uint8Array(50);
      const chunk2 = new Uint8Array(50);

      let initialReadCount = 0;
      const failingReader = {
        read: async () => {
          initialReadCount++;
          if (initialReadCount === 1) return { done: false, value: chunk1 };
          throw new Error('network read failed');
        }
      };

      let resumedReadCount = 0;
      const resumedReader = {
        read: async () => {
          resumedReadCount++;
          if (resumedReadCount === 1) return { done: false, value: chunk2 };
          return { done: true, value: undefined };
        }
      };

      let downloadFetchCount = 0;
      global.fetch = jest.fn().mockImplementation((url, options) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }

        downloadFetchCount++;
        if (downloadFetchCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: {
              get: (name) => {
                if (name === 'content-length') return '100';
                if (name === 'content-disposition') return 'attachment; filename="Test.zip"';
                if (name === 'x-resume-token') return 'resume-token-123';
                return null;
              }
            },
            body: { getReader: () => failingReader }
          });
        }

        // The resume attempt: a Range header and the resume token in the body.
        expect(options.headers.Range).toBe('bytes=50-');
        expect(JSON.parse(options.body).resumeToken).toBe('resume-token-123');
        return Promise.resolve({
          ok: true,
          status: 206,
          headers: { get: () => null },
          body: { getReader: () => resumedReader }
        });
      });

      const onProgress = jest.fn();
      const result = await transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test'], { onProgress });

      expect(result).toEqual({ success: true, filePath: 'Test.zip' });
      expect(downloadFetchCount).toBe(2);
      expect(onProgress).toHaveBeenCalledWith(100);
    });

    it('rethrows the original error immediately when the response carries no resume token', async () => {
      const chunk1 = new Uint8Array(10);
      let readCallCount = 0;
      const failingReader = {
        read: async () => {
          readCallCount++;
          if (readCallCount === 1) return { done: false, value: chunk1 };
          throw new Error('network read failed');
        }
      };

      let downloadFetchCount = 0;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        downloadFetchCount++;
        return Promise.resolve({
          ok: true,
          headers: { get: () => null }, // no x-resume-token
          body: { getReader: () => failingReader }
        });
      });

      await expect(
        transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test'], { onProgress: jest.fn() })
      ).rejects.toThrow('network read failed');

      expect(downloadFetchCount).toBe(1);
    });

    it('throws TransferCancelledError on stream-read failure once the signal is aborted, even with a resume token available', async () => {
      const controller = new AbortController();
      const chunk1 = new Uint8Array(10);
      let readCallCount = 0;
      const failingReader = {
        read: async () => {
          readCallCount++;
          if (readCallCount === 1) return { done: false, value: chunk1 };
          controller.abort();
          throw new Error('network read failed');
        }
      };

      let downloadFetchCount = 0;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        downloadFetchCount++;
        return Promise.resolve({
          ok: true,
          headers: { get: (name) => (name === 'x-resume-token' ? 'resume-token-123' : null) },
          body: { getReader: () => failingReader }
        });
      });

      await expect(
        transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test'], { onProgress: jest.fn(), signal: controller.signal })
      ).rejects.toBeInstanceOf(TransferCancelledError);

      expect(downloadFetchCount).toBe(1); // no resume attempt once cancelled
    });

    it('surfaces the original stream-read error when the resume attempt itself fails (e.g. an expired token)', async () => {
      const chunk1 = new Uint8Array(10);
      let readCallCount = 0;
      const failingReader = {
        read: async () => {
          readCallCount++;
          if (readCallCount === 1) return { done: false, value: chunk1 };
          throw new Error('original network read failed');
        }
      };

      let downloadFetchCount = 0;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        downloadFetchCount++;
        if (downloadFetchCount === 1) {
          return Promise.resolve({
            ok: true,
            headers: { get: (name) => (name === 'x-resume-token' ? 'resume-token-123' : null) },
            body: { getReader: () => failingReader }
          });
        }
        // The resume attempt itself fails outright (token expired -> 410 Gone).
        return Promise.resolve({ ok: false, status: 410, json: async () => ({ error: 'This download can no longer be resumed' }) });
      });

      await expect(
        transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test'], { onProgress: jest.fn() })
      ).rejects.toThrow('original network read failed');

      expect(downloadFetchCount).toBe(2); // initial + one failed resume attempt, no further retries
    });

    it(`gives up and rethrows the last stream-read error after ${MAX_DOWNLOAD_RESUME_ATTEMPTS} failed resume attempts`, async () => {
      const chunk1 = new Uint8Array(10);
      let initialReadCount = 0;
      const failingReader = {
        read: async () => {
          initialReadCount++;
          if (initialReadCount === 1) return { done: false, value: chunk1 };
          throw new Error('network read failed');
        }
      };
      // Every resumed connection also drops immediately on its first read,
      // simulating a client stuck on a persistently bad network path.
      const alwaysFailingResumedReader = { read: async () => { throw new Error('network read failed'); } };

      let downloadFetchCount = 0;
      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes('/api/auth/status')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ authRequired: false }) });
        }
        downloadFetchCount++;
        if (downloadFetchCount === 1) {
          return Promise.resolve({
            ok: true,
            headers: { get: (name) => (name === 'x-resume-token' ? 'resume-token-123' : null) },
            body: { getReader: () => failingReader }
          });
        }
        return Promise.resolve({
          ok: true,
          status: 206,
          headers: { get: () => null },
          body: { getReader: () => alwaysFailingResumedReader }
        });
      });

      await expect(
        transport.downloadWithProgress('renderer:export-collection-zip', ['/col', 'Test'], { onProgress: jest.fn() })
      ).rejects.toThrow('network read failed');

      // 1 initial fetch + MAX_DOWNLOAD_RESUME_ATTEMPTS resume fetches, then give up.
      expect(downloadFetchCount).toBe(1 + MAX_DOWNLOAD_RESUME_ATTEMPTS);
    });
  });
});
