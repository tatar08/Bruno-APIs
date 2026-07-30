/**
 * Channel → Capability taxonomy (Improvement.md P0.2).
 *
 * Canonical source moved to @usebruno/rpc-contract (Improvement.md P0.5) so
 * the taxonomy is shared between the Electron IPC surface and the Browser
 * Bridge instead of being owned solely by bruno-server. This file re-exports
 * that package's API unchanged so ipc-proxy.js, channel-policy.js and the
 * existing test suite require zero changes.
 */

const { getCapability, ALL_CAPABILITIES, SOURCE_TO_CAPABILITY, CHANNEL_CAPABILITY_OVERRIDES } = require('@usebruno/rpc-contract');

module.exports = { getCapability, ALL_CAPABILITIES, SOURCE_TO_CAPABILITY, CHANNEL_CAPABILITY_OVERRIDES };
