/**
 * Session Context — tracks which authenticated session (Improvement.md P0.1)
 * is responsible for the IPC call currently in flight, so that events sent
 * via WindowShim's webContents.send() during that call can be routed back
 * to only that session's WebSocket connections (Improvement.md P0.4) instead
 * of broadcast to every connected browser tab/user.
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

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

/**
 * Runs `fn` with `sessionId` attached to the async context for the
 * duration of its execution (including through any awaited promises it
 * returns). Returns whatever `fn` returns.
 */
function runWithSession(sessionId, fn) {
  return storage.run(sessionId, fn);
}

/**
 * The session ID of the IPC call currently in flight, or undefined when
 * called outside of runWithSession (auth disabled, or an event fired
 * autonomously rather than in response to a specific client's request).
 */
function getCurrentSessionId() {
  return storage.getStore();
}

module.exports = { runWithSession, getCurrentSessionId };
