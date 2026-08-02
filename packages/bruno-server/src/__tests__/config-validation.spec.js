const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateStartupConfig } = require('../config-validation');

describe('validateStartupConfig', () => {
  it('returns no errors for an empty env', () => {
    expect(validateStartupConfig({})).toEqual([]);
  });

  it('returns no errors when all recognized vars are valid', () => {
    const errors = validateStartupConfig({
      BRUNO_SERVER_PORT: '4000',
      BRUNO_SERVER_AUTH_RATE_LIMIT: '10',
      BRUNO_SERVER_AUTH_RATE_WINDOW_MS: '60000',
      BRUNO_SERVER_IPC_RATE_LIMIT: '100',
      BRUNO_SERVER_IPC_RATE_WINDOW_MS: '10000',
      BRUNO_SERVER_IPC_MAX_CONCURRENT: '20',
      BRUNO_SERVER_IPC_TIMEOUT_MS: '30000',
      BRUNO_SERVER_MAX_TERMINALS_PER_SESSION: '5',
      BRUNO_SERVER_MAX_WATCHED_PATHS_PER_SESSION: '50',
      BRUNO_SERVER_MAX_CONCURRENT_SESSIONS: '25',
      BRUNO_SERVER_JSON_LIMIT: '25mb'
    });
    expect(errors).toEqual([]);
  });

  it('ignores unrelated env vars entirely', () => {
    expect(validateStartupConfig({ PATH: '/usr/bin', HOME: '/home/x' })).toEqual([]);
  });

  describe('BRUNO_SERVER_PORT', () => {
    it.each(['0', '-1', '65536', 'abc', '3000.5', ''])('rejects "%s"', (value) => {
      const errors = validateStartupConfig({ BRUNO_SERVER_PORT: value });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_PORT')]);
    });

    it.each(['1', '65535', '4000'])('accepts "%s"', (value) => {
      expect(validateStartupConfig({ BRUNO_SERVER_PORT: value })).toEqual([]);
    });
  });

  describe.each([
    'BRUNO_SERVER_AUTH_RATE_LIMIT',
    'BRUNO_SERVER_AUTH_RATE_WINDOW_MS',
    'BRUNO_SERVER_IPC_RATE_LIMIT',
    'BRUNO_SERVER_IPC_RATE_WINDOW_MS',
    'BRUNO_SERVER_IPC_MAX_CONCURRENT',
    'BRUNO_SERVER_IPC_TIMEOUT_MS',
    'BRUNO_SERVER_MAX_TERMINALS_PER_SESSION',
    'BRUNO_SERVER_MAX_WATCHED_PATHS_PER_SESSION',
    'BRUNO_SERVER_MAX_CONCURRENT_SESSIONS'
  ])('%s', (name) => {
    it.each(['0', '-5', 'abc', '1.5', ''])('rejects "%s"', (value) => {
      const errors = validateStartupConfig({ [name]: value });
      expect(errors).toEqual([expect.stringContaining(name)]);
    });

    it('accepts a positive integer', () => {
      expect(validateStartupConfig({ [name]: '10' })).toEqual([]);
    });

    it('is not validated when unset', () => {
      expect(validateStartupConfig({})).toEqual([]);
    });
  });

  describe('BRUNO_SERVER_JSON_LIMIT', () => {
    it.each(['25mb', '25MB', '512kb', '1gb', '1000', '  10mb  '])('accepts "%s"', (value) => {
      expect(validateStartupConfig({ BRUNO_SERVER_JSON_LIMIT: value })).toEqual([]);
    });

    it.each(['abc', '25 megabytes', '-1mb', ''])('rejects "%s"', (value) => {
      const errors = validateStartupConfig({ BRUNO_SERVER_JSON_LIMIT: value });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_JSON_LIMIT')]);
    });
  });

  describe('BRUNO_SERVER_BASE_PATH', () => {
    it.each(['/bridge', '/bridge/v2', '/a-b_c', '/a/b/c'])('accepts "%s"', (value) => {
      expect(validateStartupConfig({ BRUNO_SERVER_BASE_PATH: value })).toEqual([]);
    });

    it('accepts an empty string (root mount, same as unset)', () => {
      expect(validateStartupConfig({ BRUNO_SERVER_BASE_PATH: '' })).toEqual([]);
    });

    it('is not validated when unset', () => {
      expect(validateStartupConfig({})).toEqual([]);
    });

    it.each(['bridge', '/bridge/', '/bridge//v2', '/bri dge', '/bridge?', '//'])('rejects "%s"', (value) => {
      const errors = validateStartupConfig({ BRUNO_SERVER_BASE_PATH: value });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_BASE_PATH')]);
    });
  });

  describe('BRUNO_SERVER_SECRET_PROVIDER', () => {
    it.each(['local', 'vault', 'aws-secrets-manager'])('accepts "%s"', (value) => {
      expect(validateStartupConfig({ BRUNO_SERVER_SECRET_PROVIDER: value })).toEqual([]);
    });

    it('is not validated when unset', () => {
      expect(validateStartupConfig({})).toEqual([]);
    });

    it.each(['gcp-secret-manager', 'LOCAL', 'vaultt', ''])('rejects "%s"', (value) => {
      const errors = validateStartupConfig({ BRUNO_SERVER_SECRET_PROVIDER: value });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_SECRET_PROVIDER')]);
    });
  });

  describe('TLS (BRUNO_SERVER_TLS_CERT_FILE / _KEY_FILE / _CA_FILE)', () => {
    let tmpDir, certFile, keyFile, caFile, missingFile;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-tls-test-'));
      certFile = path.join(tmpDir, 'cert.pem');
      keyFile = path.join(tmpDir, 'key.pem');
      caFile = path.join(tmpDir, 'ca.pem');
      missingFile = path.join(tmpDir, 'does-not-exist.pem');
      fs.writeFileSync(certFile, 'fake cert contents');
      fs.writeFileSync(keyFile, 'fake key contents');
      fs.writeFileSync(caFile, 'fake ca contents');
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('accepts a valid cert+key pair', () => {
      expect(
        validateStartupConfig({ BRUNO_SERVER_TLS_CERT_FILE: certFile, BRUNO_SERVER_TLS_KEY_FILE: keyFile })
      ).toEqual([]);
    });

    it('accepts a valid cert+key+ca trio', () => {
      expect(
        validateStartupConfig({
          BRUNO_SERVER_TLS_CERT_FILE: certFile,
          BRUNO_SERVER_TLS_KEY_FILE: keyFile,
          BRUNO_SERVER_TLS_CA_FILE: caFile
        })
      ).toEqual([]);
    });

    it('is not validated when both unset (plain HTTP)', () => {
      expect(validateStartupConfig({})).toEqual([]);
    });

    it('rejects cert set without key', () => {
      const errors = validateStartupConfig({ BRUNO_SERVER_TLS_CERT_FILE: certFile });
      expect(errors).toEqual([expect.stringContaining('must both be set')]);
    });

    it('rejects key set without cert', () => {
      const errors = validateStartupConfig({ BRUNO_SERVER_TLS_KEY_FILE: keyFile });
      expect(errors).toEqual([expect.stringContaining('must both be set')]);
    });

    it('rejects a cert path that does not exist', () => {
      const errors = validateStartupConfig({
        BRUNO_SERVER_TLS_CERT_FILE: missingFile,
        BRUNO_SERVER_TLS_KEY_FILE: keyFile
      });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_TLS_CERT_FILE')]);
    });

    it('rejects a key path that does not exist', () => {
      const errors = validateStartupConfig({
        BRUNO_SERVER_TLS_CERT_FILE: certFile,
        BRUNO_SERVER_TLS_KEY_FILE: missingFile
      });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_TLS_KEY_FILE')]);
    });

    it('rejects a ca path that does not exist', () => {
      const errors = validateStartupConfig({
        BRUNO_SERVER_TLS_CERT_FILE: certFile,
        BRUNO_SERVER_TLS_KEY_FILE: keyFile,
        BRUNO_SERVER_TLS_CA_FILE: missingFile
      });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_TLS_CA_FILE')]);
    });

    it('rejects a cert path that points at a directory', () => {
      const errors = validateStartupConfig({
        BRUNO_SERVER_TLS_CERT_FILE: tmpDir,
        BRUNO_SERVER_TLS_KEY_FILE: keyFile
      });
      expect(errors).toEqual([expect.stringContaining('BRUNO_SERVER_TLS_CERT_FILE')]);
    });
  });

  it('collects multiple errors across different vars at once', () => {
    const errors = validateStartupConfig({
      BRUNO_SERVER_PORT: '999999',
      BRUNO_SERVER_AUTH_RATE_LIMIT: 'nope',
      BRUNO_SERVER_JSON_LIMIT: 'nope'
    });
    expect(errors).toHaveLength(3);
  });
});
