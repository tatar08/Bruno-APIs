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
        error: `Channel "${channel}" is disabled by default in Browser Bridge mode (terminal execution / git clone-connect). Set BRUNO_SERVER_ENABLE_PRIVILEGED_CHANNELS=true to enable it.`
      });
    }

    const disallowedPath = findDisallowedPath(channel, args);
    if (disallowedPath) {
      return res.status(403).json({
        error: `Path "${disallowedPath}" is outside the allowed roots configured for this Bridge (BRUNO_SERVER_ALLOWED_ROOTS).`
      });
    }

    // Sessions (when auth is enabled) identify a client more precisely than
    // IP alone (e.g. multiple tabs behind the same NAT/proxy); fall back to
    // IP when auth is off, same as the WebSocket rate limiter's per-connection scope.
    const clientKey = req.brunoSessionId || req.ip;

    if (!checkRateLimit(clientKey)) {
      return res.status(429).json({ error: 'Too many IPC requests, slow down.' });
    }

    if (!acquireConcurrencySlot(clientKey)) {
      return res.status(429).json({ error: 'Too many concurrent IPC requests in flight.' });
    }

    const isEvent = fireAndForget && handlerRegistry.hasEvent(channel);

    // invoke maps to ipcMain.handle while send maps to ipcMain.on. Supporting
    // both keeps browser actions consistent with the desktop preload API.
    if (!handlerRegistry.has(channel) && !isEvent) {
      releaseConcurrencySlot(clientKey);
      return res.status(404).json({
        error: `No handler registered for channel: ${channel}`,
        availableChannels: handlerRegistry.getChannels().slice(0, 20) // Show first 20 for debugging
      });
    }

    try {
      const fakeEvent = createFakeEvent(windowShim);
      const dispatch = isEvent
        ? handlerRegistry.emit(channel, fakeEvent, ...args)
        : handlerRegistry.invoke(channel, fakeEvent, ...args);
      const result = await withTimeout(Promise.resolve(dispatch), channel);

      if (fireAndForget) {
        return res.json({ ok: true });
      }

      return res.json({ data: result !== undefined ? result : null });
    } catch (err) {
      if (err instanceof IpcTimeoutError) {
        console.error(`[IPC Proxy] Timeout in handler "${channel}"`);
        return res.status(504).json({ error: err.message });
      }

      console.error(`[IPC Proxy] Error in handler "${channel}":`, err.message);

      return res.status(500).json({
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
    res.json({
      channels: handlerRegistry.getChannels(),
      eventChannels: handlerRegistry.getEventChannels(),
      count: handlerRegistry.getChannels().length,
      eventCount: handlerRegistry.getEventChannels().length
    });
  });

  return router;
};

module.exports = { createIpcProxyRouter };
