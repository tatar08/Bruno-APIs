/**
 * File Download Route (Improvement.md P1.1 Transfer Center)
 *
 * A subset of IPC channels (renderer:export-collection-zip,
 * renderer:export-workspace) write their output to a path on the *Bridge's*
 * own filesystem — useless to a browser tab, which has no way to retrieve a
 * file from a remote server's disk. This route runs the same handler logic
 * against a server-generated scratch path and streams the result back as a
 * real HTTP download instead.
 *
 * It deliberately does not reuse POST /api/ipc/:channel's generic dispatch:
 * that route always returns JSON, buffers args validation around a
 * capability-driven channel set the download flow doesn't need, and has no
 * way to stream a binary response. Restricting this route to a small,
 * explicitly reviewed allowlist (DOWNLOADABLE_CHANNELS) keeps the bypass
 * surface small — only channels whose (path, name, destinationPath) argument
 * shape and write-only-to-destinationPath behavior have been read and
 * confirmed are eligible.
 *
 * POST /api/downloads/:channel
 * Body: { args: [sourcePath, name] }
 * Response: the file bytes (Content-Disposition: attachment) or a JSON error.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { findPathPolicyViolation } = require('../security/allowed-roots');
const { logSandboxDenial } = require('../security/audit-log');
const { redactSecrets } = require('../security/log-redaction');
const { validateArgs } = require('../security/channel-policy');
const {
  checkRateLimit,
  acquireConcurrencySlot,
  releaseConcurrencySlot,
  withTimeout,
  IpcTimeoutError
} = require('../security/ipc-limits');
const { ERROR_CODES } = require('@usebruno/rpc-contract');

const SCRATCH_DIR = path.join(os.tmpdir(), 'bruno-bridge-transfers');
fs.mkdirSync(SCRATCH_DIR, { recursive: true });

const DOWNLOADABLE_CHANNELS = new Set(['renderer:export-collection-zip', 'renderer:export-workspace']);

const createDownloadsRouter = (handlerRegistry, windowShim, createFakeEvent) => {
  const router = express.Router();

  router.post('/:channel', async (req, res) => {
    const { channel } = req.params;
    const requestId = req.headers['x-request-id'] || null;

    if (!DOWNLOADABLE_CHANNELS.has(channel)) {
      return res.status(404).json({
        code: ERROR_CODES.HANDLER_NOT_FOUND,
        error: `Channel "${channel}" is not a downloadable channel.`
      });
    }

    const { args = [] } = req.body;
    const argsError = validateArgs(channel, args);
    if (argsError) {
      return res.status(400).json({ code: ERROR_CODES.INVALID_ARGS, error: argsError });
    }

    // Only the caller-supplied source path is subject to the filesystem
    // sandbox (Improvement.md P0.3) — the scratch destination below is
    // server-generated, never derived from client input, so it's
    // deliberately excluded from this scan (same trust boundary as the
    // internal temp dirs the underlying export handlers already use
    // themselves).
    const pathViolation = findPathPolicyViolation(channel, args);
    if (pathViolation) {
      logSandboxDenial({ channel, path: pathViolation.path, sessionId: req.brunoSessionId, requestId });
      if (pathViolation.reason === 'read-only-root') {
        return res.status(403).json({
          code: ERROR_CODES.PATH_READ_ONLY_ROOT,
          error: `Channel "${channel}" cannot read from "${pathViolation.path}": its containing root is configured read-only (BRUNO_SERVER_ALLOWED_ROOTS).`
        });
      }
      return res.status(403).json({
        code: ERROR_CODES.PATH_OUTSIDE_ALLOWED_ROOT,
        error: `Path "${pathViolation.path}" is outside the allowed roots configured for this Bridge (BRUNO_SERVER_ALLOWED_ROOTS).`
      });
    }

    const clientKey = req.brunoSessionId || req.ip;
    if (!checkRateLimit(clientKey)) {
      return res.status(429).json({ code: ERROR_CODES.RATE_LIMITED, error: 'Too many requests, slow down.' });
    }
    if (!acquireConcurrencySlot(clientKey)) {
      return res.status(429).json({ code: ERROR_CODES.CONCURRENCY_LIMITED, error: 'Too many concurrent requests in flight.' });
    }

    const tempPath = path.join(SCRATCH_DIR, `${crypto.randomUUID()}.zip`);
    const cleanup = () => fs.unlink(tempPath, () => {});

    try {
      const fakeEvent = createFakeEvent(windowShim);
      const result = await withTimeout(
        Promise.resolve(handlerRegistry.invoke(channel, fakeEvent, ...args, tempPath)),
        channel
      );

      if (!result?.success) {
        cleanup();
        return res.status(500).json({ code: ERROR_CODES.HANDLER_ERROR, error: 'Export did not produce a file.' });
      }

      const downloadName = `${String(args[1] || 'export').replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`;
      res.download(tempPath, downloadName, (err) => {
        cleanup();
        if (err && !res.headersSent) {
          console.error(`[Downloads] Error streaming "${channel}":`, redactSecrets(err.message));
        }
      });
    } catch (err) {
      cleanup();
      if (err instanceof IpcTimeoutError) {
        return res.status(504).json({ code: ERROR_CODES.HANDLER_TIMEOUT, error: err.message, requestId });
      }
      console.error(`[Downloads] Error in channel "${channel}":`, redactSecrets(err.message));
      return res.status(500).json({ code: ERROR_CODES.HANDLER_ERROR, error: err.message || 'Internal server error', requestId });
    } finally {
      releaseConcurrencySlot(clientKey);
    }
  });

  return router;
};

module.exports = { createDownloadsRouter };
