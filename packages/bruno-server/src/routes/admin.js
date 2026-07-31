/**
 * Admin routes — runtime management of Browser Bridge security config that
 * otherwise only takes effect via an env var at startup (Improvement.md
 * P0.3: "ให้ผู้ใช้ revoke root ได้"). Mounted behind `requireAuth` in
 * index.js, same as /api/ipc, so this is only reachable without a session
 * when BRUNO_SERVER_REQUIRE_AUTH is off — consistent with every other
 * control in this codebase being permissive by default until auth is
 * opted into.
 */

const express = require('express');
const { isFilesystemSandboxEnabled, listAllowedRoots, revokeRoot } = require('../security/allowed-roots');
const { logRootRevoked } = require('../security/audit-log');

const createAdminRouter = () => {
  const router = express.Router();

  router.get('/allowed-roots', (req, res) => {
    res.json({ enabled: isFilesystemSandboxEnabled(), roots: listAllowedRoots() });
  });

  // Revokes one configured root by its exact resolved path (as returned by
  // GET above). Revocation is in-memory and permanent for the life of this
  // process — there's no un-revoke endpoint; restarting the server is the
  // way back, since that re-reads BRUNO_SERVER_ALLOWED_ROOTS from scratch.
  router.delete('/allowed-roots', (req, res) => {
    const { path: rootPath } = req.body || {};
    if (!rootPath || typeof rootPath !== 'string') {
      return res.status(400).json({ error: '"path" (string) is required in the request body' });
    }

    const revoked = revokeRoot(rootPath);
    if (!revoked) {
      return res.status(404).json({
        error: `"${rootPath}" is not a currently-configured allowed root. It must match a "path" value from GET /api/admin/allowed-roots exactly.`
      });
    }

    logRootRevoked({ path: rootPath, sessionId: req.brunoSessionId });
    res.json({ ok: true });
  });

  return router;
};

module.exports = { createAdminRouter };
