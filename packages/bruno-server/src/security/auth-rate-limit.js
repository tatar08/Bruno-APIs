/**
 * Auth Endpoint Rate Limit — throttles POST /api/auth/session (Improvement.md
 * P0.1 follow-up, see THREAT_MODEL.md's accepted-risk list).
 *
 * ipc-limits.js's rate limiter only covers /api/ipc/:channel; the bootstrap
 * token exchange itself had no limit at all, so any client that can reach
 * the Bridge's HTTP port could fire an unbounded number of exchange attempts.
 * The 256-bit random bootstrap token makes brute-forcing it computationally
 * infeasible regardless, so this isn't closing a guessing vector — it's
 * closing the availability gap (unlimited request processing/response work
 * per attempt) and matching the "every endpoint gets a rate limit" pattern
 * used everywhere else in this codebase.
 *
 * Keyed by IP rather than session, since a client hitting this endpoint
 * doesn't have a session yet. Limits are intentionally much tighter than the
 * general IPC rate limit — this is a login endpoint, not a data endpoint,
 * and legitimate use rarely needs more than a handful of attempts (the
 * frontend only exchanges the token once per browser; the resulting cookie
 * is shared across tabs of the same origin automatically).
 */

const { createSlidingWindowLimiter } = require('./ipc-limits');

const RATE_LIMIT = Number(process.env.BRUNO_SERVER_AUTH_RATE_LIMIT) || 10;
const RATE_WINDOW_MS = Number(process.env.BRUNO_SERVER_AUTH_RATE_WINDOW_MS) || 5 * 60 * 1000;

const checkAuthRateLimit = createSlidingWindowLimiter(RATE_LIMIT, RATE_WINDOW_MS);

module.exports = { checkAuthRateLimit, RATE_LIMIT, RATE_WINDOW_MS };
