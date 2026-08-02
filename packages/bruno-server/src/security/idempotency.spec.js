const { CHANNELS } = require('@usebruno/rpc-contract');

describe('idempotency.js (Improvement.md P1.2)', () => {
  const ELIGIBLE_CHANNEL = CHANNELS.RENDERER_NEW_REQUEST;
  const INELIGIBLE_CHANNEL = 'renderer:echo';

  // Each test gets a fresh copy of the module (and therefore a fresh, empty
  // cache Map) since the real module is a process-wide singleton — without
  // this, tests would interfere with each other via shared cache state.
  let idempotency;

  beforeEach(() => {
    jest.resetModules();
    idempotency = require('./idempotency');
  });

  describe('isIdempotentChannel()', () => {
    it('returns true for a channel in the allowlist', () => {
      expect(idempotency.isIdempotentChannel(ELIGIBLE_CHANNEL)).toBe(true);
    });

    it('returns false for a channel not in the allowlist', () => {
      expect(idempotency.isIdempotentChannel(INELIGIBLE_CHANNEL)).toBe(false);
    });

    it('allowlist matches the 7 confirmed create/save channels', () => {
      expect([...idempotency.IDEMPOTENT_CHANNELS].sort()).toEqual(
        [
          CHANNELS.RENDERER_NEW_REQUEST,
          CHANNELS.RENDERER_NEW_FOLDER,
          CHANNELS.RENDERER_CLONE_FOLDER,
          CHANNELS.RENDERER_CREATE_ENVIRONMENT,
          CHANNELS.RENDERER_CREATE_GLOBAL_ENVIRONMENT,
          CHANNELS.RENDERER_IMPORT_COLLECTION,
          CHANNELS.RENDERER_IMPORT_COLLECTION_ZIP
        ].sort()
      );
    });
  });

  describe('getCachedResponse() / storeResponse()', () => {
    it('returns null for a key that was never stored', () => {
      expect(idempotency.getCachedResponse(ELIGIBLE_CHANNEL, 'never-stored')).toBeNull();
    });

    it('returns the stored body for a repeated (channel, key) pair', () => {
      idempotency.storeResponse(ELIGIBLE_CHANNEL, 'key-1', { data: { uid: 'abc' } });
      expect(idempotency.getCachedResponse(ELIGIBLE_CHANNEL, 'key-1')).toEqual({ data: { uid: 'abc' } });
    });

    it('scopes cache entries by channel — the same key on a different channel misses', () => {
      idempotency.storeResponse(ELIGIBLE_CHANNEL, 'key-1', { data: { uid: 'abc' } });
      expect(idempotency.getCachedResponse(CHANNELS.RENDERER_NEW_FOLDER, 'key-1')).toBeNull();
    });

    it('does not store anything for a channel outside the allowlist', () => {
      idempotency.storeResponse(INELIGIBLE_CHANNEL, 'key-1', { data: { echoed: 'x' } });
      expect(idempotency.getCachedResponse(INELIGIBLE_CHANNEL, 'key-1')).toBeNull();
    });

    it('ignores a falsy idempotencyKey on both read and write', () => {
      idempotency.storeResponse(ELIGIBLE_CHANNEL, null, { data: { uid: 'abc' } });
      expect(idempotency.getCachedResponse(ELIGIBLE_CHANNEL, null)).toBeNull();
      expect(idempotency.getCachedResponse(ELIGIBLE_CHANNEL, '')).toBeNull();
    });

    it('expires an entry once its TTL has elapsed (lazy expiry on read)', () => {
      const realNow = Date.now;
      try {
        Date.now = () => 1000;
        idempotency.storeResponse(ELIGIBLE_CHANNEL, 'key-1', { data: { uid: 'abc' } });

        Date.now = () => 1000 + idempotency.IDEMPOTENCY_TTL_MS - 1;
        expect(idempotency.getCachedResponse(ELIGIBLE_CHANNEL, 'key-1')).toEqual({ data: { uid: 'abc' } });

        Date.now = () => 1000 + idempotency.IDEMPOTENCY_TTL_MS + 1;
        expect(idempotency.getCachedResponse(ELIGIBLE_CHANNEL, 'key-1')).toBeNull();
      } finally {
        Date.now = realNow;
      }
    });

    it('evicts the oldest entry once MAX_ENTRIES is reached', () => {
      for (let i = 0; i < idempotency.MAX_ENTRIES; i++) {
        idempotency.storeResponse(ELIGIBLE_CHANNEL, `key-${i}`, { data: { uid: `uid-${i}` } });
      }
      expect(idempotency.getCachedResponse(ELIGIBLE_CHANNEL, 'key-0')).not.toBeNull();

      idempotency.storeResponse(ELIGIBLE_CHANNEL, 'key-overflow', { data: { uid: 'overflow' } });

      expect(idempotency.getCachedResponse(ELIGIBLE_CHANNEL, 'key-0')).toBeNull();
      expect(idempotency.getCachedResponse(ELIGIBLE_CHANNEL, 'key-overflow')).toEqual({ data: { uid: 'overflow' } });
    });
  });
});
