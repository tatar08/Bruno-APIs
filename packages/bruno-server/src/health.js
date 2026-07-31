/**
 * Build info + readiness helpers for /health/live and /health/ready
 * (Improvement.md P1.3).
 */

let version = 'unknown';
try {
  version = require('../package.json').version;
} catch (err) {
  // package.json should always be resolvable in a real install; if it isn't,
  // reporting "unknown" is preferable to crashing the health endpoint.
}

const startedAt = Date.now();

const getBuildInfo = () => ({
  version,
  nodeVersion: process.version,
  startedAt: new Date(startedAt).toISOString(),
  uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
});

module.exports = { getBuildInfo };
