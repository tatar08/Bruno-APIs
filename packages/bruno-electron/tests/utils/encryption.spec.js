const crypto = require('crypto');
const { encryptString, decryptString, encryptStringSafe, decryptStringSafe } = require('../../src/utils/encryption');

// We can only unit test aes 256 fallback as safeStorage is only available
// in the main process

describe('Encryption and Decryption Tests', () => {
  it('should encrypt and decrypt using AES-256', () => {
    const plaintext = 'bruno is awesome';
    const encrypted = encryptString(plaintext);
    const decrypted = decryptString(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('should write new encryptions using AES-256-GCM (algo 02), not the legacy zero-IV format', () => {
    const encrypted = encryptString('bruno is awesome');
    expect(encrypted.startsWith('$02:')).toBe(true);
  });

  it('should use a random IV, so encrypting the same plaintext twice yields different ciphertext (Improvement.md P1.4 — no more zero-IV equality leakage)', () => {
    const a = encryptString('same-value');
    const b = encryptString('same-value');

    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe('same-value');
    expect(decryptString(b)).toBe('same-value');
  });

  it('should round-trip through encryptString/decryptString when a passkey is supplied (cookies store use case)', () => {
    const passkey = 'a-cookie-store-passkey';
    const encrypted = encryptString('cookie-value', passkey);

    expect(encrypted.startsWith('$02:')).toBe(true);
    expect(decryptString(encrypted, passkey)).toBe('cookie-value');
  });

  it('should fail to decrypt AES-256-GCM ciphertext with the wrong passkey (authenticated encryption catches it)', () => {
    const encrypted = encryptString('cookie-value', 'correct-passkey');
    expect(() => decryptString(encrypted, 'wrong-passkey')).toThrow();
  });

  it('should still decrypt legacy zero-IV AES-256-CBC ciphertext for backward compatibility (algo 01, decrypt-only)', () => {
    const passkey = 'test-passkey-for-legacy-format';
    const plaintext = 'legacy secret value';

    // Replicates the old, no-longer-written fixed zero-IV CBC scheme that
    // decryptString must still be able to read so pre-existing ciphertext
    // isn't orphaned by the switch to AES-256-GCM.
    const key = crypto.createHash('sha256').update(passkey).digest();
    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encryptedHex = cipher.update(plaintext, 'utf8', 'hex');
    encryptedHex += cipher.final('hex');
    const legacyCiphertext = `$01:${encryptedHex}`;

    expect(decryptString(legacyCiphertext, passkey)).toBe(plaintext);
  });

  it('should handle malformed AES-256-GCM ciphertext gracefully in decryptStringSafe', () => {
    const malformed = '$02:00112233445566778899aabbccddeeff';
    const result = decryptStringSafe(malformed);

    expect(result.success).toBe(false);
    expect(result.value).toBe('');
  });

  it('should handle empty strings in encryptString', () => {
    const result = encryptString('');
    expect(result).toBe('');
  });

  it('should handle empty strings in decryptString', () => {
    const result = decryptString('');
    expect(result).toBe('');
  });

  it('encrypt should throw an error for invalid string', () => {
    expect(() => encryptString(null)).toThrow('Encrypt failed: invalid string');
    expect(() => encryptString(undefined)).toThrow('Encrypt failed: invalid string');
  });

  it('decrypt should throw an error for invalid string', () => {
    expect(() => decryptString(null)).toThrow('Decrypt failed: unrecognized string format');
    expect(() => decryptString('garbage')).toThrow('Decrypt failed: unrecognized string format');
  });

  it.skip('string encrypted using createCipher (< node 20) should be decrypted properly', () => {
    const encryptedString = '$01:2738e0e6a38bcde5fd80141ceadc9b67bc7b1fca7e398c552c1ca2bace28eb57';
    const decryptedValue = decryptString(encryptedString);

    expect(decryptedValue).toBe('bruno is awesome');
  });

  it('decrypt should throw an error for invalid algorithm', () => {
    const invalidAlgo = '$99:abcdefg';

    expect(() => decryptString(invalidAlgo)).toThrow('Decrypt failed: Invalid algo');
  });
});

describe('Safe Encryption and Decryption Tests', () => {
  it('should encrypt and decrypt successfully using encryptStringSafe and decryptStringSafe', () => {
    const plaintext = 'bruno is awesome';
    const encryptionResult = encryptStringSafe(plaintext);
    const decryptionResult = decryptStringSafe(encryptionResult.value);

    expect(encryptionResult.success).toBe(true);
    expect(decryptionResult.success).toBe(true);
    expect(decryptionResult.value).toBe(plaintext);
  });

  it('should handle empty strings in encryptStringSafe', () => {
    const result = encryptStringSafe('');
    expect(result.success).toBe(true);
    expect(result.value).toBe('');
  });

  it('should handle empty strings in decryptStringSafe', () => {
    const result = decryptStringSafe('');
    expect(result.success).toBe(true);
    expect(result.value).toBe('');
  });

  it('should handle invalid string format in decryptStringSafe', () => {
    const result = decryptStringSafe('garbage');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Decrypt failed: unrecognized string format');
    expect(result.value).toBe('');
  });

  it('should handle invalid algorithm in decryptStringSafe', () => {
    const invalidAlgo = '$99:abcdefg';
    const result = decryptStringSafe(invalidAlgo);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Decrypt failed: Invalid algo');
    expect(result.value).toBe('');
  });

  it('should handle malformed encrypted string in decryptStringSafe', () => {
    const malformedString = '$01:invalid-hex-string';
    const result = decryptStringSafe(malformedString);
    expect(result.success).toBe(false);
    expect(result.error).toContain('AES256 decryption failed');
    expect(result.value).toBe('');
  });

  it('should handle special characters in encryptStringSafe and decryptStringSafe', () => {
    const specialText = 'bruno@#$%^&*()_+-=[]{}|;:,.<>?';
    const encryptionResult = encryptStringSafe(specialText);
    const decryptionResult = decryptStringSafe(encryptionResult.value);

    expect(encryptionResult.success).toBe(true);
    expect(decryptionResult.success).toBe(true);
    expect(decryptionResult.value).toBe(specialText);
  });

  it('decrypt-safe should not throw error for invalid inputs', () => {
    expect(() => decryptStringSafe(null)).not.toThrow();
    expect(() => decryptStringSafe(undefined)).not.toThrow();
    expect(() => decryptStringSafe('garbage')).not.toThrow();
    expect(() => decryptStringSafe(123456789)).not.toThrow();
    expect(() => decryptStringSafe('aes256:')).not.toThrow();
    expect(() => decryptStringSafe('aes256:invalid_base64')).not.toThrow();
  });
});
