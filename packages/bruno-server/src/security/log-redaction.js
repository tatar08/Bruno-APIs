/**
 * Error-message redaction for server-side logs (Improvement.md P0.1).
 *
 * P0.1's own audit found every `console.*` call site in bruno-server safe
 * except one class: handlers throw arbitrary `Error` objects, and
 * `err.message` gets logged as-is (e.g. ipc-proxy.js's catch block, which is
 * the single chokepoint every one of the ~203 IPC handlers' thrown errors
 * passes through). If a handler's error message happens to embed something
 * secret-shaped — a Git remote URL with a token in the userinfo, a stray
 * "Authorization: Bearer ..." from a failed upstream fetch, an AI provider
 * error that echoes back an API key — that reaches the log verbatim.
 *
 * Auditing all ~203 handlers individually (the same way P0.2 built
 * CHANNEL_SCHEMAS capability-by-capability) isn't proportionate here: unlike
 * argument shapes, there's no finite set of "risky" handlers to prioritize —
 * any handler that wraps a network/git/AI call can produce an error message
 * with attacker- or upstream-controlled content. So this is a generic
 * pattern-based redaction net applied at the log call sites instead: same
 * "coarse safety net, not precise per-call validation" posture already used
 * for the P0.3 filesystem sandbox scanner. It only touches what gets
 * written to the log — the client still receives the original err.message
 * in the response body, since that's the same session that made the
 * request and needs the real error text to show the user.
 */

const REDACTED = '[REDACTED]';

const PATTERNS = [
  // scheme://user:pass@host — credentials embedded in a URL's userinfo
  { re: /(:\/\/)[^/\s:@]+:[^/\s:@]+@/g, replace: `$1${REDACTED}@` },
  // Authorization: Bearer/Basic <token>
  { re: /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, replace: `$1 ${REDACTED}` },
  // key[:=]value assignments for common secret-shaped key names, with or
  // without quotes around the key/value (covers JSON-ish and query-string-ish
  // shapes alike). "authorization" is deliberately not in this list — every
  // real Authorization header carries a scheme token (RFC 7235), so it's
  // already covered by the Bearer/Basic pattern above; including it here too
  // would double-redact "Authorization: Bearer xyz" into two artifacts.
  {
    re: /(["']?\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret|password|passwd|token)\b["']?\s*[:=]\s*)(["']?)[^\s"',;&]+\2/gi,
    replace: `$1$2${REDACTED}$2`
  }
];

function redactSecrets(message) {
  if (typeof message !== 'string' || !message) return message;
  return PATTERNS.reduce((text, { re, replace }) => text.replace(re, replace), message);
}

module.exports = { redactSecrets };
