/**
 * External secret provider interface (Improvement.md P1.4B).
 *
 * Everything the Bridge encrypts-at-rest (AI keys, OAuth2 tokens, secret
 * env vars, cookies, ...) goes through one 32-byte master key, produced by
 * security/master-key.js's createSafeStorageShim(). A "secret provider" is
 * only responsible for producing that one key — an envelope-encryption-style
 * boundary that keeps every encryption.js call site (and the safeStorage
 * shim itself) completely unaware of where the key came from. Swapping the
 * provider never touches bulk encrypt/decrypt logic, only key sourcing.
 *
 * Providers implement:
 *   { name: string, getMasterKey(): Buffer }  // exactly 32 bytes
 *
 * Only `local` is implemented today (wraps the pre-existing file/env-based
 * logic in master-key.js — zero behavior change from before this module
 * existed). `vault` and `aws-secrets-manager` are registered names with a
 * documented contract that intentionally throw a clear error if selected;
 * see secret-providers/vault-provider.js for why a real implementation is a
 * separate, larger increment (async key fetch, new SDK dependency, its own
 * retry/rotation policy) rather than something to bolt on silently here.
 */

const PROVIDERS = {
  local: require('./secret-providers/local-provider'),
  vault: require('./secret-providers/vault-provider'),
  'aws-secrets-manager': require('./secret-providers/aws-secrets-manager-provider')
};

const SUPPORTED_PROVIDER_NAMES = Object.keys(PROVIDERS);

/**
 * @param {{ provider?: string, masterKeyPath?: string }} [options]
 *   `provider` overrides BRUNO_SERVER_SECRET_PROVIDER (mainly for tests).
 * @returns {{ name: string, getMasterKey: () => Buffer }}
 */
const createSecretProvider = (options = {}) => {
  const name = options.provider || process.env.BRUNO_SERVER_SECRET_PROVIDER || 'local';
  const factory = PROVIDERS[name];
  if (!factory) {
    throw new Error(
      `Unknown BRUNO_SERVER_SECRET_PROVIDER "${name}" — supported values: ${SUPPORTED_PROVIDER_NAMES.join(', ')}`
    );
  }
  return factory.createProvider(options);
};

module.exports = { createSecretProvider, SUPPORTED_PROVIDER_NAMES };
