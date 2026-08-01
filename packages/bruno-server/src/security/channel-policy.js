/**
 * Channel Policy — per-capability payload limits layered on top of
 * channel-capabilities.js (Improvement.md P0.2).
 *
 * The per-channel argument schemas (CHANNEL_SCHEMAS/validateArgs) moved to
 * @usebruno/rpc-contract's request-schemas.js as the canonical copy
 * (Improvement.md P0.5), same rationale as channel-capabilities.js: the
 * schemas are really a shared Electron/Browser-Bridge contract, not a
 * bruno-server-only concern. This file re-exports that package's API
 * unchanged (under the CHANNEL_SCHEMAS/validateArgs names this package's
 * callers and tests already use) so ipc-proxy.js and the existing test
 * suite require zero changes. getMaxPayloadBytes/CAPABILITY_MAX_PAYLOAD_BYTES
 * stay here since payload caps are bruno-server-specific policy, not part of
 * the shared contract.
 */

const { getCapability } = require('./channel-capabilities');
const { REQUEST_SCHEMAS: CHANNEL_SCHEMAS, validateRequestArgs: validateArgs } = require('@usebruno/rpc-contract');

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

module.exports = { getMaxPayloadBytes, validateArgs, CAPABILITY_MAX_PAYLOAD_BYTES, CHANNEL_SCHEMAS };
