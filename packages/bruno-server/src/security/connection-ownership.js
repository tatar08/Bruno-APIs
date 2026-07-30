/**
 * WebSocket / gRPC connection ownership (Improvement.md P0.4 — "isolate
 * active workspace/collection state").
 *
 * bruno-electron's WsClient and GrpcClient (packages/bruno-electron/src/ipc/network/{ws,grpc}-event-handlers.js)
 * are each a single module-level singleton whose internal connection map is
 * keyed purely by the request's `uid` (a value the *caller* supplies in
 * `renderer:ws:start-connection` / `grpc:start-connection`, since neither
 * handler returns a generated id) with no concept of a Browser Bridge
 * session. In desktop Electron that's fine (one OS user, one window). Over
 * the Bridge with multiple authenticated browser sessions sharing one server
 * process, any session that learns another session's request uid (visible
 * in a shared collection, or just guessed) could send messages into, or
 * close, that other session's live WebSocket/gRPC stream — structurally the
 * same hijack this fixed for terminals in terminal-ownership.js. This module
 * closes that gap the same way, without touching bruno-electron.
 *
 * Ownership is only tracked/enforced when a P0.1 auth session exists
 * (`req.brunoSessionId`); with auth off there's no session to scope by, so
 * every check here is a no-op and behavior is unchanged — consistent with
 * every other P0.4 control.
 *
 * An unrecorded (untracked) connection is treated as unowned and allowed
 * through `isOwnedBy`, rather than denied — see terminal-ownership.js for
 * why failing open here is the deliberate choice.
 *
 * WS and gRPC each get their own independent tracker (same request uid could
 * coincidentally be reused as both a WS and a gRPC connection id, since the
 * two client singletons don't share a namespace either).
 */

function createConnectionOwnership() {
  const owners = new Map(); // connectionId -> owning brunoSessionId

  function recordOwner(ownerSessionId, connectionId) {
    if (!ownerSessionId || !connectionId) return;
    owners.set(connectionId, ownerSessionId);
  }

  function getOwner(connectionId) {
    return owners.get(connectionId) || null;
  }

  function isOwnedBy(ownerSessionId, connectionId) {
    const owner = owners.get(connectionId);
    return owner === undefined || owner === ownerSessionId;
  }

  function release(connectionId) {
    owners.delete(connectionId);
  }

  /**
   * All connection ids currently owned by `ownerSessionId` — used to filter
   * `get-active-connections` results and, on logout (routes/auth.js), to
   * stop tracking the departing session's connections.
   */
  function getOwnedConnections(ownerSessionId) {
    const owned = [];
    for (const [connectionId, owner] of owners) {
      if (owner === ownerSessionId) owned.push(connectionId);
    }
    return owned;
  }

  return { recordOwner, getOwner, isOwnedBy, release, getOwnedConnections };
}

const wsConnectionOwnership = createConnectionOwnership();
const grpcConnectionOwnership = createConnectionOwnership();

module.exports = { createConnectionOwnership, wsConnectionOwnership, grpcConnectionOwnership };
