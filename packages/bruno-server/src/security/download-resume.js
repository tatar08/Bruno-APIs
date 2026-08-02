/**
 * Download Resume Token Registry — resumable Transfer Center downloads
 * (Improvement.md P1.1).
 *
 * The export handlers behind /api/downloads/:channel (renderer:export-collection-zip,
 * renderer:export-workspace) regenerate their zip from scratch on every
 * invocation — two independent calls with the same args are not guaranteed
 * to produce byte-identical output (archive timestamps, entry ordering).
 * That means a naive "just retry the whole request with a Range header"
 * approach is unsafe: a client resuming against a *freshly regenerated*
 * file could receive bytes that don't align with what it already has,
 * silently corrupting the saved file past the checksum's ability to catch
 * it (the checksum only covers one response's bytes, not a spliced
 * together file from two different generations).
 *
 * This registry closes that gap: the FIRST request generates the export
 * once, registers its already-written scratch tempPath under a random
 * `resumeToken`, and returns that token in a response header. If the
 * download stream breaks partway through, the client can retry with that
 * same token — the route (see routes/downloads.js) skips re-invoking the
 * handler entirely and re-serves the *exact same file*, letting Express's
 * built-in Range/206 support (via the `send` package underneath
 * res.download) resume from the client's last received byte.
 *
 * Deliberately scoped to downloads only. Resumable *uploads* would need an
 * entirely different protocol (chunked PUT/PATCH with server-side partial-
 * file accumulation) since there's no equivalent "just re-serve what's
 * already on disk" shortcut on the write side — judged out of scope for
 * this increment (see Improvement.md's P1.1 write-up).
 *
 * In-memory Map with lazy TTL expiry, same pattern as auth.js's `sessions`
 * Map and security/idempotency.js. TTL is short (a few minutes) because a
 * resume attempt is expected to follow a network blip almost immediately,
 * not be a long-lived download-later mechanism — the underlying scratch
 * file is still cleaned up within an hour regardless by uploads.js/
 * downloads.js's existing SCRATCH_DIR sweep even if a token is never
 * explicitly reclaimed. Bounded by MAX_ENTRIES (evicts the oldest entry on
 * overflow) for the same reason idempotency.js is.
 */

const crypto = require('crypto');

const DOWNLOAD_RESUME_TTL_MS = Number(process.env.BRUNO_SERVER_DOWNLOAD_RESUME_TTL_MS) || 3 * 60 * 1000;
const MAX_ENTRIES = Number(process.env.BRUNO_SERVER_DOWNLOAD_RESUME_MAX_ENTRIES) || 500;

// resumeToken -> { tempPath, sessionKey, sha256, downloadName, expiresAt }
const registry = new Map();

function createResumeToken({ tempPath, sessionKey, sha256, downloadName }) {
  const resumeToken = crypto.randomUUID();

  if (registry.size >= MAX_ENTRIES) {
    const oldestKey = registry.keys().next().value;
    registry.delete(oldestKey);
  }

  registry.set(resumeToken, {
    tempPath,
    sessionKey,
    sha256,
    downloadName,
    expiresAt: Date.now() + DOWNLOAD_RESUME_TTL_MS
  });

  return resumeToken;
}

// Returns the entry only if it exists, hasn't expired, and belongs to the
// same client that created it (a resume token must never let one client
// pull another client's in-progress export).
function getResumeEntry(resumeToken, sessionKey) {
  if (!resumeToken) return null;

  const entry = registry.get(resumeToken);
  if (!entry) return null;

  if (entry.expiresAt < Date.now()) {
    registry.delete(resumeToken);
    return null;
  }

  if (entry.sessionKey !== sessionKey) return null;

  return entry;
}

function discardResumeToken(resumeToken) {
  registry.delete(resumeToken);
}

module.exports = {
  createResumeToken,
  getResumeEntry,
  discardResumeToken,
  DOWNLOAD_RESUME_TTL_MS,
  MAX_ENTRIES
};
