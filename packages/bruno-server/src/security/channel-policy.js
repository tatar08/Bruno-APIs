/**
 * Channel Policy — per-capability payload limits and per-channel argument
 * schemas layered on top of channel-capabilities.js (Improvement.md P0.2).
 *
 * This intentionally does NOT attempt argument schemas for all 203+
 * registered channels — authoring and testing that many schemas by hand in
 * one pass is far more likely to introduce false-positive 400s on real
 * handler signatures than to catch anything meaningful. CHANNEL_SCHEMAS is
 * an extension point (same pattern as allowed-roots.js's
 * CHANNEL_PATH_EXTRACTORS) populated for the channels where getting the
 * shape wrong has outsized consequences: the already-privileged git-mutate
 * channels and the terminal channels. Everything else is fail-open (no
 * schema registered → no additional validation beyond "args is an array").
 */

const { getCapability } = require('./channel-capabilities');

// Only capability groups that structurally can never need more than a
// trivial payload get a tighter cap; every other capability (collections,
// filesystem, network, workspace, git, ai, ...) can legitimately carry file
// content, request bodies or snapshot data, so they fall back to the
// existing global BRUNO_SERVER_JSON_LIMIT rather than a guessed-at figure
// that risks breaking real import/upload/request-send flows.
const CAPABILITY_MAX_PAYLOAD_BYTES = {
  ui: 8 * 1024,
  system: 8 * 1024,
  notifications: 16 * 1024
};

function getMaxPayloadBytes(channel, sourceFile) {
  const capability = getCapability(channel, sourceFile);
  return CAPABILITY_MAX_PAYLOAD_BYTES[capability] ?? null; // null = no additional cap
}

const CHANNEL_SCHEMAS = {
  'renderer:clone-git-repository': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:connect-collection-to-git': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:disconnect-collection-from-git': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'terminal:create': { minArgs: 0, maxArgs: 1, argTypes: ['object'] },
  'terminal:input': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'terminal:resize': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'object'] },
  'terminal:kill': { minArgs: 1, maxArgs: 1, argTypes: ['string'] },
  'terminal:list-sessions': { minArgs: 0, maxArgs: 0, argTypes: [] },

  // Irreversible deletion channels (ipc/collection.js) — same "outsized
  // consequences" criterion as the git/terminal schemas above. Signatures
  // verified against both the ipcMain.handle() destructuring in
  // bruno-electron/src/ipc/collection.js and the actual ipcRenderer.invoke()
  // call sites in bruno-app (ReduxStore/slices/{app,collections}/actions.js).
  'renderer:delete-item': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:delete-environment': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:delete-dotenv-file': { minArgs: 1, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:delete-transient-requests': { minArgs: 2, maxArgs: 2, argTypes: ['array', 'string'] },
  'renderer:remove-collection': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:delete-cookies-for-domain': { minArgs: 1, maxArgs: 1, argTypes: ['string'] },
  'renderer:delete-cookie': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] }
};

/**
 * Returns a human-readable validation error, or null if args are valid
 * (including the common case of no schema being registered for `channel`).
 */
function validateArgs(channel, args) {
  if (!Array.isArray(args)) {
    return '"args" must be an array';
  }

  const schema = CHANNEL_SCHEMAS[channel];
  if (!schema) return null;

  if (args.length < schema.minArgs || args.length > schema.maxArgs) {
    const expected = schema.minArgs === schema.maxArgs ? `${schema.minArgs}` : `${schema.minArgs}-${schema.maxArgs}`;
    return `Channel "${channel}" expects ${expected} argument(s), got ${args.length}`;
  }

  for (let i = 0; i < schema.argTypes.length; i++) {
    const expectedType = schema.argTypes[i];
    const value = args[i];
    if (value === undefined) continue; // covered by minArgs above when required

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== expectedType) {
      return `Channel "${channel}" argument ${i} must be of type ${expectedType}, got ${actualType}`;
    }
  }

  return null;
}

module.exports = { getMaxPayloadBytes, validateArgs, CAPABILITY_MAX_PAYLOAD_BYTES, CHANNEL_SCHEMAS };
