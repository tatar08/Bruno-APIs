let mockGetCurrentSessionKey;

// electron-store isn't mocked anywhere else in this package's tests, so
// there's no existing in-memory fake to reuse - a real Store() here would
// write to the actual user config directory during `npm test`, which is
// exactly the file-clobbering hazard this module exists to avoid triggering.
jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => {
    const data = {};
    return {
      get(key, defaultValue) {
        const parts = key.split('.');
        let node = data;
        for (const part of parts) {
          if (node == null || typeof node !== 'object' || !(part in node)) return defaultValue;
          node = node[part];
        }
        return node;
      },
      set(key, value) {
        const parts = key.split('.');
        let node = data;
        for (let i = 0; i < parts.length - 1; i++) {
          if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
          node = node[parts[i]];
        }
        node[parts[parts.length - 1]] = value;
      }
    };
  });
});

jest.mock('@usebruno/requests', () => ({
  getCurrentSessionKey: (...args) => mockGetCurrentSessionKey(...args)
}));

describe('RecentBrowsePaths (Improvement.md P1.1 Browse modal recent/favorites)', () => {
  let RecentBrowsePaths;
  let store;

  beforeEach(() => {
    jest.resetModules();
    mockGetCurrentSessionKey = jest.fn(() => undefined);
    RecentBrowsePaths = require('./recent-browse-paths');
    store = new RecentBrowsePaths();
  });

  describe('no session context (Electron/no-auth mode)', () => {
    it('starts with empty recent and favorites lists', () => {
      expect(store.getRecent()).toEqual([]);
      expect(store.getFavorites()).toEqual([]);
    });

    it('adds a path to the front of the recent list', () => {
      store.addRecent('/a');
      store.addRecent('/b');
      expect(store.getRecent()).toEqual(['/b', '/a']);
    });

    it('de-duplicates by moving a re-added path back to the front', () => {
      store.addRecent('/a');
      store.addRecent('/b');
      store.addRecent('/a');
      expect(store.getRecent()).toEqual(['/a', '/b']);
    });

    it('caps the recent list at 10 entries, dropping the oldest', () => {
      for (let i = 0; i < 12; i++) store.addRecent(`/path-${i}`);
      const recent = store.getRecent();
      expect(recent).toHaveLength(10);
      expect(recent[0]).toBe('/path-11');
      expect(recent).not.toContain('/path-0');
      expect(recent).not.toContain('/path-1');
    });

    it('toggles a path into favorites and back out', () => {
      store.toggleFavorite('/a');
      expect(store.getFavorites()).toEqual(['/a']);

      store.toggleFavorite('/a');
      expect(store.getFavorites()).toEqual([]);
    });

    it('keeps recent and favorites as independent lists', () => {
      store.addRecent('/a');
      store.toggleFavorite('/b');
      expect(store.getRecent()).toEqual(['/a']);
      expect(store.getFavorites()).toEqual(['/b']);
    });
  });

  describe('session-scoped (Browser Bridge mode)', () => {
    it('keeps separate recent lists per session', () => {
      mockGetCurrentSessionKey = jest.fn(() => 'session-1');
      store.addRecent('/session-1-path');

      mockGetCurrentSessionKey = jest.fn(() => 'session-2');
      expect(store.getRecent()).toEqual([]);
      store.addRecent('/session-2-path');

      mockGetCurrentSessionKey = jest.fn(() => 'session-1');
      expect(store.getRecent()).toEqual(['/session-1-path']);
    });

    it('keeps separate favorites per session', () => {
      mockGetCurrentSessionKey = jest.fn(() => 'session-1');
      store.toggleFavorite('/fav-1');

      mockGetCurrentSessionKey = jest.fn(() => 'session-2');
      expect(store.getFavorites()).toEqual([]);
    });
  });
});
