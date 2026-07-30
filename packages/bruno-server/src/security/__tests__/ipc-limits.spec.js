/**
 * ipc-limits.js reads its BRUNO_SERVER_IPC_* env vars once at module-require
 * time, so each scenario re-requires the module via jest.isolateModules()
 * with small, deterministic limits instead of the production defaults.
 */
const loadModule = (env) => {
  const keys = ['BRUNO_SERVER_IPC_RATE_LIMIT', 'BRUNO_SERVER_IPC_RATE_WINDOW_MS', 'BRUNO_SERVER_IPC_MAX_CONCURRENT', 'BRUNO_SERVER_IPC_TIMEOUT_MS'];
  const original = {};
  keys.forEach((key) => { original[key] = process.env[key]; });
  Object.assign(process.env, env);

  let mod;
  jest.isolateModules(() => {
    mod = require('../ipc-limits');
  });

  keys.forEach((key) => {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  });

  return mod;
};

describe('IPC call limits', () => {
  describe('checkRateLimit', () => {
    it('allows requests under the limit and blocks once the window is full', () => {
      const { checkRateLimit } = loadModule({ BRUNO_SERVER_IPC_RATE_LIMIT: '3', BRUNO_SERVER_IPC_RATE_WINDOW_MS: '10000' });

      expect(checkRateLimit('client-a')).toBe(true);
      expect(checkRateLimit('client-a')).toBe(true);
      expect(checkRateLimit('client-a')).toBe(true);
      expect(checkRateLimit('client-a')).toBe(false);
    });

    it('tracks separate clients independently', () => {
      const { checkRateLimit } = loadModule({ BRUNO_SERVER_IPC_RATE_LIMIT: '1', BRUNO_SERVER_IPC_RATE_WINDOW_MS: '10000' });

      expect(checkRateLimit('client-a')).toBe(true);
      expect(checkRateLimit('client-b')).toBe(true);
      expect(checkRateLimit('client-a')).toBe(false);
      expect(checkRateLimit('client-b')).toBe(false);
    });

    it('allows requests again once the window has elapsed', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000);
      const { checkRateLimit } = loadModule({ BRUNO_SERVER_IPC_RATE_LIMIT: '1', BRUNO_SERVER_IPC_RATE_WINDOW_MS: '5000' });

      expect(checkRateLimit('client-a')).toBe(true);
      expect(checkRateLimit('client-a')).toBe(false);

      Date.now.mockReturnValue(6001);
      expect(checkRateLimit('client-a')).toBe(true);

      jest.restoreAllMocks();
    });
  });

  describe('concurrency slots', () => {
    it('caps concurrent slots per client and releases them', () => {
      const { acquireConcurrencySlot, releaseConcurrencySlot } = loadModule({ BRUNO_SERVER_IPC_MAX_CONCURRENT: '2' });

      expect(acquireConcurrencySlot('client-a')).toBe(true);
      expect(acquireConcurrencySlot('client-a')).toBe(true);
      expect(acquireConcurrencySlot('client-a')).toBe(false);

      releaseConcurrencySlot('client-a');
      expect(acquireConcurrencySlot('client-a')).toBe(true);
    });

    it('does not go negative when released more than acquired', () => {
      const { acquireConcurrencySlot, releaseConcurrencySlot } = loadModule({ BRUNO_SERVER_IPC_MAX_CONCURRENT: '1' });

      releaseConcurrencySlot('client-a');
      releaseConcurrencySlot('client-a');
      expect(acquireConcurrencySlot('client-a')).toBe(true);
      expect(acquireConcurrencySlot('client-a')).toBe(false);
    });
  });

  describe('withTimeout', () => {
    it('resolves normally when the promise settles before the timeout', async () => {
      const { withTimeout } = loadModule({ BRUNO_SERVER_IPC_TIMEOUT_MS: '200' });

      await expect(withTimeout(Promise.resolve('ok'), 'some:channel')).resolves.toBe('ok');
    });

    it('rejects with IpcTimeoutError when the promise never settles in time', async () => {
      const { withTimeout, IpcTimeoutError } = loadModule({ BRUNO_SERVER_IPC_TIMEOUT_MS: '20' });
      const neverSettles = new Promise(() => {});

      await expect(withTimeout(neverSettles, 'slow:channel')).rejects.toBeInstanceOf(IpcTimeoutError);
    });

    it('propagates the original rejection when the promise rejects before the timeout', async () => {
      const { withTimeout } = loadModule({ BRUNO_SERVER_IPC_TIMEOUT_MS: '200' });

      await expect(withTimeout(Promise.reject(new Error('boom')), 'some:channel')).rejects.toThrow('boom');
    });
  });
});
