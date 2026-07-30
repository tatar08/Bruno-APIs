/**
 * Per-session resource caps (Improvement.md P0.4 — last remaining item).
 *
 * There is no "user" identity anywhere in this codebase — P0.1 auth issues
 * anonymous sessions from a single shared bootstrap token (see auth.js,
 * THREAT_MODEL.md accepted-risk item 2: the token is deliberately reusable
 * so multiple people/tabs can share one Bridge). "Per-user resource limit"
 * from Improvement.md therefore has no literal "user" to key by; the closest
 * meaningful equivalent is capping what a single *session* can accumulate
 * (terminals, watched paths) plus a cap on total concurrent sessions the
 * server will admit at all, which is the only lever available to bound
 * server-wide resource growth when sessions themselves are unauthenticated
 * beyond possession of the bootstrap token.
 *
 * All three are generous-by-default availability safety nets (same
 * philosophy as ipc-limits.js), not access-control — they stop one session
 * from unbounded resource accumulation (accidental or malicious script
 * hammering terminal:create in a loop), not from doing normal interactive
 * work. Each is tunable via env var for deployments that need tighter or
 * looser bounds.
 */

const MAX_TERMINALS_PER_SESSION = Number(process.env.BRUNO_SERVER_MAX_TERMINALS_PER_SESSION) || 10;
const MAX_WATCHED_PATHS_PER_SESSION = Number(process.env.BRUNO_SERVER_MAX_WATCHED_PATHS_PER_SESSION) || 20;
const MAX_CONCURRENT_SESSIONS = Number(process.env.BRUNO_SERVER_MAX_CONCURRENT_SESSIONS) || 50;

const terminalLimitExceeded = (ownedTerminalCount) => ownedTerminalCount >= MAX_TERMINALS_PER_SESSION;

const watcherLimitExceeded = (ownedWatchedPathCount) => ownedWatchedPathCount >= MAX_WATCHED_PATHS_PER_SESSION;

const sessionLimitExceeded = (currentSessionCount) => currentSessionCount >= MAX_CONCURRENT_SESSIONS;

module.exports = {
  terminalLimitExceeded,
  watcherLimitExceeded,
  sessionLimitExceeded,
  MAX_TERMINALS_PER_SESSION,
  MAX_WATCHED_PATHS_PER_SESSION,
  MAX_CONCURRENT_SESSIONS
};
