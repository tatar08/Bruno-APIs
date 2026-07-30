const { CHANNELS, ALL_CHANNELS } = require('../channels');
const rawSources = require('../../fixtures/real-channel-sources.json');

describe('channels', () => {
  it('loads without a constant-name collision (module require succeeds)', () => {
    expect(() => require('../channels')).not.toThrow();
  });

  it('exposes every fixture channel as a frozen ALL_CHANNELS entry, sorted', () => {
    const expected = rawSources.map((entry) => entry.channel).sort();
    expect(ALL_CHANNELS).toEqual(expected);
    expect(Object.isFrozen(ALL_CHANNELS)).toBe(true);
  });

  it('maps every channel to a CONSTANT_CASE key whose value is the raw channel string', () => {
    expect(Object.keys(CHANNELS).length).toBe(ALL_CHANNELS.length);
    expect(CHANNELS.RENDERER_READY).toBe('renderer:ready');
    for (const channel of ALL_CHANNELS) {
      const constantName = channel.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
      expect(CHANNELS[constantName]).toBe(channel);
    }
  });

  it('freezes CHANNELS so callers cannot mutate the contract at runtime', () => {
    expect(Object.isFrozen(CHANNELS)).toBe(true);
  });
});
