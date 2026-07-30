/**
 * Auth routes — bootstrap-token-to-session exchange (Improvement.md P0.1).
 *
 * Only meaningfully active when BRUNO_SERVER_REQUIRE_AUTH=true; see
 * ../security/auth.js for the full design rationale.
 */

const express = require('express');
const {
  isAuthRequired,
  verifyBootstrapToken,
  createSession,
  getSession,
  revokeSession,
  requireAuth,
  parseCookies,
  SESSION_COOKIE_NAME
} = require('../security/auth');
const { getOwnedTerminals, release } = require('../security/terminal-ownership');
const { getOwnedPaths, release: releaseWatcherOwner } = require('../security/watcher-ownership');
const { checkAuthRateLimit } = require('../security/auth-rate-limit');
const { cookies: cookiesModule } = require('@usebruno/requests');
const { CHANNELS, ERROR_CODES } = require('@usebruno/rpc-contract');

/**
 * Kills every terminal the departing session owns (Improvement.md P0.4 —
 * logout previously only revoked the session record, leaving any terminal
 * processes it started running for the lifetime of the server). Best-effort:
 * a handler failing to kill one terminal shouldn't block logout or the
 * cleanup of the others, since the session is going away regardless.
 */
const cleanupSessionTerminals = async (sessionId, handlerRegistry, windowShim, createFakeEvent) => {
  if (!handlerRegistry || !handlerRegistry.hasEvent(CHANNELS.TERMINAL_KILL)) return;

  const terminalIds = getOwnedTerminals(sessionId);
  await Promise.all(
    terminalIds.map(async (terminalId) => {
      try {
        await handlerRegistry.emit(CHANNELS.TERMINAL_KILL, createFakeEvent(windowShim), terminalId);
      } catch (err) {
        console.error(`[Auth] Failed to kill terminal "${terminalId}" on logout:`, err.message);
      } finally {
        release(terminalId);
      }
    })
  );
};

/**
 * Releases the departing session's interest in every collection watcher it
 * still owns (see watcher-ownership.js) and tears down any watcher that no
 * other session is relying on anymore. `getCollectionWatcher` is a getter
 * rather than a direct reference because this router is constructed before
 * registerHandlers() has required bruno-electron's collection-watcher
 * singleton (index.js) — calling it here, at request time, always sees the
 * populated value.
 */
const cleanupSessionWatchers = (sessionId, getCollectionWatcher) => {
  const collectionWatcher = getCollectionWatcher ? getCollectionWatcher() : null;
  if (!collectionWatcher) return;

  const watchPaths = getOwnedPaths(sessionId);
  watchPaths.forEach((watchPath) => {
    const isNowUnowned = releaseWatcherOwner(watchPath, sessionId);
    if (!isNowUnowned) return;
    try {
      collectionWatcher.removeWatcher(watchPath);
    } catch (err) {
      console.error(`[Auth] Failed to remove collection watcher for "${watchPath}" on logout:`, err.message);
    }
  });
};

/**
 * Drops the departing session's in-memory cookie jar (see
 * @usebruno/requests/src/cookies — resolveJar()). Unlike terminals/watchers
 * there's nothing external to tear down here (no OS process, no filesystem
 * watch); this purely bounds memory growth on a long-lived server process
 * that accumulates one CookieJar per session that ever authenticated.
 */
const cleanupSessionCookies = (sessionId) => {
  cookiesModule.clearSessionJar(sessionId);
};

const createAuthRouter = (handlerRegistry, windowShim, createFakeEvent, getCollectionWatcher) => {
  const router = express.Router();

  // Public: lets the frontend know whether it needs to authenticate at all,
  // and whether the request's current cookie (if any) is still valid.
  router.get('/status', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const authenticated = !isAuthRequired() || Boolean(getSession(cookies[SESSION_COOKIE_NAME]));
    res.json({ authRequired: isAuthRequired(), authenticated });
  });

  // Exchange the one-time bootstrap token (printed to the server console at
  // startup) for a session cookie + CSRF token.
  router.post('/session', (req, res) => {
    if (!isAuthRequired()) {
      return res.status(400).json({ error: 'Authentication is not enabled on this server' });
    }

    if (!checkAuthRateLimit(req.ip)) {
      return res.status(429).json({
        code: ERROR_CODES.RATE_LIMITED,
        error: 'Too many authentication attempts, slow down.'
      });
    }

    const { token } = req.body || {};
    if (!verifyBootstrapToken(token)) {
      return res.status(401).json({ error: 'Invalid bootstrap token' });
    }

    const { sessionId, csrfToken } = createSession();
    res.cookie(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      path: '/',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.json({ csrfToken });
  });

  router.delete('/session', requireAuth, async (req, res) => {
    await cleanupSessionTerminals(req.brunoSessionId, handlerRegistry, windowShim, createFakeEvent);
    cleanupSessionWatchers(req.brunoSessionId, getCollectionWatcher);
    cleanupSessionCookies(req.brunoSessionId);
    revokeSession(req.brunoSessionId);
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  return router;
};

module.exports = { createAuthRouter };
