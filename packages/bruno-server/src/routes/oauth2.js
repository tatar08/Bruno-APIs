/**
 * OAuth2 loopback callback route (Improvement.md P1.5) — the redirect_uri
 * IdPs send users back to after login/consent, when an OAuth2 request is
 * proxied through the Browser Bridge. index.js's app.browserBridge.oauth2CallbackUrl
 * and oauth2.js's isBrowserBridge branch force every such request to use
 * this exact URL as its redirect_uri, so IdPs must have it registered.
 *
 * Deliberately NOT behind requireAuth: the IdP's redirect is a fresh
 * top-level navigation from the IdP's own origin, carrying no Bridge
 * session cookie or CSRF token — there'd be nothing to check. This mirrors
 * the existing desktop custom-protocol handler (handleOauth2ProtocolUrl in
 * oauth2-protocol-handler.js), which is unauthenticated by the same nature.
 * Protection instead comes from `state` unguessability (see oauth2.js's
 * generateState()) — a callback whose state doesn't match a pending
 * request is rejected, same as the desktop handler.
 */

const express = require('express');
const path = require('path');
const {
  resolveOauth2AuthorizationRequest,
  rejectOauth2AuthorizationRequest
} = require(path.join(__dirname, '../../../bruno-electron/src/utils/oauth2-protocol-handler'));
const { createSlidingWindowLimiter } = require('../security/ipc-limits');
const { logOauth2Callback } = require('../security/audit-log');

// A dedicated, tighter limiter than the general IPC one (this endpoint is a
// login callback, not a data endpoint) — same pattern as auth-rate-limit.js.
// Keyed by IP since the caller (the IdP, redirecting the user's browser)
// has no Bridge session yet at this point.
const RATE_LIMIT = Number(process.env.BRUNO_SERVER_OAUTH2_CALLBACK_RATE_LIMIT) || 30;
const RATE_WINDOW_MS = Number(process.env.BRUNO_SERVER_OAUTH2_CALLBACK_RATE_WINDOW_MS) || 60 * 1000;
const checkOauth2CallbackRateLimit = createSlidingWindowLimiter(RATE_LIMIT, RATE_WINDOW_MS);

// Static, non-reflective pages only — none of the raw query params this
// route receives (state, code, error, error_description) are ever echoed
// back into the response, since an IdP redirect is unauthenticated input
// and reflecting it would open an XSS vector on this exact endpoint.
const page = (title, message) => `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<p>${message}</p>
<p>You can close this tab and return to Bruno.</p>
</body>
</html>`;

const createOauth2CallbackRouter = () => {
  const router = express.Router();

  router.get('/callback', (req, res) => {
    if (!checkOauth2CallbackRateLimit(req.ip)) {
      return res.status(429).send(page('Too Many Requests', 'Too many OAuth2 callback attempts, slow down.'));
    }

    const { state, code, error } = req.query;

    if (typeof state !== 'string' || !state) {
      logOauth2Callback({ state: null, outcome: 'rejected: missing state' });
      return res.status(400).send(page('Authorization Failed', 'Missing or invalid state parameter.'));
    }

    if (error) {
      const errorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : null;
      const rejected = rejectOauth2AuthorizationRequest(
        new Error(JSON.stringify({ message: 'Authorization Failed!', error: String(error), errorDescription })),
        state
      );
      logOauth2Callback({ state, outcome: rejected ? 'rejected: authorization_error' : 'rejected: no matching pending request' });
      return res.status(400).send(page('Authorization Failed', 'The authorization server denied the request or returned an error.'));
    }

    if (typeof code !== 'string' || !code) {
      logOauth2Callback({ state, outcome: 'rejected: missing code' });
      return res.status(400).send(page('Authorization Failed', 'Missing authorization code.'));
    }

    const resolved = resolveOauth2AuthorizationRequest(code, state);
    if (!resolved) {
      logOauth2Callback({ state, outcome: 'rejected: no matching pending request' });
      return res
        .status(400)
        .send(page('Authorization Failed', 'This authorization request is no longer pending — it may have expired or already completed.'));
    }

    logOauth2Callback({ state, outcome: 'resolved' });
    return res.status(200).send(page('Authorization Complete', 'Authorization succeeded.'));
  });

  return router;
};

module.exports = { createOauth2CallbackRouter };
