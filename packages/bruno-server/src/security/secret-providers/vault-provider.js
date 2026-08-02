/**
 * HashiCorp Vault-backed secret provider (Improvement.md P1.4B) — registered
 * name, NOT YET IMPLEMENTED.
 *
 * Fetching the master key from Vault (KV or Transit secrets engine, via
 * VAULT_ADDR/VAULT_TOKEN or AppRole auth) is an inherently async,
 * network-dependent operation, whereas bruno-server/src/index.js's startup
 * sequence is currently synchronous end to end and every getMasterKey()
 * caller (../secret-provider.js, ../master-key.js's createSafeStorageShim
 * consumers) expects a Buffer back, not a Promise. Making that boundary
 * async, plus picking retry/timeout/auth-renewal/rotation semantics and
 * adding the `node-vault` (or equivalent) dependency, is a distinct
 * architecture decision from "define the provider interface" — tracked
 * separately in Improvement.md, not silently implemented here.
 *
 * BRUNO_SERVER_SECRET_PROVIDER=vault fails fast with this message instead
 * of falling back to the local provider or an unmanaged key, consistent
 * with this codebase's fail-safe-not-fail-open posture elsewhere (see
 * security/allowed-roots.js).
 */

const createProvider = () => {
  throw new Error(
    'BRUNO_SERVER_SECRET_PROVIDER=vault is not implemented yet (Improvement.md P1.4B tracks the ' +
      'follow-up). Use BRUNO_SERVER_SECRET_PROVIDER=local (the default), or set BRUNO_SERVER_MASTER_KEY ' +
      'to inject a key from your own secrets pipeline in the meantime.'
  );
};

module.exports = { createProvider };
