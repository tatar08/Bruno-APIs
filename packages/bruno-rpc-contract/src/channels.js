/**
 * Typed channel name constants (Improvement.md P0.5).
 *
 * Generated from fixtures/real-channel-sources.json — a mechanically
 * captured snapshot of every channel actually registered by
 * bruno-electron's IPC handlers, produced by booting the real bruno-server
 * process and dumping HandlerRegistry's channel->source-file map (the same
 * fixture channel-capabilities.js's coverage test verifies against). This
 * is a real, current channel list, not a hand-typed one that can silently
 * drift out of sync with the handlers it's supposed to describe.
 *
 * CHANNELS lets callers write `CHANNELS.RENDERER_READY` instead of the raw
 * string `'renderer:ready'` — a typo in the constant name is a
 * ReferenceError at the call site; a typo in a raw string is a silent
 * runtime 404 from the Browser Bridge. Regenerating this list (by
 * re-running the same live-server dump used to produce the fixture) and
 * running audit-parity.js is how channel drift gets caught — see
 * scripts/audit-parity.js.
 */

const rawSources = require('../fixtures/real-channel-sources.json');

function toConstantName(channel) {
  return channel.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

const ALL_CHANNELS = Object.freeze(rawSources.map((entry) => entry.channel).sort());

const CHANNELS = {};
const constantNameToChannel = new Map();
for (const channel of ALL_CHANNELS) {
  const constantName = toConstantName(channel);
  const collidesWith = constantNameToChannel.get(constantName);
  if (collidesWith) {
    throw new Error(
      `@usebruno/rpc-contract channels.js: constant name "${constantName}" collides between "${collidesWith}" and "${channel}" — pick a disambiguation scheme for toConstantName().`
    );
  }
  constantNameToChannel.set(constantName, channel);
  CHANNELS[constantName] = channel;
}
Object.freeze(CHANNELS);

module.exports = { CHANNELS, ALL_CHANNELS };
