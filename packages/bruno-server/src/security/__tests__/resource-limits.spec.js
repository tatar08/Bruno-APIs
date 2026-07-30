/**
 * resource-limits.js reads its BRUNO_SERVER_MAX_* env vars once at
 * module-require time, so each scenario re-requires the module via
 * jest.isolateModules() with small, deterministic limits instead of the
 * production defaults.
 */
const loadModule = (env) => {
  const keys = [
    'BRUNO_SERVER_MAX_TERMINALS_PER_SESSION',
    'BRUNO_SERVER_MAX_WATCHED_PATHS_PER_SESSION',
    'BRUNO_SERVER_MAX_CONCURRENT_SESSIONS'
  ];
  const original = {};
  keys.forEach((key) => { original[key] = process.env[key]; });
  Object.assign(process.env, env);

  let mod;
  jest.isolateModules(() => {
    mod = require('../resource-limits');
  });

  keys.forEach((key) => {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  });

  return mod;
};

describe('resource-limits', () => {
  it('defaults to 10 terminals / 20 watched paths / 50 concurrent sessions when no env vars are set', () => {
    const { MAX_TERMINALS_PER_SESSION, MAX_WATCHED_PATHS_PER_SESSION, MAX_CONCURRENT_SESSIONS } = loadModule({});
    expect(MAX_TERMINALS_PER_SESSION).toBe(10);
    expect(MAX_WATCHED_PATHS_PER_SESSION).toBe(20);
    expect(MAX_CONCURRENT_SESSIONS).toBe(50);
  });

  it('terminalLimitExceeded is false under the limit, true at/over it', () => {
    const { terminalLimitExceeded } = loadModule({ BRUNO_SERVER_MAX_TERMINALS_PER_SESSION: '3' });
    expect(terminalLimitExceeded(0)).toBe(false);
    expect(terminalLimitExceeded(2)).toBe(false);
    expect(terminalLimitExceeded(3)).toBe(true);
    expect(terminalLimitExceeded(4)).toBe(true);
  });

  it('watcherLimitExceeded is false under the limit, true at/over it', () => {
    const { watcherLimitExceeded } = loadModule({ BRUNO_SERVER_MAX_WATCHED_PATHS_PER_SESSION: '2' });
    expect(watcherLimitExceeded(1)).toBe(false);
    expect(watcherLimitExceeded(2)).toBe(true);
  });

  it('sessionLimitExceeded is false under the limit, true at/over it', () => {
    const { sessionLimitExceeded } = loadModule({ BRUNO_SERVER_MAX_CONCURRENT_SESSIONS: '5' });
    expect(sessionLimitExceeded(4)).toBe(false);
    expect(sessionLimitExceeded(5)).toBe(true);
  });
});
