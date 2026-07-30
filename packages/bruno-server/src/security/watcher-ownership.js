/**
 * Collection filesystem-watcher ownership (Improvement.md P0.4 — "reference-
 * counted filesystem watcher cleanup on session close").
 *
 * bruno-electron's collection-watcher.js (packages/bruno-electron/src/app/
 * collection-watcher.js) keys chokidar watchers purely by collection path
 * (`this.watchers[watchPath]`) with no concept of a Browser Bridge session —
 * in desktop Electron that's fine (one window, opening a collection twice
 * just replaces the watcher). Over the Bridge, a session that opens a
 * collection and then disconnects (logout, tab close) previously left that
 * watcher running for the lifetime of the server process — the same leak
 * shape terminal-ownership.js closed for terminals.
 *
 * Unlike a terminal, a collection watcher is a *shared* resource: two
 * different Browser Bridge sessions can legitimately have the same
 * collection open at once (e.g. two browser tabs, two people). So this
 * tracks a *set* of owning sessions per watch path rather than a single
 * owner, and only signals "safe to tear down" once that set is empty —
 * closing one session must never break the watcher for another session
 * still using it.
 *
 * Ownership is only tracked when a P0.1 auth session exists
 * (`req.brunoSessionId`); with auth off there's nothing to scope by, so this
 * module is never consulted and behavior is unchanged — consistent with
 * every other P0.4 control.
 *
 * Scope note: only the two channels that represent "this session now
 * depends on this collection's watcher" in the Browser Bridge's actual UI
 * flow are tracked (see routes/ipc-proxy.js): renderer:open-multiple-
 * collections (what the browser transport rewrites renderer:open-collection
 * into — see bruno-app's ipc-transport.js) and renderer:add-collection-
 * watcher (used by the workspace mount flow). Rarer paths like renderer:
 * move-collection-to-workspace, which tear down and re-create a watcher
 * under a new path as an implementation detail of the move, aren't tracked —
 * worst case a moved collection's watcher isn't auto-cleaned on that
 * session's later logout, which is no worse than the leak this module
 * exists to close in the first place, just not fully closed for that path.
 */

const ownersByPath = new Map(); // watchPath -> Set<brunoSessionId>

function recordOwner(watchPath, sessionId) {
  if (!watchPath || !sessionId) return;
  if (!ownersByPath.has(watchPath)) ownersByPath.set(watchPath, new Set());
  ownersByPath.get(watchPath).add(sessionId);
}

/**
 * Removes sessionId's interest in watchPath.
 * @returns {boolean} true if no session has an interest in watchPath anymore
 * (i.e. it is now safe to tear down the underlying watcher).
 */
function release(watchPath, sessionId) {
  const owners = ownersByPath.get(watchPath);
  if (!owners) return true;

  owners.delete(sessionId);
  if (owners.size === 0) {
    ownersByPath.delete(watchPath);
    return true;
  }
  return false;
}

/**
 * All watch paths currently owned (in part or in full) by `sessionId` — used
 * on logout (routes/auth.js) to release that session's interest in each one
 * and tear down any watcher left with no remaining owners.
 */
function getOwnedPaths(sessionId) {
  const owned = [];
  for (const [watchPath, owners] of ownersByPath) {
    if (owners.has(sessionId)) owned.push(watchPath);
  }
  return owned;
}

module.exports = { recordOwner, release, getOwnedPaths };
