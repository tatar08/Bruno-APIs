const { getCapability, ALL_CAPABILITIES, CHANNEL_CAPABILITY_OVERRIDES } = require('../channel-capabilities');
const realChannelSources = require('./fixtures/real-channel-sources.json');

// real-channel-sources.json is a snapshot of HandlerRegistry's actual
// channel -> source file mapping, captured by booting the real bruno-server
// process and dumping handlerRegistry.getChannelSource() for every
// registered channel (see handler-registry.js's _captureSourceFile). If a
// future bruno-electron change adds a new ipc/*.js file, this test will
// start failing for its channels until SOURCE_TO_CAPABILITY is updated —
// that's the point: it catches capability-taxonomy drift instead of letting
// new channels silently resolve to 'unknown'.

describe('channel-capabilities', () => {
  it('resolves every real registered channel to a known capability, never "unknown"', () => {
    const unresolved = realChannelSources.filter(({ channel, sourceFile }) => {
      const capability = getCapability(channel, sourceFile);
      return !ALL_CAPABILITIES.includes(capability);
    });

    expect(unresolved).toEqual([]);
  });

  it('has at least one real channel exercising every declared capability', () => {
    const seen = new Set(realChannelSources.map(({ channel, sourceFile }) => getCapability(channel, sourceFile)));
    const missing = ALL_CAPABILITIES.filter((capability) => !seen.has(capability));
    expect(missing).toEqual([]);
  });

  it('resolves an unrecognized channel/source pair to "unknown"', () => {
    expect(getCapability('renderer:totally-made-up-channel', 'ipc/does-not-exist.js')).toBe('unknown');
  });

  it('applies per-channel overrides ahead of the source-file default', () => {
    for (const [channel, expectedCapability] of Object.entries(CHANNEL_CAPABILITY_OVERRIDES)) {
      // ipc/workspace.js would normally resolve to 'workspace', not 'git'
      expect(getCapability(channel, 'ipc/workspace.js')).toBe(expectedCapability);
    }
  });
});
