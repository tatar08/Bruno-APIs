/**
 * Startup Configuration Validation (Improvement.md P1.3)
 *
 * All BRUNO_SERVER_* env vars that expect a number currently go through a
 * `Number(process.env.X) || default` pattern at their point of use — an
 * unparseable or non-positive value silently falls back to the default
 * instead of failing, which can look like a config change "worked" when it
 * was actually ignored. Validated once, eagerly, at process start so a typo
 * fails loudly instead of silently no-op'ing.
 */

const POSITIVE_INTEGER_ENV_VARS = [
  'BRUNO_SERVER_AUTH_RATE_LIMIT',
  'BRUNO_SERVER_AUTH_RATE_WINDOW_MS',
  'BRUNO_SERVER_IPC_RATE_LIMIT',
  'BRUNO_SERVER_IPC_RATE_WINDOW_MS',
  'BRUNO_SERVER_IPC_MAX_CONCURRENT',
  'BRUNO_SERVER_IPC_TIMEOUT_MS',
  'BRUNO_SERVER_MAX_TERMINALS_PER_SESSION',
  'BRUNO_SERVER_MAX_WATCHED_PATHS_PER_SESSION',
  'BRUNO_SERVER_MAX_CONCURRENT_SESSIONS'
];

// Matches what express's body-parser (via the `bytes` package) accepts as a
// JSON body limit: a plain byte count, or a number followed by a unit.
const BYTE_SIZE_RE = /^\d+(\.\d+)?\s*(b|kb|mb|gb|tb)?$/i;

// Reverse proxy base path (Improvement.md P1.3): one or more `/segment`
// path components, no trailing slash, no empty segments — matches what
// gets safely concatenated in front of every route/static-asset/WS path in
// index.js without producing a double slash or an unanchored path.
const BASE_PATH_RE = /^\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;

const isPositiveInteger = (value) => Number.isFinite(value) && Number.isInteger(value) && value > 0;

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]} human-readable error messages; empty when config is valid
 */
const validateStartupConfig = (env = process.env) => {
  const errors = [];

  if (env.BRUNO_SERVER_PORT !== undefined) {
    const port = Number(env.BRUNO_SERVER_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`BRUNO_SERVER_PORT="${env.BRUNO_SERVER_PORT}" must be an integer between 1 and 65535`);
    }
  }

  for (const name of POSITIVE_INTEGER_ENV_VARS) {
    const raw = env[name];
    if (raw === undefined) continue;
    if (!isPositiveInteger(Number(raw))) {
      errors.push(`${name}="${raw}" must be a positive integer`);
    }
  }

  if (env.BRUNO_SERVER_JSON_LIMIT !== undefined && !BYTE_SIZE_RE.test(env.BRUNO_SERVER_JSON_LIMIT.trim())) {
    errors.push(
      `BRUNO_SERVER_JSON_LIMIT="${env.BRUNO_SERVER_JSON_LIMIT}" must be a byte size like "25mb" or a plain number of bytes`
    );
  }

  if (
    env.BRUNO_SERVER_BASE_PATH !== undefined &&
    env.BRUNO_SERVER_BASE_PATH !== '' &&
    !BASE_PATH_RE.test(env.BRUNO_SERVER_BASE_PATH)
  ) {
    errors.push(
      `BRUNO_SERVER_BASE_PATH="${env.BRUNO_SERVER_BASE_PATH}" must be empty or a path like "/bridge" (no trailing slash, alphanumeric/hyphen/underscore segments only)`
    );
  }

  return errors;
};

module.exports = { validateStartupConfig };
