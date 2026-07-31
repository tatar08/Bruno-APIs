const crypto = require('crypto');
const { machineIdSync } = require('@usebruno/node-machine-id');
const { safeStorage } = require('electron');

// Constants for algorithm identification
const ELECTRONSAFESTORAGE_ALGO = '00';
const AES256_ALGO = '01'; // legacy fixed zero-IV CBC — decrypt-only, kept for reading pre-existing ciphertext
const AES256GCM_ALGO = '02'; // random IV + auth tag; everything new is written in this format

function deriveKeyAndIv(password, keyLength, ivLength) {
  const key = Buffer.alloc(keyLength);
  const iv = Buffer.alloc(ivLength);
  const derivedBytes = [];
  let lastHash = null;

  while (Buffer.concat(derivedBytes).length < keyLength + ivLength) {
    const hash = crypto.createHash('md5');
    if (lastHash) {
      hash.update(lastHash);
    }
    hash.update(Buffer.from(password, 'utf8'));
    lastHash = hash.digest();
    derivedBytes.push(lastHash);
  }

  const concatenatedBytes = Buffer.concat(derivedBytes);
  concatenatedBytes.copy(key, 0, 0, keyLength);
  concatenatedBytes.copy(iv, 0, keyLength, keyLength + ivLength);

  return { key, iv };
}

function aes256GcmEncrypt(data, passkey = null) {
  const rawKey = passkey || machineIdSync();
  const key = crypto.createHash('sha256').update(rawKey).digest(); // Derive a 32-byte key
  const iv = crypto.randomBytes(12); // Random per-encryption IV — never reused across calls
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // iv and authTag are fixed-length (12 / 16 bytes), so a plain
  // concatenation is unambiguous to split back apart on decrypt.
  return iv.toString('hex') + authTag.toString('hex') + encrypted;
}

function aes256GcmDecrypt(data, passkey = null) {
  const rawKey = passkey || machineIdSync();
  const key = crypto.createHash('sha256').update(rawKey).digest();

  const iv = Buffer.from(data.slice(0, 24), 'hex');
  const authTag = Buffer.from(data.slice(24, 56), 'hex');
  const ciphertext = data.slice(56);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Legacy fixed zero-IV AES-256-CBC. Kept decrypt-only so ciphertext written
// by older Bruno versions keeps working; nothing encrypts into this format
// anymore (aes256GcmEncrypt above replaced it — zero IV meant identical
// plaintexts always produced identical ciphertext, leaking equality
// patterns to anyone with read access to the store file).
function aes256Decrypt(data, passkey = null) {
  const rawKey = passkey || machineIdSync();

  // Attempt to decrypt using new method first
  const iv = Buffer.alloc(16, 0); // Default IV for new encryption
  const key = crypto.createHash('sha256').update(rawKey).digest(); // Derive a 32-byte key

  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // If decryption fails, fall back to old key derivation
    try {
      const { key: oldKey, iv: oldIv } = deriveKeyAndIv(rawKey, 32, 16);
      const decipher = crypto.createDecipheriv('aes-256-cbc', oldKey, oldIv);
      const decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (fallbackErr) {
      console.error('AES256 decryption failed with both methods:', err, fallbackErr);
      throw new Error('AES256 decryption failed: ' + fallbackErr.message);
    }
  }
}

// electron safe storage encryption and decryption functions
function safeStorageEncrypt(str) {
  let encryptedStringBuffer = safeStorage.encryptString(str);

  // Convert the encrypted buffer to a hexadecimal string
  const encryptedString = encryptedStringBuffer.toString('hex');

  return encryptedString;
}
function safeStorageDecrypt(str) {
  try {
    // Convert the hexadecimal string to a buffer
    const encryptedStringBuffer = Buffer.from(str, 'hex');

    // Decrypt the buffer
    const decryptedStringBuffer = safeStorage.decryptString(encryptedStringBuffer);

    // Convert the decrypted buffer to a string
    const decryptedString = decryptedStringBuffer.toString();

    return decryptedString;
  } catch (err) {
    console.error('SafeStorage decryption failed:', err);
    throw new Error('SafeStorage decryption failed: ' + err.message);
  }
}

function encryptString(str, passkey = null) {
  if (typeof str !== 'string') {
    throw new Error('Encrypt failed: invalid string');
  }
  if (str.length === 0) {
    return '';
  }

  // If a passkey is provided (from cookies store), we must use it for encryption.
  if (passkey !== null && passkey !== undefined) {
    if (typeof passkey !== 'string' || passkey.length === 0) {
      // Corrupted / empty passkey -> do not encrypt, return empty value
      return '';
    }
    try {
      const encryptedString = aes256GcmEncrypt(str, passkey);
      return `$${AES256GCM_ALGO}:${encryptedString}`;
    } catch (err) {
      // Any error indicates the passkey is unusable; return empty string
      return '';
    }
  }

  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    const encryptedString = safeStorageEncrypt(str);
    return `$${ELECTRONSAFESTORAGE_ALGO}:${encryptedString}`;
  }

  const encryptedString = aes256GcmEncrypt(str);
  return `$${AES256GCM_ALGO}:${encryptedString}`;
}

function decryptString(str, passkey = null) {
  if (typeof str !== 'string') {
    throw new Error('Decrypt failed: unrecognized string format');
  }
  if (str.length === 0) {
    return '';
  }

  // Find the index of the first colon
  const colonIndex = str.indexOf(':');

  if (colonIndex === -1) {
    throw new Error('Decrypt failed: unrecognized string format');
  }

  // Extract algo and encryptedString based on the colon index
  const algo = str.substring(1, colonIndex);
  const encryptedString = str.substring(colonIndex + 1);

  if ([ELECTRONSAFESTORAGE_ALGO, AES256_ALGO, AES256GCM_ALGO].indexOf(algo) === -1) {
    throw new Error('Decrypt failed: Invalid algo');
  }

  if (algo === ELECTRONSAFESTORAGE_ALGO) {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorageDecrypt(encryptedString);
    } else {
      return '';
    }
  }

  // Legacy zero-IV format, decrypt-only — see aes256Decrypt's comment above.
  if (algo === AES256_ALGO) {
    return aes256Decrypt(encryptedString, passkey || null);
  }

  if (algo === AES256GCM_ALGO) {
    return aes256GcmDecrypt(encryptedString, passkey || null);
  }
  throw new Error('Decrypt failed: Invalid algo');
}

function decryptStringSafe(str) {
  try {
    const result = decryptString(str);
    return { success: true, value: result };
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return { success: false, error: err.message, value: '' };
  }
}

function encryptStringSafe(str) {
  try {
    const result = encryptString(str);
    return { success: true, value: result };
  } catch (err) {
    console.error('Encryption failed:', err.message);
    return { success: false, error: err.message, value: '' };
  }
}

module.exports = {
  encryptString,
  encryptStringSafe,
  decryptString,
  decryptStringSafe
};
