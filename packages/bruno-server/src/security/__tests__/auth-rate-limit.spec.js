/**
 * auth-rate-limit.js reads its BRUNO_SERVER_AUTH_RATE_* env vars once at
 * module-require time, so each scenario re-requires the module via
 * jest.isolateModules() with small, deterministic limits instead of the
 * production defaults.
 */
const loadModule = (env) => {
  const keys = ['BRUNO_SERVER_AUTH_RATE_LIMIT', 'BRUNO_SERVER_AUTH_RATE_WINDOW_MS'];
  const original = {};
  keys.forEach((key) => { original[key] = process.env[key]; });
  Object.assign(process.env, env);

  let mod;
  jest.isolateModules(() => {
    mod = require('../auth-rate-limit');
  });

  keys.forEach((key) => {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  });

  return mod;
};

describe('checkAuthRateLimit', () => {
  it('allows attempts under the limit and blocks once the window is full', () => {
    const { checkAuthRateLimit } = loadModule({ BRUNO_SERVER_AUTH_RATE_LIMIT: '3', BRUNO_SERVER_AUTH_RATE_WINDOW_MS: '10000' });

    expect(checkAuthRateLimit('1.2.3.4')).toBe(true);
    expect(checkAuthRateLimit('1.2.3.4')).toBe(true);
    expect(checkAuthRateLimit('1.2.3.4')).toBe(true);
    expect(checkAuthRateLimit('1.2.3.4')).toBe(false);
  });

  it('tracks separate IPs independently', () => {
    const { checkAuthRateLimit } = loadModule({ BRUNO_SERVER_AUTH_RATE_LIMIT: '1', BRUNO_SERVER_AUTH_RATE_WINDOW_MS: '10000' });

    expect(checkAuthRateLimit('1.2.3.4')).toBe(true);
    expect(checkAuthRateLimit('5.6.7.8')).toBe(true);
    expect(checkAuthRateLimit('1.2.3.4')).toBe(false);
    expect(checkAuthRateLimit('5.6.7.8')).toBe(false);
  });

  it('allows attempts again once the window has elapsed', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { checkAuthRateLimit } = loadModule({ BRUNO_SERVER_AUTH_RATE_LIMIT: '1', BRUNO_SERVER_AUTH_RATE_WINDOW_MS: '5000' });

    expect(checkAuthRateLimit('1.2.3.4')).toBe(true);
    expect(checkAuthRateLimit('1.2.3.4')).toBe(false);

    Date.now.mockReturnValue(6001);
    expect(checkAuthRateLimit('1.2.3.4')).toBe(true);

    jest.restoreAllMocks();
  });

  it('defaults to 10 attempts per 5 minutes when no env vars are set', () => {
    const { RATE_LIMIT, RATE_WINDOW_MS } = loadModule({});
    expect(RATE_LIMIT).toBe(10);
    expect(RATE_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});
