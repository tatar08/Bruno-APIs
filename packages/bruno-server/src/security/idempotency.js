/**
 * Idempotency Key Cache — safe retries for create/save channels
 * (Improvement.md P1.2).
 *
 * A caller (BrowserTransport.retryableInvoke(), see ipc-transport.js) can
 * attach the same `idempotencyKey` to every attempt of a single logical
 * create/save action. The first attempt whose response is actually stored
 * (see storeResponse() below) short-circuits every later attempt with the
 * exact same (channel, idempotencyKey) pair: it's replayed verbatim,
 * without re-running validation, ownership checks, or the handler itself —
 * so a client that lost the response to a network blip (but whose write
 * genuinely succeeded server-side) can't accidentally create a second
 * duplicate resource by retrying.
 *
 * Deliberately scoped to a hand-picked allowlist of channels that are (a)
 * pure creates identified by a name/path the handler already treats as
 * unique — so the failure mode being fixed is a false "already exists"
 * error on retry, not a real duplicate — and (b) idempotent in the sense
 * that returning the same success payload twice is always correct from the
 * caller's point of view. See Improvement.md's own note that this is a
 * per-endpoint product-scope decision, not something to blanket-apply to
 * every channel (destructive/delete channels must never be auto-retried
 * this way).
 *
 * Only successful responses are cached. A failed attempt is intentionally
 * NOT cached and NOT replayed: unlike a lost success response, a real
 * failure (validation error, disk error, etc.) may be transient or may no
 * longer apply by the next attempt, and pinning it would make a legitimate
 * next attempt un-retryable for the rest of the TTL window.
 *
 * Known accepted limitation: this only protects against a retry sent
 * *after* the original attempt finished server-side. Two attempts with the
 * same key genuinely in flight at once (e.g. a client retries before the
 * first attempt's handler has returned) are not coordinated with each
 * other and can both execute — a full in-flight lock was judged out of
 * scope for this increment (see the Improvement.md P1.2 write-up).
 *
 * In-memory Map with lazy TTL expiry, same pattern as auth.js's `sessions`
 * Map: no sweep timer, entries are just checked (and dropped if stale) the
 * next time they're read. Bounded by MAX_ENTRIES (evicts the oldest entry
 * on overflow) so a client minting a fresh idempotency key on every call
 * can't grow this unboundedly between expirations.
 */

const { CHANNELS } = require('@usebruno/rpc-contract');

const IDEMPOTENCY_TTL_MS = Number(process.env.BRUNO_SERVER_IDEMPOTENCY_TTL_MS) || 5 * 60 * 1000;
const MAX_ENTRIES = Number(process.env.BRUNO_SERVER_IDEMPOTENCY_MAX_ENTRIES) || 1000;

// Kept in sync by hand with IDEMPOTENT_CHANNELS in bruno-app's
// ipc-transport.js — that side deliberately duplicates this short literal
// list rather than depending on this package; see its own comment for why.
const IDEMPOTENT_CHANNELS = new Set([
  CHANNELS.RENDERER_NEW_REQUEST,
  CHANNELS.RENDERER_NEW_FOLDER,
  CHANNELS.RENDERER_CLONE_FOLDER,
  CHANNELS.RENDERER_CREATE_ENVIRONMENT,
  CHANNELS.RENDERER_CREATE_GLOBAL_ENVIRONMENT,
  CHANNELS.RENDERER_IMPORT_COLLECTION,
  CHANNELS.RENDERER_IMPORT_COLLECTION_ZIP
]);

// `${channel}::${idempotencyKey}` -> { body, expiresAt }
const cache = new Map();

function isIdempotentChannel(channel) {
  return IDEMPOTENT_CHANNELS.has(channel);
}

function cacheKey(channel, idempotencyKey) {
  return `${channel}::${idempotencyKey}`;
}

function getCachedResponse(channel, idempotencyKey) {
  if (!idempotencyKey || !isIdempotentChannel(channel)) return null;

  const key = cacheKey(channel, idempotencyKey);
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.body;
}

function storeResponse(channel, idempotencyKey, body) {
  if (!idempotencyKey || !isIdempotentChannel(channel)) return;

  const key = cacheKey(channel, idempotencyKey);
  if (!cache.has(key) && cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }

  cache.set(key, { body, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

module.exports = {
  isIdempotentChannel,
  getCachedResponse,
  storeResponse,
  IDEMPOTENT_CHANNELS,
  IDEMPOTENCY_TTL_MS,
  MAX_ENTRIES
};
