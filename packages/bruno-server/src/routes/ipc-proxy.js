/**
 * IPC Proxy Route — REST endpoint that dispatches IPC calls to handlers
 *
 * POST /api/ipc/:channel
 * Body: { args: [...] }
 * Response: { data: ... } or { error: '...' }
 */

const express = require('express');
const { isPrivilegedChannel, PRIVILEGED_CHANNELS_ENABLED } = require('../security/privileged-channels');
const { findDisallowedPath } = require('../security/allowed-roots');
const {
  checkRateLimit,
  acquireConcurrencySlot,
  releaseConcurrencySlot,
  withTimeout,
  IpcTimeoutError
} = require('../security/ipc-limits');
const { getCapability } = require('../security/channel-capabilities');
const { getMaxPayloadBytes, validateArgs } = require('../security/channel-policy');
const { runWithSession } = require('../session-context');
const { recordOwner, isOwnedBy, release, getOwnedTerminals } = require('../security/terminal-ownership');
const {
  recordOwner: recordWatcherOwner,
  release: releaseWatcherOwner,
  getOwnedPaths
} = require('../security/watcher-ownership');
const { wsConnectionOwnership, grpcConnectionOwnership } = require('../security/connection-ownership');
const { terminalLimitExceeded, watcherLimitExceeded } = require('../security/resource-limits');
const { CHANNELS, ERROR_CODES } = require('@usebruno/rpc-contract');

// terminal:input/resize/kill all take the target terminal sessionId as their
// first argument (enforced by CHANNEL_SCHEMAS in channel-policy.js, so args[0]
// is guaranteed to be a string by the time the ownership check below runs).
const TERMINAL_ACTION_CHANNELS = new Set([CHANNELS.TERMINAL_INPUT, CHANNELS.TERMINAL_RESIZE, CHANNELS.TERMINAL_KILL]);

// renderer:ws:send-message/close-connection and grpc:send-message take the
// connection's requestId as args[0] (a raw string — see
// ws-event-handlers.js / grpc-event-handlers.js). grpc:end-request/cancel-request
// take it as args[0].requestId instead (an object), so they're handled
// separately below rather than folded into these sets.
const WS_CONNECTION_ACTION_CHANNELS = new Set([CHANNELS.RENDERER_WS_SEND_MESSAGE, CHANNELS.RENDERER_WS_CLOSE_CONNECTION]);
const GRPC_CONNECTION_ACTION_CHANNELS = new Set([CHANNELS.GRPC_SEND_MESSAGE]);
const GRPC_CONNECTION_ACTION_CHANNELS_BY_PARAM = new Set([CHANNELS.GRPC_END_REQUEST, CHANNELS.GRPC_CANCEL_REQUEST]);

