const fs = require('fs');
const os = require('os');
const path = require('path');

const { getOrCreateMasterKey, createSafeStorageShim, KEY_LENGTH_BYTES } = require('../master-key');

describe('master-key', () => {
  let tmpDir;
  let keyPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-master-key-test-'));
    keyPath = path.join(tmpDir, 'nested', 'bridge-master.key');
    delete process.env.BRUNO_SERVER_MASTER_KEY;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.BRUNO_SERVER_MASTER_KEY;
  });

  describe('getOrCreateMasterKey', () => {
    it('creates a new key file with the right length and permissions when none exists', () => {
      const key = getOrCreateMasterKey(keyPath);

      expect(key.length).toBe(KEY_LENGTH_BYTES);
      expect(fs.existsSync(keyPath)).toBe(true);
      expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    });

    it('returns the same key on subsequent calls instead of regenerating', () => {
      const first = getOrCreateMasterKey(keyPath);
      const second = getOrCreateMasterKey(keyPath);

      expect(second.equals(first)).toBe(true);
    });

    it('regenerates the key if the existing file is not a valid key length', () => {
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, 'not a real key');

      const key = getOrCreateMasterKey(keyPath);
      expect(key.length).toBe(KEY_LENGTH_BYTES);
    });

    it('honors BRUNO_SERVER_MASTER_KEY as an override and never writes a file', () => {
      const hexKey = Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('hex');
      process.env.BRUNO_SERVER_MASTER_KEY = hexKey;

      const key = getOrCreateMasterKey(keyPath);

      expect(key.toString('hex')).toBe(hexKey);
      expect(fs.existsSync(keyPath)).toBe(false);
    });

    it('rejects a BRUNO_SERVER_MASTER_KEY of the wrong length', () => {
      process.env.BRUNO_SERVER_MASTER_KEY = 'deadbeef';

      expect(() => getOrCreateMasterKey(keyPath)).toThrow(/32 bytes/);
    });
  });

  describe('createSafeStorageShim', () => {
    it('reports encryption as available', () => {
      const shim = createSafeStorageShim(getOrCreateMasterKey(keyPath));
      expect(shim.isEncryptionAvailable()).toBe(true);
    });

    it('round-trips a string through encryptString/decryptString', () => {
      const shim = createSafeStorageShim(getOrCreateMasterKey(keyPath));

      const ciphertext = shim.encryptString('super-secret-value');
      const plaintext = shim.decryptString(ciphertext);

      expect(plaintext.toString('utf8')).toBe('super-secret-value');
    });

    it('uses a random IV so encrypting the same value twice yields different ciphertext', () => {
      const shim = createSafeStorageShim(getOrCreateMasterKey(keyPath));

      const first = shim.encryptString('same-value');
      const second = shim.encryptString('same-value');

      expect(first.equals(second)).toBe(false);
    });

    it('fails to decrypt with a different master key (authenticated encryption catches tampering/wrong key)', () => {
      const shimA = createSafeStorageShim(getOrCreateMasterKey(keyPath));
      const otherKeyPath = path.join(tmpDir, 'other-key');
      const shimB = createSafeStorageShim(getOrCreateMasterKey(otherKeyPath));

      const ciphertext = shimA.encryptString('secret');
      expect(() => shimB.decryptString(ciphertext)).toThrow();
    });
  });
});
