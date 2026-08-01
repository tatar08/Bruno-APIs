const { REQUEST_SCHEMAS, validateRequestArgs } = require('../request-schemas');
const realChannelSources = require('../../fixtures/real-channel-sources.json');

// Same drift-detection rationale as capabilities.spec.js: REQUEST_SCHEMAS is
// hand-authored, so this guards against a schema surviving a channel rename
// (or a typo'd channel name never actually matching anything at runtime).

describe('request-schemas', () => {
  it('every schema key corresponds to a real registered channel', () => {
    const realChannels = new Set(realChannelSources.map(({ channel }) => channel));
    const stale = Object.keys(REQUEST_SCHEMAS).filter((channel) => !realChannels.has(channel));
    expect(stale).toEqual([]);
  });

  it('every schema has internally consistent minArgs/maxArgs/argTypes', () => {
    for (const [channel, schema] of Object.entries(REQUEST_SCHEMAS)) {
      expect(schema.minArgs).toBeLessThanOrEqual(schema.maxArgs);
      expect(Array.isArray(schema.argTypes)).toBe(true);
      expect(schema.argTypes.length).toBeLessThanOrEqual(schema.maxArgs);
    }
  });

  describe('validateRequestArgs', () => {
    it('rejects non-array args', () => {
      expect(validateRequestArgs('renderer:save-file', 'not-an-array')).toBe('"args" must be an array');
    });

    it('returns null for a channel with no registered schema', () => {
      expect(validateRequestArgs('renderer:get-global-environments', ['anything', 123])).toBeNull();
    });

    it('enforces minArgs/maxArgs', () => {
      expect(validateRequestArgs('renderer:save-file', ['/path'])).toMatch(/expects 2 argument/);
      expect(validateRequestArgs('renderer:save-file', ['/path', 'content'])).toBeNull();
    });

    it('enforces argTypes, including union types', () => {
      expect(validateRequestArgs('renderer:save-file', [123, 'content'])).toBe(
        'Channel "renderer:save-file" argument 0 must be of type string, got number'
      );
      expect(validateRequestArgs('renderer:import-collection', [{}, '/path'])).toBeNull();
      expect(validateRequestArgs('renderer:import-collection', [[], '/path'])).toBeNull();
      expect(validateRequestArgs('renderer:import-collection', ['not-object-or-array', '/path'])).toBe(
        'Channel "renderer:import-collection" argument 0 must be of type object|array, got string'
      );
    });
  });
});
