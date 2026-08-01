/**
 * Filesystem Sandbox — restricts Browser Bridge filesystem access to a
 * configured set of allowed roots (Improvement.md P0.3).
 *
 * Disabled by default (BRUNO_SERVER_ALLOWED_ROOTS unset): zero behavior
 * change from today, since ~85 IPC handlers across bruno-electron accept a
 * caller-supplied path in inconsistent argument shapes (positional, nested
 * in an object, arrays, source/dest pairs) and only a handful validate it
 * at all. Building a fully precise per-channel path extractor for all of
 * them is a substantial, separate effort (see CHANNEL_PATH_EXTRACTORS
 * below for the extension point).
 *
 * When enabled, this module is a *coarse* blanket guard: it walks every
 * IPC call's arguments (bounded depth, arrays/plain objects included),
 * collects anything that looks like an absolute filesystem path, resolves
 * it (following an existing ancestor's realpath so symlink escapes and
 * `..` traversal are caught even for not-yet-existing paths), and rejects
 * the whole call if any candidate falls outside every allowed root. It
 * does not understand per-channel semantics (e.g. "arg0 is a read source,
 * arg1 is a write dest") and can both over- and under-match — it is a
 * safety net, not a substitute for per-handler validation.
 *
 * To add precision for a specific channel, register an extractor in
 * CHANNEL_PATH_EXTRACTORS: `(args) => string[]` returning exactly the
 * path-bearing arguments for that channel. Channels without a registered
 * extractor fall back to the generic recursive scan.
 *
 * Per-root read-only mode: a root can be suffixed with `:ro` in
 * BRUNO_SERVER_ALLOWED_ROOTS (e.g. `/srv/reference-collections:ro`) to
 * allow reads from it while blocking writes. Because this module cannot
 * reliably tell which argument of an arbitrary channel is "the write
 * target" (same limitation as the rest of this file), the read/write
 * split is deliberately **fail-safe, not fail-open**: only channels in
 * READ_ONLY_SAFE_CHANNELS below (manually verified against their
 * bruno-electron handler source to confirm they never write to disk) are
 * allowed to touch a read-only root. Every other channel — including any
 * future/unaudited one — is treated as a write and rejected against a
 * read-only root by default. Getting this list wrong in the "channel
 * omitted" direction only costs a false-positive rejection, never a
 * silent write through what was configured as read-only.
 *
 * Runtime revocation: routes/admin.js exposes an authenticated (when P0.1
 * auth is on) GET/DELETE pair over listAllowedRoots()/revokeRoot() so a
 * root can be narrowed without restarting the server. See those functions
 * below for why this is revoke-only (no un-revoke, no adding new roots).
 */

const fs = require('fs');
const path = require('path');

const MAX_SCAN_DEPTH = 3;

// Matches POSIX absolute paths (`/foo`), Windows drive-absolute paths
// (`C:\foo`, `C:/foo`), Windows UNC/extended-length paths (`\\server\share`,
// `\\?\C:\foo`), and Windows drive-*relative* paths (`C:foo`, no separator
// after the colon — resolves against that drive's current directory, which
// Node's path.win32.resolve() honors same as native Windows APIs do). The
// drive-relative form is easy to miss because it looks unlike a "real" path
// at a glance, but it is exactly as capable of escaping an allowed root as
// the other forms once resolved, so it must be flagged as a candidate too —
// consistent with this scanner's documented bias toward over-matching
// (false-positive rejection) over under-matching (silent bypass).
const ABSOLUTE_PATH_RE = /^(\/|[a-zA-Z]:|\\\\)/;

// Verified against packages/bruno-electron/src/ipc/filesystem.js: every
// handler in that file only stats/reads/lists/resolves paths, none of them
// write. Kept intentionally small and hand-verified rather than inferred
// from channel name patterns (see module doc comment above).
const READ_ONLY_SAFE_CHANNELS = new Set([
  'renderer:browse-directory',
  'renderer:browse-files',
  'renderer:browse-pac-file',
  'renderer:load-runner-dataset',
  'renderer:exists-sync',
  'renderer:resolve-path',
  'renderer:is-directory',
  'renderer:find-unique-folder-name',
  'renderer:list-directory'
]);

const isReadOnlySafeChannel = (channel) => READ_ONLY_SAFE_CHANNELS.has(channel);

const parseAllowedRoots = () => {
  const configured = process.env.BRUNO_SERVER_ALLOWED_ROOTS;
  if (!configured) return null;

  return configured
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const readOnly = entry.toLowerCase().endsWith(':ro');
      const rawPath = readOnly ? entry.slice(0, -3) : entry;
      return { path: realpathBestEffort(path.resolve(rawPath)), readOnly };
    });
};

const allowedRoots = parseAllowedRoots();

// Runtime-revoked roots (Improvement.md P0.3: "ให้ผู้ใช้ revoke root ได้").
// BRUNO_SERVER_ALLOWED_ROOTS is read once at process start, so this is the
// only way to narrow access without a restart. Intentionally in-memory and
// one-directional (revoke only, no un-revoke API) — a restart re-parses the
// env var and forgets any revocation, which is the expected way back to a
// previously-revoked root.
const revokedRootPaths = new Set();

const isFilesystemSandboxEnabled = () => allowedRoots !== null;

/**
 * @returns {{ path: string, readOnly: boolean, revoked: boolean }[]}
 */
function listAllowedRoots() {
  if (!isFilesystemSandboxEnabled()) return [];
  return allowedRoots.map((root) => ({ ...root, revoked: revokedRootPaths.has(root.path) }));
}

