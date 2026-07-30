/**
 * Terminal process ownership (Improvement.md P0.4 — "isolate terminal
 * processes").
 *
 * bruno-electron's TerminalManager (packages/bruno-electron/src/ipc/terminal.js)
 * has no concept of a Browser Bridge session — it keys terminals purely by
 * the sessionId string returned from `terminal:create` and applies no
 * ownership check to `terminal:input`/`resize`/`kill`. In desktop Electron
 * that's fine (one OS user, one window). Over the Bridge with multiple
 * authenticated browser sessions sharing one server process, any session
 * that learns another session's terminal sessionId (e.g. by observing it in
 * a shared log, or just guessing the low-entropy `terminal_<ts>_<rand5>`
 * format) could otherwise write input to, resize, or kill someone else's
 * shell — this module closes that gap without touching bruno-electron.
 *
 * Ownership is only tracked/enforced when a P0.1 auth session exists
 * (`req.brunoSessionId`); with auth off there's no session to scope by, so
 * every check here is a no-op and behavior is unchanged from before this
 * feature existed — consistent with every other P0.4 control.
 *
 * An unrecorded (untracked) terminal is treated as unowned and allowed
 * through `isOwnedBy`, rather than denied. The only way a terminal ends up
 * untracked while auth is on is a bug in the ipc-proxy.js wiring, not a
 * legitimate state this map is ever meant to reach in normal operation —
 * failing open here means such a bug degrades to "P0.4 isolation didn't
 * apply this once" rather than locking a user out of their own terminal.
 */

const owners = new Map(); // terminalSessionId -> owning brunoSessionId

function recordOwner(ownerSessionId, terminalSessionId) {
  if (!ownerSessionId || !terminalSessionId) return;
  owners.set(terminalSessionId, ownerSessionId);
}

function getOwner(terminalSessionId) {
  return owners.get(terminalSessionId) || null;
}

function isOwnedBy(ownerSessionId, terminalSessionId) {
  const owner = owners.get(terminalSessionId);
  return owner === undefined || owner === ownerSessionId;
}

function release(terminalSessionId) {
  owners.delete(terminalSessionId);
}

module.exports = { recordOwner, getOwner, isOwnedBy, release };
