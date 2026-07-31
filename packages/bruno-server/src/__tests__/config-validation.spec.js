const { validateStartupConfig } = require('../config-validation');

describe('validateStartupConfig', () => {
  it('returns no errors for an empty env', () => {
    expect(validateStartupConfig({})).toEqual([]);
  });

  it('returns no errors when all recognized vars are valid', () => {
    const errors = validateStartupConfig({
      BRUNO_SERVER_PORT: '4000',
      BRUNO_SERVER_AUTH_RATE_LIMIT: '10',
      BRUNO_SERVER_AUTH_RATE_WINDOW_MS: '60000',
      BRUNO_SERVER_IPC_RATE_LIMIT: '100',
      BRUNO_SERVER_IPC_RATE_WINDOW_MS: '10000',
      BRUNO_SERVER_IPC_MAX_CONCURRENT: '20',
      BRUNO_SERVER_IPC_TIMEOUT_MS: '30000',
      BRUNO_SERVER_MAX_TERMINALS_PER_SESSION: '5',
      BRUNO_SERVER_MAX_WATCHED_PATHS_PER_SESSION: '50',
      BRUNO_SERVER_MAX_CONCURRENT_SESSIONS: '25',
      BRUNO_SERVER_JSON_LIMIT: '25mb'
    });
    expect(errors).toEqual([]);
  });

  it('ignores unrelated env vars entirely', () => {
    expect(validateStartupConfig({ PATH: '/usr/bin', HOME: '/home/x' })).toEqual([]);
  });

  describe('BRUNO_SERVER_PORT', () => {
    it.each(['0', '-1', '65536', 'abc', '3000.5', ''])('rejects "%s"', (value) => {
      const errors = validateStartupConfig({ BRUNO_SERVER_PORT: value });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_PORT')]);
    });

    it.each(['1', '65535', '4000'])('accepts "%s"', (value) => {
      expect(validateStartupConfig({ BRUNO_SERVER_PORT: value })).toEqual([]);
    });
  });

  describe.each([
    'BRUNO_SERVER_AUTH_RATE_LIMIT',
    'BRUNO_SERVER_AUTH_RATE_WINDOW_MS',
    'BRUNO_SERVER_IPC_RATE_LIMIT',
    'BRUNO_SERVER_IPC_RATE_WINDOW_MS',
    'BRUNO_SERVER_IPC_MAX_CONCURRENT',
    'BRUNO_SERVER_IPC_TIMEOUT_MS',
    'BRUNO_SERVER_MAX_TERMINALS_PER_SESSION',
    'BRUNO_SERVER_MAX_WATCHED_PATHS_PER_SESSION',
    'BRUNO_SERVER_MAX_CONCURRENT_SESSIONS'
  ])('%s', (name) => {
    it.each(['0', '-5', 'abc', '1.5', ''])('rejects "%s"', (value) => {
      const errors = validateStartupConfig({ [name]: value });
      expect(errors).toEqual([expect.stringContaining(name)]);
    });

    it('accepts a positive integer', () => {
      expect(validateStartupConfig({ [name]: '10' })).toEqual([]);
    });

    it('is not validated when unset', () => {
      expect(validateStartupConfig({})).toEqual([]);
    });
  });

  describe('BRUNO_SERVER_JSON_LIMIT', () => {
    it.each(['25mb', '25MB', '512kb', '1gb', '1000', '  10mb  '])('accepts "%s"', (value) => {
      expect(validateStartupConfig({ BRUNO_SERVER_JSON_LIMIT: value })).toEqual([]);
    });

    it.each(['abc', '25 megabytes', '-1mb', ''])('rejects "%s"', (value) => {
      const errors = validateStartupConfig({ BRUNO_SERVER_JSON_LIMIT: value });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_JSON_LIMIT')]);
    });
  });

  it('collects multiple errors across different vars at once', () => {
    const errors = validateStartupConfig({
      BRUNO_SERVER_PORT: '999999',
      BRUNO_SERVER_AUTH_RATE_LIMIT: 'nope',
      BRUNO_SERVER_JSON_LIMIT: 'nope'
    });
    expect(errors).toHaveLength(3);
  });
});