const createIpcProxyRouter = (handlerRegistry, windowShim, createFakeEvent) => {
  const router = express.Router();

  /**
   * POST /api/ipc/:channel
   *
   * Accepts IPC channel name as URL param and args in the body.
   * Dispatches to the registered handler and returns the result.
   */
  router.post('/:channel', async (req, res) => {
    const { channel } = req.params;
    const { args = [], fireAndForget = false } = req.body;
    // Improvement.md P1.2: BrowserTransport generates one of these per HTTP
    // call so a hung/timed-out request can be correlated between the
    // client's console and this server's logs. Purely informational --
    // absent for any client that doesn't send it (e.g. direct API callers).
    const requestId = req.headers['x-request-id'] || null;

    if (isPrivilegedChannel(channel) && !PRIVILEGED_CHANNELS_ENABLED) {
      return res.status(403).json({
        code: ERROR_CODES.PRIVILEGED_CHANNEL_DISABLED,
        error: `Channel "${channel}" is disabled by default in Browser Bridge mode (terminal execution / git clone-connect). Set BRUNO_SERVER_ENABLE_PRIVILEGED_CHANNELS=true to enable it.`
      });
    }

    const sourceFile = handlerRegistry.getChannelSource(channel);
    const maxPayloadBytes = getMaxPayloadBytes(channel, sourceFile);
    const contentLength = Number(req.headers['content-length']);
    if (maxPayloadBytes !== null && Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
      return res.status(413).json({
        code: ERROR_CODES.PAYLOAD_TOO_LARGE,
        error: `Payload too large for channel "${channel}" (capability "${getCapability(channel, sourceFile)}"): ${contentLength} bytes exceeds the ${maxPayloadBytes} byte limit for this channel type.`
      });
    }

    const argsError = validateArgs(channel, args);
    if (argsError) {
      return res.status(400).json({ code: ERROR_CODES.INVALID_ARGS, error: argsError });
    }

    const disallowedPath = findDisallowedPath(channel, args);
    if (disallowedPath) {
      return res.status(403).json({
        code: ERROR_CODES.PATH_OUTSIDE_ALLOWED_ROOT,
        error: `Path "${disallowedPath}" is outside the allowed roots configured for this Bridge (BRUNO_SERVER_ALLOWED_ROOTS).`
      });
    }

    // Terminal process isolation (Improvement.md P0.4): only meaningful once
    // a P0.1 auth session exists to scope by — see terminal-ownership.js.
    if (req.brunoSessionId && TERMINAL_ACTION_CHANNELS.has(channel) && !isOwnedBy(req.brunoSessionId, args[0])) {
      return res.status(403).json({
        code: ERROR_CODES.TERMINAL_ACCESS_DENIED,
        error: `Terminal session "${args[0]}" belongs to a different Browser Bridge session.`
      });
    }

    // WebSocket/gRPC connection isolation (Improvement.md P0.4) — see
    // connection-ownership.js. requestId location differs by channel: a raw
    // args[0] for send-message/close-connection, but args[0].requestId for
    // grpc:end-request/cancel-request.
    if (req.brunoSessionId) {
      if (WS_CONNECTION_ACTION_CHANNELS.has(channel) && !wsConnectionOwnership.isOwnedBy(req.brunoSessionId, args[0])) {
        return res.status(403).json({
          code: ERROR_CODES.CONNECTION_ACCESS_DENIED,
          error: `WebSocket connection "${args[0]}" belongs to a different Browser Bridge session.`
        });
      }

      if (GRPC_CONNECTION_ACTION_CHANNELS.has(channel) && !grpcConnectionOwnership.isOwnedBy(req.brunoSessionId, args[0])) {
        return res.status(403).json({
          code: ERROR_CODES.CONNECTION_ACCESS_DENIED,
          error: `gRPC connection "${args[0]}" belongs to a different Browser Bridge session.`
        });
      }

      if (
        GRPC_CONNECTION_ACTION_CHANNELS_BY_PARAM.has(channel) &&
        !grpcConnectionOwnership.isOwnedBy(req.brunoSessionId, args[0]?.requestId)
      ) {
        return res.status(403).json({
          code: ERROR_CODES.CONNECTION_ACCESS_DENIED,
          error: `gRPC connection "${args[0]?.requestId}" belongs to a different Browser Bridge session.`
        });
      }
    }

    // Per-session resource caps (Improvement.md P0.4) — see resource-limits.js
    // for why this is per-session rather than per-user. Checked before
    // dispatch so a session already at its cap can't create one more.
    if (req.brunoSessionId) {
      if (channel === CHANNELS.TERMINAL_CREATE && terminalLimitExceeded(getOwnedTerminals(req.brunoSessionId).length)) {
        return res.status(429).json({
          code: ERROR_CODES.RESOURCE_LIMIT_EXCEEDED,
          error: 'This session has reached its terminal limit (BRUNO_SERVER_MAX_TERMINALS_PER_SESSION). Close an existing terminal and try again.'
        });
      }

      if (
        (channel === CHANNELS.RENDERER_OPEN_MULTIPLE_COLLECTIONS || channel === CHANNELS.RENDERER_ADD_COLLECTION_WATCHER) &&
        watcherLimitExceeded(getOwnedPaths(req.brunoSessionId).length)
      ) {
        return res.status(429).json({
          code: ERROR_CODES.RESOURCE_LIMIT_EXCEEDED,
          error: 'This session has reached its watched-collection limit (BRUNO_SERVER_MAX_WATCHED_PATHS_PER_SESSION). Close an existing collection and try again.'
        });
      }
    }

    // Sessions (when auth is enabled) identify a client more precisely than
    // IP alone (e.g. multiple tabs behind the same NAT/proxy); fall back to
    // IP when auth is off, same as the WebSocket rate limiter's per-connection scope.
    const clientKey = req.brunoSessionId || req.ip;

    if (!checkRateLimit(clientKey)) {
      return res.status(429).json({ code: ERROR_CODES.RATE_LIMITED, error: 'Too many IPC requests, slow down.' });
    }

    if (!acquireConcurrencySlot(clientKey)) {
      return res.status(429).json({ code: ERROR_CODES.CONCURRENCY_LIMITED, error: 'Too many concurrent IPC requests in flight.' });
    }

    const isEvent = fireAndForget && handlerRegistry.hasEvent(channel);

    // invoke maps to ipcMain.handle while send maps to ipcMain.on. Supporting
    // both keeps browser actions consistent with the desktop preload API.
    if (!handlerRegistry.has(channel) && !isEvent) {
      releaseConcurrencySlot(clientKey);
      return res.status(404).json({
        code: ERROR_CODES.HANDLER_NOT_FOUND,
        error: `No handler registered for channel: ${channel}`,
        availableChannels: handlerRegistry.getChannels().slice(0, 20) // Show first 20 for debugging
      });
    }

    try {
      const fakeEvent = createFakeEvent(windowShim);
      const dispatchHandler = () =>
        isEvent ? handlerRegistry.emit(channel, fakeEvent, ...args) : handlerRegistry.invoke(channel, fakeEvent, ...args);

      // Only session-scope the call (and therefore any events it triggers
      // via WindowShim, see session-context.js) when P0.1 auth identified a
      // real session; without one there's no way to distinguish clients, so
      // events fall back to the original global broadcast.
      const dispatch = req.brunoSessionId ? runWithSession(req.brunoSessionId, dispatchHandler) : dispatchHandler();
      const result = await withTimeout(Promise.resolve(dispatch), channel);

      // Track/release terminal ownership (see terminal-ownership.js) so the
      // access check above and the list-sessions filter below have data to
      // work with. No-ops when there's no auth session to scope by.
      if (channel === CHANNELS.TERMINAL_CREATE && req.brunoSessionId && result) {
        recordOwner(req.brunoSessionId, result);
      } else if (channel === CHANNELS.TERMINAL_KILL) {
        release(args[0]);
      }

      // Track/release collection-watcher ownership (see watcher-ownership.js)
      // so a departing session's logout cleanup knows which watchers it's
      // still relying on. No-op when there's no auth session to scope by.
      if (req.brunoSessionId) {
        if (channel === CHANNELS.RENDERER_OPEN_MULTIPLE_COLLECTIONS && Array.isArray(result?.opened)) {
          result.opened.forEach((watchPath) => recordWatcherOwner(watchPath, req.brunoSessionId));
        } else if (channel === CHANNELS.RENDERER_ADD_COLLECTION_WATCHER && result?.success) {
          recordWatcherOwner(args[0]?.collectionPath, req.brunoSessionId);
        } else if (channel === CHANNELS.RENDERER_REMOVE_COLLECTION) {
          releaseWatcherOwner(args[0], req.brunoSessionId);
        }
      }

      // Track/release WebSocket/gRPC connection ownership (see
      // connection-ownership.js). start-connection doesn't return the
      // connection id (only { success }), so it's read back from the
      // request the caller sent in — the same uid wsClient/grpcClient key
      // their internal connection map by. No-op when there's no auth
      // session to scope by.
      if (req.brunoSessionId) {
        if (channel === CHANNELS.RENDERER_WS_START_CONNECTION && result?.success) {
          wsConnectionOwnership.recordOwner(req.brunoSessionId, args[0]?.request?.uid);
        } else if (channel === CHANNELS.RENDERER_WS_CLOSE_CONNECTION) {
          wsConnectionOwnership.release(args[0]);
        } else if (channel === CHANNELS.GRPC_START_CONNECTION && result?.success) {
          grpcConnectionOwnership.recordOwner(req.brunoSessionId, args[0]?.request?.uid);
        } else if (channel === CHANNELS.GRPC_END_REQUEST || channel === CHANNELS.GRPC_CANCEL_REQUEST) {
          grpcConnectionOwnership.release(args[0]?.requestId);
        }
      }

      if (fireAndForget) {
        return res.json({ ok: true });
      }

      let responseData = result;
      if (req.brunoSessionId) {
        if (channel === CHANNELS.TERMINAL_LIST_SESSIONS && Array.isArray(result)) {
          responseData = result.filter((session) => isOwnedBy(req.brunoSessionId, session.sessionId));
        } else if (channel === CHANNELS.RENDERER_WS_GET_ACTIVE_CONNECTIONS && Array.isArray(result?.activeConnectionIds)) {
          responseData = {
            ...result,
            activeConnectionIds: result.activeConnectionIds.filter((id) => wsConnectionOwnership.isOwnedBy(req.brunoSessionId, id))
          };
        } else if (channel === CHANNELS.GRPC_GET_ACTIVE_CONNECTIONS && Array.isArray(result?.activeConnectionIds)) {
          responseData = {
            ...result,
            activeConnectionIds: result.activeConnectionIds.filter((id) => grpcConnectionOwnership.isOwnedBy(req.brunoSessionId, id))
          };
        }
      }

      return res.json({ data: responseData !== undefined ? responseData : null });
    } catch (err) {
      if (err instanceof IpcTimeoutError) {
        console.error(`[IPC Proxy] Timeout in handler "${channel}"${requestId ? ` (requestId=${requestId})` : ''}`);
        return res.status(504).json({ code: ERROR_CODES.HANDLER_TIMEOUT, error: err.message, requestId });
      }

      console.error(`[IPC Proxy] Error in handler "${channel}"${requestId ? ` (requestId=${requestId})` : ''}:`, err.message);

      return res.status(500).json({
        code: ERROR_CODES.HANDLER_ERROR,
        error: err.message || 'Internal server error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        requestId
      });
    } finally {
      releaseConcurrencySlot(clientKey);
    }
  });

  /**
   * GET /api/ipc/channels
   * Lists all registered IPC channels (for debugging)
   */
  router.get('/channels', (req, res) => {
    const describeChannel = (channel) => {
      const sourceFile = handlerRegistry.getChannelSource(channel);
      return { channel, capability: getCapability(channel, sourceFile) };
    };

    res.json({
      channels: handlerRegistry.getChannels(),
      eventChannels: handlerRegistry.getEventChannels(),
      count: handlerRegistry.getChannels().length,
      eventCount: handlerRegistry.getEventChannels().length,
      capabilities: [
        ...handlerRegistry.getChannels().map(describeChannel),
        ...handlerRegistry.getEventChannels().map(describeChannel)
      ]
    });
  });

  return router;
};

module.exports = { createIpcProxyRouter };
