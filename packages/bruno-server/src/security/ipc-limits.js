/**
 * IPC Call Limits — per-client rate limit, concurrency limit and execution
 * timeout for POST /api/ipc/:channel (Improvement.md P0.2).
 *
 * Unlike the privileged-channel allowlist or the filesystem sandbox, these
 * limits apply to every channel: any client that can reach the Bridge's
 * HTTP port can otherwise fire unlimited concurrent/parallel IPC calls,
 * including calls that never resolve (e.g. a hung handler holding the HTTP
 * response open indefinitely). All three are on by default with generous
 * limits, since — unlike auth — they're a pure availability safety net with
 * no UX-visible behavior change for normal usage; each is still tunable via
 * env var for deployments that need tighter or looser bounds.
 */

const RATE_LIMIT = Number(process.env.BRUNO_SERVER_IPC_RATE_LIMIT) || 200;
const RATE_WINDOW_MS = Number(process.env.BRUNO_SERVER_IPC_RATE_WINDOW_MS) || 10000;
const MAX_CONCURRENT = Number(process.env.BRUNO_SERVER_IPC_MAX_CONCURRENT) || 40;
const TIMEOUT_MS = Number(process.env.BRUNO_SERVER_IPC_TIMEOUT_MS) || 30000;

/**
 * A sliding-window rate limiter keyed by an arbitrary client key. Factored
 * out so other endpoints with different limits (e.g. auth-rate-limit.js)
 * can reuse the same algorithm without duplicating it or sharing state with
 * the IPC limiter below.
 */
function createSlidingWindowLimiter(limit, windowMs) {
  const timestampsByClient = new Map(); // clientKey -> number[]

  return function check(clientKey) {
    const now = Date.now();
    const timestamps = (timestampsByClient.get(clientKey) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= limit) {
      timestampsByClient.set(clientKey, timestamps);
      return false;
    }

    timestamps.push(now);
    timestampsByClient.set(clientKey, timestamps);
    return true;
  };
}

const checkRateLimit = createSlidingWindowLimiter(RATE_LIMIT, RATE_WINDOW_MS);
const activeCounts = new Map(); // clientKey -> number

function acquireConcurrencySlot(clientKey) {
  const current = activeCounts.get(clientKey) || 0;

  if (current >= MAX_CONCURRENT) {
    return false;
  }

  activeCounts.set(clientKey, current + 1);
  return true;
}

function releaseConcurrencySlot(clientKey) {
  const current = activeCounts.get(clientKey) || 0;
  if (current <= 1) {
    activeCounts.delete(clientKey);
  } else {
    activeCounts.set(clientKey, current - 1);
  }
}

class IpcTimeoutError extends Error {
  constructor(channel) {
    super(`Channel "${channel}" did not respond within ${TIMEOUT_MS}ms`);
    this.name = 'IpcTimeoutError';
  }
}

function withTimeout(promise, channel) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new IpcTimeoutError(channel)), TIMEOUT_MS);
    timer.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

module.exports = {
  checkRateLimit,
  acquireConcurrencySlot,
  releaseConcurrencySlot,
  withTimeout,
  IpcTimeoutError,
  createSlidingWindowLimiter,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  MAX_CONCURRENT,
  TIMEOUT_MS
};
