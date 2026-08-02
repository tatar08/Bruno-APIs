const { EVENT_SHAPES } = require('../event-schemas');

// No parity fixture check here (unlike request-schemas.spec.js/response-schemas.spec.js):
// those rely on fixtures/real-channel-sources.json, a mechanical dump of every
// ipcMain.handle()/on() registration — events have no equivalent single
// registration point (they're scattered .send() call sites), so building a
// matching extractor is future work (see event-schemas.js's header). This
// only guards against a documented entry going empty/malformed.

describe('event-schemas', () => {
  it('every entry is a non-empty description string', () => {
    for (const [channel, shape] of Object.entries(EVENT_SHAPES)) {
      expect(typeof shape).toBe('string');
      expect(shape.length).toBeGreaterThan(0);
    }
  });
});
