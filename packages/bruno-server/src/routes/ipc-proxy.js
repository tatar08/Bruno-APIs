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
const { ERROR_CODES } = require('@usebruno/rpc-contract');

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

      if (fireAndForget) {
        return res.json({ ok: true });
      }

      return res.json({ data: result !== undefined ? result : null });
    } catch (err) {
      if (err instanceof IpcTimeoutError) {
        console.error(`[IPC Proxy] Timeout in handler "${channel}"`);
        return res.status(504).json({ code: ERROR_CODES.HANDLER_TIMEOUT, error: err.message });
      }

      console.error(`[IPC Proxy] Error in handler "${channel}":`, err.message);

      return res.status(500).json({
        code: ERROR_CODES.HANDLER_ERROR,
        error: err.message || 'Internal server error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
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
