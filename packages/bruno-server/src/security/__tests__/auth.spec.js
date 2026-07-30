/**
 * auth.js reads BRUNO_SERVER_REQUIRE_AUTH once at module-require time (it
 * also generates the bootstrap token then), so each scenario re-requires
 * the module via jest.isolateModules() to get a fresh evaluation.
 */
const loadModule = () => {
  let mod;
  jest.isolateModules(() => {
    mod = require('../auth');
  });
  return mod;
};

describe('Bridge authentication', () => {
  const originalEnv = process.env.BRUNO_SERVER_REQUIRE_AUTH;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.BRUNO_SERVER_REQUIRE_AUTH;
    else process.env.BRUNO_SERVER_REQUIRE_AUTH = originalEnv;
    jest.restoreAllMocks();
  });

  describe('disabled (BRUNO_SERVER_REQUIRE_AUTH unset)', () => {
    it('reports auth as not required and lets every request through', () => {
      delete process.env.BRUNO_SERVER_REQUIRE_AUTH;
      const { isAuthRequired, requireAuth, verifyBootstrapToken, bootstrapToken } = loadModule();

      expect(isAuthRequired()).toBe(false);
      expect(bootstrapToken).toBeNull();
      expect(verifyBootstrapToken('anything')).toBe(false);

      const next = jest.fn();
      requireAuth({ headers: {}, method: 'POST' }, {}, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('enabled (BRUNO_SERVER_REQUIRE_AUTH=true)', () => {
    let auth;

    beforeEach(() => {
      process.env.BRUNO_SERVER_REQUIRE_AUTH = 'true';
      auth = loadModule();
    });

    it('generates a random 64-char hex bootstrap token at load time', () => {
      expect(auth.bootstrapToken).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifyBootstrapToken accepts only the exact configured token', () => {
      expect(auth.verifyBootstrapToken(auth.bootstrapToken)).toBe(true);
      expect(auth.verifyBootstrapToken('wrong-token')).toBe(false);
      expect(auth.verifyBootstrapToken('')).toBe(false);
      expect(auth.verifyBootstrapToken(undefined)).toBe(false);
    });

    it('createSession then getSession round-trips a valid session', () => {
      const { sessionId, csrfToken } = auth.createSession();
      const session = auth.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session.csrfToken).toBe(csrfToken);
    });

    it('getSession returns null for an unknown session id', () => {
      expect(auth.getSession('does-not-exist')).toBeNull();
    });

    it('getSession returns null once the session has expired', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      const { sessionId } = auth.createSession();

      nowSpy.mockReturnValue(1_000_000 + 25 * 60 * 60 * 1000); // +25h, past the 24h TTL
      expect(auth.getSession(sessionId)).toBeNull();
    });

    it('revokeSession removes an active session', () => {
      const { sessionId } = auth.createSession();
      auth.revokeSession(sessionId);
      expect(auth.getSession(sessionId)).toBeNull();
    });

    it('requireAuth rejects requests with no session cookie', () => {
      const json = jest.fn();
      const res = { status: jest.fn(() => ({ json })) };
      const next = jest.fn();

      auth.requireAuth({ headers: {}, method: 'GET' }, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('requireAuth allows a safe GET request with just a valid session cookie', () => {
      const { sessionId } = auth.createSession();
      const next = jest.fn();
      const req = { headers: { cookie: `${auth.SESSION_COOKIE_NAME}=${sessionId}` }, method: 'GET' };

      auth.requireAuth(req, {}, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.brunoSessionId).toBe(sessionId);
    });

    it('requireAuth rejects a POST with a valid session but missing CSRF header', () => {
      const { sessionId } = auth.createSession();
      const json = jest.fn();
      const res = { status: jest.fn(() => ({ json })) };
      const next = jest.fn();
      const req = { headers: { cookie: `${auth.SESSION_COOKIE_NAME}=${sessionId}` }, method: 'POST' };

      auth.requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CSRF_INVALID' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('requireAuth rejects a POST with a valid session but wrong CSRF token', () => {
      const { sessionId } = auth.createSession();
      const next = jest.fn();
      const res = { status: jest.fn(() => ({ json: jest.fn() })) };
      const req = {
        headers: { cookie: `${auth.SESSION_COOKIE_NAME}=${sessionId}`, 'x-csrf-token': 'wrong' },
        method: 'POST'
      };

      auth.requireAuth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('requireAuth allows a POST with a valid session and matching CSRF token', () => {
      const { sessionId, csrfToken } = auth.createSession();
      const next = jest.fn();
      const req = {
        headers: { cookie: `${auth.SESSION_COOKIE_NAME}=${sessionId}`, 'x-csrf-token': csrfToken },
        method: 'POST'
      };

      auth.requireAuth(req, {}, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('isSessionCookieValid mirrors requireAuth session validity for WS handshakes', () => {
      const { sessionId } = auth.createSession();
      expect(auth.isSessionCookieValid(`${auth.SESSION_COOKIE_NAME}=${sessionId}`)).toBe(true);
      expect(auth.isSessionCookieValid(`${auth.SESSION_COOKIE_NAME}=nope`)).toBe(false);
      expect(auth.isSessionCookieValid(undefined)).toBe(false);
    });

    it('parseCookies handles multiple cookies and URI-encoded values', () => {
      const cookies = auth.parseCookies('a=1; b=hello%20world; c=');
      expect(cookies).toEqual({ a: '1', b: 'hello world', c: '' });
    });
  });
});
