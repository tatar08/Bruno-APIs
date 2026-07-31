/**
 * Per-deployment master key for the Browser Bridge (Improvement.md P1.4).
 *
 * bruno-electron's encryption.js falls through to a key derived from
 * machineIdSync() whenever Electron's safeStorage isn't available. Under
 * the Bridge that fallback was always taken (the safeStorage shim reported
 * isEncryptionAvailable() === false), which means every session on a
 * shared server process encrypted secrets with one machine-wide key that
 * was never actually generated for that purpose. This module gives the
 * Bridge a real, persistent, file-permission-protected key instead, and
 * wires it into a safeStorage-shaped shim so encryption.js picks it up
 * through its existing safeStorage code path with zero changes to any
 * store/*.js call site.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

function getOrCreateMasterKey(filePath) {
  // Escape hatch for deployments that inject the key via a secrets manager
  // rather than trusting the local filesystem.
  const fromEnv = process.env.BRUNO_SERVER_MASTER_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'hex');
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(`BRUNO_SERVER_MASTER_KEY must be a ${KEY_LENGTH_BYTES * 2}-character hex string (${KEY_LENGTH_BYTES} bytes)`);
    }
    return key;
  }

  try {
    const existing = fs.readFileSync(filePath);
    if (existing.length === KEY_LENGTH_BYTES) {
      return existing;
    }
    console.warn(`[MasterKey] ${filePath} did not contain a valid ${KEY_LENGTH_BYTES}-byte key — regenerating`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  const key = crypto.randomBytes(KEY_LENGTH_BYTES);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, key, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600); // umask can widen the mode passed to writeFileSync
  return key;
}

function createSafeStorageShim(masterKey) {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = crypto.randomBytes(IV_LENGTH_BYTES);
      const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
      const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, ciphertext]);
    },
    decryptString: (buffer) => {
      const iv = buffer.subarray(0, IV_LENGTH_BYTES);
      const authTag = buffer.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
      const ciphertext = buffer.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
      const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }
  };
}

module.exports = { getOrCreateMasterKey, createSafeStorageShim, KEY_LENGTH_BYTES };
