/**
 * Privileged Channel Policy — blocks the highest-blast-radius IPC channels
 * (arbitrary shell execution, arbitrary git clone/remote-connect) by
 * default in Browser Bridge mode, since any client that can reach the
 * Bridge's HTTP port can otherwise invoke them with no further gating.
 *
 * This intentionally does NOT cover regular collection/workspace read-write
 * channels (save/delete request, environments, etc.) — those are normal
 * in-app editing operations, not a distinct capability tier, and gating
 * them requires the full per-channel capability system from the roadmap
 * (Improvement.md P0.2), not a default-safe toggle like this one.
 *
 * Set BRUNO_SERVER_ENABLE_PRIVILEGED_CHANNELS=true to re-enable them.
 */

const PRIVILEGED_CHANNEL_PATTERNS = [
  /^terminal:/,
  /^renderer:clone-git-repository$/,
  /^renderer:connect-collection-to-git$/,
  /^renderer:disconnect-collection-from-git$/
];

const PRIVILEGED_CHANNELS_ENABLED = process.env.BRUNO_SERVER_ENABLE_PRIVILEGED_CHANNELS === 'true';

const isPrivilegedChannel = (channel) => PRIVILEGED_CHANNEL_PATTERNS.some((pattern) => pattern.test(channel));

module.exports = { isPrivilegedChannel, PRIVILEGED_CHANNELS_ENABLED };
