/**
 * Origin Policy — decides which browser origins may talk to the Bridge.
 *
 * Default (no BRUNO_SERVER_ALLOWED_ORIGINS set): only loopback origins are
 * allowed, matching the server's own default loopback bind. This blocks an
 * arbitrary web page from using a visitor's browser to reach a locally
 * running Bridge (cross-site request/WebSocket hijacking), without requiring
 * any config for the common local-dev/local-use case.
 *
 * Set BRUNO_SERVER_ALLOWED_ORIGINS to a comma-separated exact-match list to
 * allow non-loopback origins (e.g. when the Bridge is exposed on a LAN).
 */

const LOOPBACK_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

const parseAllowedOrigins = () => {
  const configured = process.env.BRUNO_SERVER_ALLOWED_ORIGINS;
  if (!configured) return null;
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const allowedOrigins = parseAllowedOrigins();

/**
 * @param {string | undefined} origin - the request's Origin header value
 */
const isOriginAllowed = (origin) => {
  // Requests without an Origin header (curl, server-to-server, same-process
  // health checks) aren't subject to browser same-origin protections, so
  // they fall outside what this policy is meant to guard against.
  if (!origin) return true;
  if (allowedOrigins) return allowedOrigins.includes(origin);
  return LOOPBACK_ORIGIN_RE.test(origin);
};

module.exports = { isOriginAllowed };