/**
 * Revokes a configured root by its exact resolved path (as returned by
 * listAllowedRoots()) so it's rejected for every channel from now on, same
 * as a path fully outside every allowed root.
 * @returns {boolean} whether `rootPath` matched a configured root
 */
function revokeRoot(rootPath) {
  if (!isFilesystemSandboxEnabled()) return false;
  const match = allowedRoots.find((root) => root.path === rootPath);
  if (!match) return false;
  revokedRootPaths.add(rootPath);
  return true;
}

function realpathBestEffort(absolutePath) {
  try {
    return fs.realpathSync(absolutePath);
  } catch (err) {
    return absolutePath;
  }
}

/**
 * Resolves a candidate path to a canonical absolute form suitable for a
 * root-containment check, without requiring the path to already exist:
 * walk up to the nearest existing ancestor, realpath *that* (so an
 * existing symlinked ancestor can't be used to escape), then rejoin the
 * remaining (not-yet-existing) segments.
 */
function resolveForContainmentCheck(candidatePath) {
  let current = path.resolve(candidatePath);
  const remainder = [];

  while (true) {
    if (fs.existsSync(current)) {
      return path.join(realpathBestEffort(current), ...remainder);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding an existing ancestor.
      return path.resolve(candidatePath);
    }
    remainder.unshift(path.basename(current));
    current = parent;
  }
}

// Note on case-insensitive filesystems (Windows/macOS default, NTFS/APFS):
// this containment check is a plain case-sensitive string comparison, which
// would be bypassable on its own (e.g. root `C:\Users\foo\Collections` vs.
// candidate `C:\USERS\foo\collections\..\secret`). It is safe in practice
// only because both sides are realpath'd first — parseAllowedRoots() at
// startup and resolveForContainmentCheck() per candidate above — and
// fs.realpathSync() queries the OS for the canonical on-disk casing of an
// existing path, normalizing both sides to the same casing before this
// comparison ever runs. This has not been exercised on an actual Windows
// host (no such box in this environment); it relies on documented Node.js
// fs.realpathSync() behavior rather than a live-verified test.
function isUnderRoot(resolvedPath, rootPath) {
  const relative = path.relative(rootPath, resolvedPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Finds the allowed root (if any) containing resolvedPath. Prefers a
 * read-write match over a read-only one when a path happens to fall under
 * more than one configured root, so a channel isn't spuriously blocked by
 * a read-only root if a read-write root also covers it.
 */
function findContainingRoot(resolvedPath) {
  let readOnlyMatch = null;
  for (const root of allowedRoots) {
    if (revokedRootPaths.has(root.path)) continue;
    if (isUnderRoot(resolvedPath, root.path)) {
      if (!root.readOnly) return root;
      readOnlyMatch = root;
    }
  }
  return readOnlyMatch;
}

/**
 * @returns {'outside-root' | 'read-only-root' | null} null means allowed.
 */
function checkPathPolicy(candidatePath, channel) {
  if (!isFilesystemSandboxEnabled()) return null;
  const resolved = resolveForContainmentCheck(candidatePath);
  const root = findContainingRoot(resolved);
  if (!root) return 'outside-root';
  if (root.readOnly && !isReadOnlySafeChannel(channel)) return 'read-only-root';
  return null;
}

function isPathAllowed(candidatePath, channel) {
  return checkPathPolicy(candidatePath, channel) === null;
}

/**
 * Generic fallback extractor: recursively scans args for absolute-path-
 * shaped strings, bounded to MAX_SCAN_DEPTH to avoid pathological inputs.
 */
function findPathsInValue(value, depth = 0, found = []) {
  if (depth > MAX_SCAN_DEPTH || value == null) return found;

  if (typeof value === 'string') {
    if (ABSOLUTE_PATH_RE.test(value)) found.push(value);
    return found;
  }

  if (Array.isArray(value)) {
    for (const item of value) findPathsInValue(item, depth + 1, found);
    return found;
  }

  if (typeof value === 'object') {
    for (const key of Object.keys(value)) findPathsInValue(value[key], depth + 1, found);
    return found;
  }

  return found;
}

// Extension point for channel-specific precision. Empty today; see module
// doc comment above for how/why to add entries incrementally.
const CHANNEL_PATH_EXTRACTORS = {};

function extractCandidatePaths(channel, args) {
  const extractor = CHANNEL_PATH_EXTRACTORS[channel];
  if (extractor) return extractor(args);
  return findPathsInValue(args);
}

/**
 * @returns {string | null} the first disallowed candidate path, or null if
 * every candidate path found in `args` is inside an allowed root (or the
 * sandbox is disabled). Kept string-returning for backward compatibility
 * with existing callers/tests; use findPathPolicyViolation for the reason.
 */
function findDisallowedPath(channel, args) {
  const violation = findPathPolicyViolation(channel, args);
  return violation ? violation.path : null;
}

/**
 * @returns {{ path: string, reason: 'outside-root' | 'read-only-root' } | null}
 */
function findPathPolicyViolation(channel, args) {
  if (!isFilesystemSandboxEnabled()) return null;
  const candidates = extractCandidatePaths(channel, args);
  for (const candidate of candidates) {
    const reason = checkPathPolicy(candidate, channel);
    if (reason) return { path: candidate, reason };
  }
  return null;
}

module.exports = {
  isFilesystemSandboxEnabled,
  isPathAllowed,
  findDisallowedPath,
  findPathPolicyViolation,
  isReadOnlySafeChannel,
  listAllowedRoots,
  revokeRoot,
  // exported for testing
  resolveForContainmentCheck,
  findPathsInValue
};
