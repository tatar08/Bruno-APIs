/**
 * Opaque file handles (Improvement.md P1.1) — an additive alternative to
 * passing raw absolute filesystem paths back and forth between the Browse
 * modal and the server. `renderer:list-directory` now returns a `handle`
 * (and `parentHandle`) alongside the existing `path`/`parentPath` fields,
 * and `renderer:create-directory`/`renderer:rename-directory` accept either
 * shape as their parent/source argument.
 *
 * Deliberately additive, not a breaking replacement: every existing caller
 * that still sends/expects a raw path keeps working identically (the
 * frontend hasn't been switched over to consuming `handle` yet — that's a
 * separate follow-up, same backend/UI split already used for P0.2's
 * confirmation policy and P1.5's OAuth popup work). Full removal of the raw
 * `path` field would also just push the same information out through
 * `renderer:resolve-path`/`renderer:is-directory`, which already exist and
 * aren't going away, so plain path exposure was never actually a fixable
 * vulnerability — this is API hygiene plus one genuine hardening property:
 * a handle authenticates the path it was minted for (AES-256-GCM), so a
 * client can't forge a handle for an arbitrary path the way it already can
 * type an arbitrary path string.
 *
 * A per-process random key (not persisted) means handles never survive a
 * restart — acceptable because handles are meant to be re-minted from a
 * fresh renderer:list-directory call, not stored across sessions, and it
 * avoids having to manage/rotate a persistent secret.
 */

const crypto = require('node:crypto');

const HANDLE_KEY = crypto.randomBytes(32);
const IV_LENGTH = 12; // GCM standard nonce length
const AUTH_TAG_LENGTH = 16;
const HANDLE_PREFIX = 'bruno-fh:';

const encodeFileHandle = (absolutePath) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', HANDLE_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(absolutePath, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return HANDLE_PREFIX + Buffer.concat([iv, authTag, encrypted]).toString('base64url');
};

const isFileHandle = (value) => typeof value === 'string' && value.startsWith(HANDLE_PREFIX);

/**
 * @throws if `handle` isn't a validly-encoded, untampered handle minted by
 * encodeFileHandle() from this same process.
 */
const decodeFileHandle = (handle) => {
  const raw = Buffer.from(handle.slice(HANDLE_PREFIX.length), 'base64url');
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Malformed file handle');
  }

  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv('aes-256-gcm', HANDLE_KEY, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Invalid or tampered file handle');
  }
};

/**
 * Resolves either an opaque handle or a raw path string into a real
 * filesystem path. `value` may be null/undefined (renderer:list-directory's
 * dirPath is optional, defaulting to the home directory).
 */
const resolvePathOrHandle = (value) => (isFileHandle(value) ? decodeFileHandle(value) : value);

module.exports = { encodeFileHandle, decodeFileHandle, isFileHandle, resolvePathOrHandle };
