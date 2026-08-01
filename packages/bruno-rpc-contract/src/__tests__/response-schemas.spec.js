const { RESPONSE_SHAPES } = require('../response-schemas');
const realChannelSources = require('../../fixtures/real-channel-sources.json');

// Same drift-detection rationale as request-schemas.spec.js: RESPONSE_SHAPES
// is hand-authored documentation, so this guards against an entry surviving
// a channel rename (or a typo'd channel name never matching anything real).

describe('response-schemas', () => {
  it('every documented channel corresponds to a real registered channel', () => {
    const realChannels = new Set(realChannelSources.map(({ channel }) => channel));
    const stale = Object.keys(RESPONSE_SHAPES).filter((channel) => !realChannels.has(channel));
    expect(stale).toEqual([]);
  });

  it('every entry is a non-empty description string', () => {
    for (const [channel, shape] of Object.entries(RESPONSE_SHAPES)) {
      expect(typeof shape).toBe('string');
      expect(shape.length).toBeGreaterThan(0);
    }
  });
});
