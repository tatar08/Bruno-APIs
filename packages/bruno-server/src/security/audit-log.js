/**
 * Filesystem sandbox audit log (Improvement.md P0.3: "บันทึก audit event
 * โดยไม่ log secret/file content"). Only the access decision and the path
 * itself are recorded — never argument/file contents, so a denied write to
 * a request body or environment file never leaks its payload into logs.
 */

function logSandboxDenial({ channel, path, sessionId, requestId }) {
  const parts = [`channel="${channel}"`, `path="${path}"`];
  if (sessionId) parts.push(`session=${sessionId}`);
  if (requestId) parts.push(`requestId=${requestId}`);
  console.warn(`[FilesystemSandbox] Denied — ${parts.join(' ')}`);
}

function logRootRevoked({ path, sessionId }) {
  const parts = [`path="${path}"`];
  if (sessionId) parts.push(`session=${sessionId}`);
  console.warn(`[FilesystemSandbox] Root revoked — ${parts.join(' ')}`);
}

// OAuth2 loopback callback (Improvement.md P1.5). Only `state` and the
// outcome are logged — never the authorization `code`, which is a
// single-use secret that grants the ability to complete the token exchange.
function logOauth2Callback({ state, outcome }) {
  console.warn(`[OAuth2Callback] ${outcome} — state="${state}"`);
}

module.exports = { logSandboxDenial, logRootRevoked, logOauth2Callback };
