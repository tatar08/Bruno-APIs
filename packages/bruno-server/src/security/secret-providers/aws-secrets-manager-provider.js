/**
 * AWS Secrets Manager-backed secret provider (Improvement.md P1.4B) —
 * registered name, NOT YET IMPLEMENTED.
 *
 * Same rationale as ./vault-provider.js: fetching the master key from AWS
 * Secrets Manager (via the AWS SDK, IAM credentials, region config, and its
 * own retry/rotation semantics) is async and network-dependent, which
 * bruno-server's currently-synchronous startup sequence doesn't support yet.
 * That's a separate, larger increment from defining this interface.
 *
 * BRUNO_SERVER_SECRET_PROVIDER=aws-secrets-manager fails fast with this
 * message instead of falling back to the local provider or an unmanaged key.
 */

const createProvider = () => {
  throw new Error(
    'BRUNO_SERVER_SECRET_PROVIDER=aws-secrets-manager is not implemented yet (Improvement.md P1.4B tracks ' +
      'the follow-up). Use BRUNO_SERVER_SECRET_PROVIDER=local (the default), or set BRUNO_SERVER_MASTER_KEY ' +
      'to inject a key from your own secrets pipeline in the meantime.'
  );
};

module.exports = { createProvider };
