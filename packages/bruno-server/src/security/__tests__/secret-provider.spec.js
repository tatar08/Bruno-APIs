const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSecretProvider, SUPPORTED_PROVIDER_NAMES } = require('../secret-provider');
const { KEY_LENGTH_BYTES } = require('../master-key');

describe('createSecretProvider', () => {
  let tmpDir;
  let masterKeyPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-secret-provider-test-'));
    masterKeyPath = path.join(tmpDir, 'nested', 'bridge-master.key');
    delete process.env.BRUNO_SERVER_SECRET_PROVIDER;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.BRUNO_SERVER_SECRET_PROVIDER;
  });

  it('lists local, vault, and aws-secrets-manager as supported provider names', () => {
    expect(SUPPORTED_PROVIDER_NAMES).toEqual(expect.arrayContaining(['local', 'vault', 'aws-secrets-manager']));
  });

  it('defaults to the local provider when BRUNO_SERVER_SECRET_PROVIDER is unset', () => {
    const provider = createSecretProvider({ masterKeyPath });
    expect(provider.name).toBe('local');
  });

  it('local provider getMasterKey() returns a real 32-byte key backed by master-key.js', () => {
    const provider = createSecretProvider({ masterKeyPath });
    const key = provider.getMasterKey();

    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(KEY_LENGTH_BYTES);
    expect(fs.existsSync(masterKeyPath)).toBe(true);
  });

  it('honors BRUNO_SERVER_SECRET_PROVIDER=local explicitly set via env', () => {
    process.env.BRUNO_SERVER_SECRET_PROVIDER = 'local';
    const provider = createSecretProvider({ masterKeyPath });
    expect(provider.name).toBe('local');
  });

  it('the `provider` option overrides the env var', () => {
    process.env.BRUNO_SERVER_SECRET_PROVIDER = 'vault';
    expect(() => createSecretProvider({ provider: 'local', masterKeyPath })).not.toThrow();
  });

  it('throws a clear, actionable error for BRUNO_SERVER_SECRET_PROVIDER=vault (not implemented yet)', () => {
    expect(() => createSecretProvider({ provider: 'vault' })).toThrow(/not implemented yet/);
  });

  it('throws a clear, actionable error for BRUNO_SERVER_SECRET_PROVIDER=aws-secrets-manager (not implemented yet)', () => {
    expect(() => createSecretProvider({ provider: 'aws-secrets-manager' })).toThrow(/not implemented yet/);
  });

  it('rejects an unknown provider name with a message listing the supported ones', () => {
    expect(() => createSecretProvider({ provider: 'gcp-secret-manager' })).toThrow(
      /Unknown BRUNO_SERVER_SECRET_PROVIDER "gcp-secret-manager".*local.*vault.*aws-secrets-manager/s
    );
  });
});
