/**
 * Bridge Authentication — bootstrap token + session/CSRF (Improvement.md P0.1).
 *
 * Disabled by default (BRUNO_SERVER_REQUIRE_AUTH unset/not "true"): zero
 * behavior change, matching every other Browser Bridge security control in
 * this codebase (see origin-policy.js, privileged-channels.js,
 * allowed-roots.js). It's opt-in rather than on-by-default because turning
 * it on changes the UX of an already-shipped feature — every browser client
 * has to obtain and enter the bootstrap token before it can do anything.
 *
 * When enabled, a random bootstrap token is generated at process startup
 * and printed once to the server console. A browser client exchanges it
 * once (POST /api/auth/session) for an HttpOnly session cookie plus an
 * in-memory CSRF token returned in the response body. The CSRF token must
 * then be sent back as X-CSRF-Token on every state-changing request
 * (double-submit pattern) — the session cookie alone isn't proof of origin
 * since browsers attach cookies to same-site requests automatically
 * regardless of which page triggered them.
 */

const crypto = require('crypto');

const AUTH_REQUIRED = process.env.BRUNO_SERVER_REQUIRE_AUTH === 'true';
const SESSION_COOKIE_NAME = 'bruno_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const bootstrapToken = AUTH_REQUIRED ? crypto.randomBytes(32).toString('hex') : null;

// sessionId -> { csrfToken, expiresAt }
const sessions = new Map();

const isAuthRequired = () => AUTH_REQUIRED;

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyBootstrapToken(token) {
  if (!AUTH_REQUIRED || !bootstrapToken) return false;
  return typeof token === 'string' && token.length > 0 && timingSafeEqualStrings(token, bootstrapToken);
}

function createSession() {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, { csrfToken, expiresAt: Date.now() + SESSION_TTL_MS });
  return { sessionId, csrfToken };
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function revokeSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Total live (non-expired-at-time-of-last-touch) session count — used by
 * resource-limits.js to cap total concurrent sessions the server will admit.
 * Not lazily pruned of expired entries here (getSession() does that on
 * read), so this can overcount briefly until an expired session is next
 * looked up; acceptable for an availability safety net, not a hard bound.
 */
function getSessionCount() {
  return sessions.size;
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Express middleware. No-op when auth is disabled. When enabled, requires a
 * valid session cookie; state-changing methods additionally require a
 * matching X-CSRF-Token header.
 */
function requireAuth(req, res, next) {
  if (!AUTH_REQUIRED) return next();

  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  const session = getSession(sessionId);

  if (!session) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }

  if (!SAFE_METHODS.has(req.method)) {
    const csrfHeader = req.headers['x-csrf-token'];
    if (!csrfHeader || !timingSafeEqualStrings(csrfHeader, session.csrfToken)) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token', code: 'CSRF_INVALID' });
    }
  }

  req.brunoSessionId = sessionId;
  next();
}

/**
 * Session validity check for non-Express contexts (WebSocket handshake,
 * which only has a raw cookie header, no CSRF concept — a WS connection
 * isn't a form-submittable cross-site request).
 */
function isSessionCookieValid(cookieHeader) {
  if (!AUTH_REQUIRED) return true;
  const cookies = parseCookies(cookieHeader);
  return Boolean(getSession(cookies[SESSION_COOKIE_NAME]));
}

module.exports = {
  isAuthRequired,
  verifyBootstrapToken,
  createSession,
  getSession,
  revokeSession,
  getSessionCount,
  requireAuth,
  isSessionCookieValid,
  parseCookies,
  SESSION_COOKIE_NAME,
  bootstrapToken
};
