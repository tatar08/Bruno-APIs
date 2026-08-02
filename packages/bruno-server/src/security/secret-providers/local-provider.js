/**
 * Default secret provider (Improvement.md P1.4B) — wraps the existing
 * file/env-based master key logic in ../master-key.js unchanged. This is
 * what every deployment gets when BRUNO_SERVER_SECRET_PROVIDER is unset, so
 * adding the provider interface changes zero default behavior.
 */

const { getOrCreateMasterKey } = require('../master-key');

/**
 * @param {{ masterKeyPath: string }} config
 * @returns {import('../secret-provider').SecretProvider}
 */
const createProvider = ({ masterKeyPath }) => ({
  name: 'local',
  getMasterKey: () => getOrCreateMasterKey(masterKeyPath)
});

module.exports = { createProvider };
