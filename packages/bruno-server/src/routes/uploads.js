/**
 * Scratch File Upload Route (Improvement.md P1.1 Transfer Center)
 *
 * A browser <input type=file>/drag-drop only ever exposes file *bytes*, never
 * a path on the Bridge's own filesystem — but a subset of existing IPC
 * channels (renderer:import-collection-zip, renderer:is-bruno-collection-zip,
 * renderer:import-workspace) require a path that already exists on the
 * Bridge. This route bridges that gap: it accepts an uploaded file, stores it
 * in a server-side scratch directory, and hands back a real path those
 * channels can then be called with unchanged via the existing
 * POST /api/ipc/:channel proxy.
 *
 * POST /api/uploads/scratch-file
 * multipart/form-data, single field "file"
 * Response: { data: "<absolute scratch path on the Bridge>", sha256: "<hex digest>" }
 *
 * The sha256 digest is computed server-side from the bytes actually written
 * to the scratch file, so the caller can confirm nothing was corrupted or
 * truncated in transit (Improvement.md P1.1 Transfer Center checksums).
 *
 * Every consumer of this route (uploadZipFile() in bruno-app) only ever
 * uploads zip archives, so this route rejects anything else outright rather
 * than trusting the client: the extension is checked (Content-Type is
 * client-controlled and not trustworthy) and, once the bytes are on disk,
 * the file's magic bytes are checked against the real ZIP local/central
 * directory signatures — a mismatch means either a spoofed extension or a
 * corrupt archive, and either way downstream handlers (AdmZip via
 * renderer:is-bruno-collection-zip / renderer:import-collection-zip /
 * renderer:import-workspace) should never see the file (Improvement.md P0.3
 * filesystem sandbox: upload size/extension/magic-byte validation).
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { checkRateLimit, acquireConcurrencySlot, releaseConcurrencySlot } = require('../security/ipc-limits');
const { ERROR_CODES } = require('@usebruno/rpc-contract');

const SCRATCH_DIR = path.join(os.tmpdir(), 'bruno-bridge-transfers');
const UPLOAD_MAX_BYTES = (Number(process.env.BRUNO_SERVER_UPLOAD_MAX_MB) || 500) * 1024 * 1024;
// Scratch files only need to survive one upload -> sniff -> import round
// trip within a single user interaction; this is a coarse safety net for
// abandoned uploads (tab closed, import cancelled), not precise lifecycle
// tracking, matching the rest of this route's "best effort" posture.
const SCRATCH_MAX_AGE_MS = 60 * 60 * 1000;

fs.mkdirSync(SCRATCH_DIR, { recursive: true });

// Only the extension is trusted from the client-supplied filename (so
// downstream handlers that sniff by extension, e.g. AdmZip via
// renderer:is-bruno-collection-zip, see a real .zip suffix) — the on-disk
// name itself is always a random UUID, never the caller-supplied filename.
// (This is also this route's filename-normalization story: the caller's
// name never reaches the filesystem in any form beyond a whitelisted
// extension, so there's no traversal/control-character surface to sanitize.)
function sanitizeExtension(originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

class UploadRejectedError extends Error {}

// Content-Type is client-controlled and not trustworthy; the extension is
// at least consistent with what every real caller sends (uploadZipFile()
// always names the field from a .zip File/Blob).
function fileFilter(req, file, cb) {
  if (!/\.zip$/i.test(String(file.originalname || ''))) {
    return cb(new UploadRejectedError('Only .zip files are accepted.'));
  }
  cb(null, true);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SCRATCH_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${sanitizeExtension(file.originalname)}`)
});

const upload = multer({ storage, fileFilter, limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } });

// Real ZIP archives (including empty ones) always start with one of these
// four-byte signatures — the extension check above only rules out an
// obviously wrong Content-Type/name, this rules out a spoofed extension or
// a truncated/corrupt upload before any downstream handler unzips it.
const ZIP_MAGIC_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]), // local file header (non-empty archive)
  Buffer.from([0x50, 0x4b, 0x05, 0x06]), // end of central directory (empty archive)
  Buffer.from([0x50, 0x4b, 0x07, 0x08]) // data descriptor (spanned archive)
];

function looksLikeZip(header) {
  return ZIP_MAGIC_SIGNATURES.some((magic) => header.length >= magic.length && header.subarray(0, magic.length).equals(magic));
}

async function readHeaderBytes(filePath, length) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function sweepScratchDir() {
  fs.readdir(SCRATCH_DIR, (err, entries) => {
    if (err) return;
    const now = Date.now();
    entries.forEach((entry) => {
      const entryPath = path.join(SCRATCH_DIR, entry);
      fs.stat(entryPath, (statErr, stats) => {
        if (statErr) return;
        if (now - stats.mtimeMs > SCRATCH_MAX_AGE_MS) fs.unlink(entryPath, () => {});
      });
    });
  });
}
const sweepTimer = setInterval(sweepScratchDir, 10 * 60 * 1000);
sweepTimer.unref?.();

const createUploadsRouter = () => {
  const router = express.Router();

  router.post('/scratch-file', (req, res) => {
    const clientKey = req.brunoSessionId || req.ip;
    if (!checkRateLimit(clientKey)) {
      return res.status(429).json({ code: ERROR_CODES.RATE_LIMITED, error: 'Too many requests, slow down.' });
    }
    if (!acquireConcurrencySlot(clientKey)) {
      return res.status(429).json({ code: ERROR_CODES.CONCURRENCY_LIMITED, error: 'Too many concurrent requests in flight.' });
    }

    upload.single('file')(req, res, async (err) => {
      releaseConcurrencySlot(clientKey);

      if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? `File exceeds the upload size limit (BRUNO_SERVER_UPLOAD_MAX_MB=${process.env.BRUNO_SERVER_UPLOAD_MAX_MB || 500}).`
          : err.message;
        return res.status(413).json({ code: ERROR_CODES.PAYLOAD_TOO_LARGE, error: message });
      }
      if (err instanceof UploadRejectedError) {
        return res.status(400).json({ code: ERROR_CODES.INVALID_ARGS, error: err.message });
      }
      if (err) {
        return res.status(500).json({ code: ERROR_CODES.HANDLER_ERROR, error: err.message || 'Upload failed' });
      }
      if (!req.file) {
        return res.status(400).json({ code: ERROR_CODES.INVALID_ARGS, error: 'No file uploaded (expected multipart field "file").' });
      }

      try {
        const header = await readHeaderBytes(req.file.path, 4);
        if (!looksLikeZip(header)) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ code: ERROR_CODES.INVALID_ARGS, error: 'Uploaded file is not a valid zip archive (magic bytes do not match).' });
        }
      } catch (readErr) {
        fs.unlink(req.file.path, () => {});
        return res.status(500).json({ code: ERROR_CODES.HANDLER_ERROR, error: readErr.message || 'Failed to inspect uploaded file' });
      }

      try {
        const sha256 = await hashFile(req.file.path);
        return res.json({ data: req.file.path, sha256 });
      } catch (hashErr) {
        fs.unlink(req.file.path, () => {});
        return res.status(500).json({ code: ERROR_CODES.HANDLER_ERROR, error: hashErr.message || 'Failed to checksum uploaded file' });
      }
    });
  });

  return router;
};

module.exports = { createUploadsRouter, SCRATCH_DIR };
