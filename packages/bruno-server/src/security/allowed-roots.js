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
 */

const fs = require('fs');
const path = require('path');

const MAX_SCAN_DEPTH = 3;

const ABSOLUTE_PATH_RE = /^(\/|[a-zA-Z]:[\\/]|\\\\)/;

const parseAllowedRoots = () => {
  const configured = process.env.BRUNO_SERVER_ALLOWED_ROOTS;
  if (!configured) return null;

  return configured
    .split(',')
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => realpathBestEffort(path.resolve(root)));
};

const allowedRoots = parseAllowedRoots();

const isFilesystemSandboxEnabled = () => allowedRoots !== null;

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

function isUnderRoot(resolvedPath, root) {
  const relative = path.relative(root, resolvedPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isPathAllowed(candidatePath) {
  if (!isFilesystemSandboxEnabled()) return true;
  const resolved = resolveForContainmentCheck(candidatePath);
  return allowedRoots.some((root) => isUnderRoot(resolved, root));
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
 * sandbox is disabled).
 */
function findDisallowedPath(channel, args) {
  if (!isFilesystemSandboxEnabled()) return null;
  const candidates = extractCandidatePaths(channel, args);
  for (const candidate of candidates) {
    if (!isPathAllowed(candidate)) return candidate;
  }
  return null;
}

module.exports = {
  isFilesystemSandboxEnabled,
  isPathAllowed,
  findDisallowedPath,
  // exported for testing
  resolveForContainmentCheck,
  findPathsInValue
};
