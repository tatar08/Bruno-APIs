/**
 * Standard error envelope (Improvement.md P0.5):
 *
 *   { code, message, requestId, retryable, details }
 *
 * bruno-server's ipc-proxy.js adds `code` (and, where known, `retryable`)
 * to its existing error JSON additively — the pre-existing `error` string
 * field is left in place unchanged, since removing it would be a breaking
 * change for every existing consumer of Browser Bridge error responses
 * (bruno-app's error handling, any in-flight integration tests). Treat
 * ERROR_CODES as an open, additive enum: routes that don't have a specific
 * code yet fall back to GENERIC_ERROR rather than being blocked on this
 * package.
 */

const ERROR_CODES = Object.freeze({
  PRIVILEGED_CHANNEL_DISABLED: 'PRIVILEGED_CHANNEL_DISABLED',
  PATH_OUTSIDE_ALLOWED_ROOT: 'PATH_OUTSIDE_ALLOWED_ROOT',
  PATH_READ_ONLY_ROOT: 'PATH_READ_ONLY_ROOT',
  RATE_LIMITED: 'RATE_LIMITED',
  CONCURRENCY_LIMITED: 'CONCURRENCY_LIMITED',
  HANDLER_NOT_FOUND: 'HANDLER_NOT_FOUND',
  HANDLER_TIMEOUT: 'HANDLER_TIMEOUT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INVALID_ARGS: 'INVALID_ARGS',
  HANDLER_ERROR: 'HANDLER_ERROR',
  GENERIC_ERROR: 'GENERIC_ERROR',
  TERMINAL_ACCESS_DENIED: 'TERMINAL_ACCESS_DENIED',
  RESOURCE_LIMIT_EXCEEDED: 'RESOURCE_LIMIT_EXCEEDED',
  CONNECTION_ACCESS_DENIED: 'CONNECTION_ACCESS_DENIED'
});

// Codes for conditions that are safe to retry unchanged (the request itself
// wasn't the problem — timing/capacity was); everything else defaults to
// non-retryable since retrying a malformed or forbidden request just
// repeats the same failure.
const RETRYABLE_CODES = new Set([ERROR_CODES.RATE_LIMITED, ERROR_CODES.CONCURRENCY_LIMITED, ERROR_CODES.HANDLER_TIMEOUT]);

/**
 * Builds the standard error envelope. `code` should be one of ERROR_CODES;
 * unrecognized codes are still accepted (forward-compatible) but won't be
 * auto-classified by RETRYABLE_CODES, so pass `retryable` explicitly in
 * that case.
 */
function createErrorEnvelope(code, message, { requestId, retryable, details } = {}) {
  return {
    code,
    message,
    requestId: requestId ?? null,
    retryable: retryable ?? RETRYABLE_CODES.has(code),
    details: details ?? {}
  };
}

module.exports = { ERROR_CODES, createErrorEnvelope };
