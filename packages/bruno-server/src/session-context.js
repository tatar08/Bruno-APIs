/**
 * Session Context — tracks which authenticated session (Improvement.md P0.1)
 * is responsible for the IPC call currently in flight, so that:
 *
 *  - events sent via WindowShim's webContents.send() during that call can be
 *    routed back to only that session's WebSocket connections instead of
 *    broadcast to every connected browser tab/user, and
 *  - HTTP cookies read/written during that call (bruno-electron's network
 *    layer, via @usebruno/requests' cookie jar) land in that session's own
 *    jar instead of a single jar shared by every Browser Bridge user.
 *
 * (both Improvement.md P0.4)
 *
 * This module is a thin wrapper around @usebruno/requests' own
 * AsyncLocalStorage-based session-key hook rather than a second, separate
 * AsyncLocalStorage instance: the cookie jar selection in
 * @usebruno/requests/src/cookies runs deep inside bruno-electron's request
 * handling, several call frames below where this server sets the context, so
 * both sides need to read the exact same storage instance for it to see the
 * session id — re-exporting keeps that guarantee without bruno-requests (a
 * lower-level package used standalone by the CLI too) needing to know
 * anything about "Browser Bridge sessions".
 *
 * Built on AsyncLocalStorage rather than threading a sessionId parameter
 * through every bruno-electron handler signature: handlers are registered
 * once at server startup with a single shared `windowShim` closed over (see
 * index.js), not re-parameterized per request, so there is no call-site to
 * pass a per-request value through even if we wanted to. AsyncLocalStorage
 * follows the async call chain (including across awaits) from the Express
 * route handler down into whatever the handler does, without changing any
 * handler signatures.
 */

const { runWithSessionKey, getCurrentSessionKey } = require('@usebruno/requests');

/**
 * Runs `fn` with `sessionId` attached to the async context for the
 * duration of its execution (including through any awaited promises it
 * returns). Returns whatever `fn` returns.
 */
function runWithSession(sessionId, fn) {
  return runWithSessionKey(sessionId, fn);
}

/**
 * The session ID of the IPC call currently in flight, or undefined when
 * called outside of runWithSession (auth disabled, or an event fired
 * autonomously rather than in response to a specific client's request).
 */
function getCurrentSessionId() {
  return getCurrentSessionKey();
}

module.exports = { runWithSession, getCurrentSessionId };
