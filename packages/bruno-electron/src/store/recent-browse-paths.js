const Store = require('electron-store');
const { getCurrentSessionKey } = require('@usebruno/requests');

const MAX_RECENT = 10;

// Backs the Browse modal's Recent/Favorites lists (Improvement.md P1.1).
// Uses a top-level 'browsePaths' key (distinct from 'preferences') and the
// same session-scoping pattern as last-opened-workspaces.js, for the same
// reason: PreferencesStore.savePreferences() does a full overwrite of the
// 'preferences' key, so anything else sharing that Store file must live
// under a different top-level key to avoid being wiped out by the Settings UI.
class RecentBrowsePaths {
  constructor() {
    this.store = new Store({
      name: 'preferences',
      defaults: {}
    });
  }

  #getBucket(key) {
    const sessionKey = getCurrentSessionKey();
    if (!sessionKey) {
      return this.store.get(`browsePaths.${key}`, []);
    }
    const bySession = this.store.get(`browsePaths.${key}BySession`, {});
    return bySession[sessionKey] || [];
  }

  #setBucket(key, values) {
    const sessionKey = getCurrentSessionKey();
    if (!sessionKey) {
      this.store.set(`browsePaths.${key}`, values);
      return;
    }
    const bySession = this.store.get(`browsePaths.${key}BySession`, {});
    bySession[sessionKey] = values;
    this.store.set(`browsePaths.${key}BySession`, bySession);
  }

  getRecent() {
    return this.#getBucket('recent');
  }

  addRecent(dirPath) {
    const recent = this.getRecent().filter((p) => p !== dirPath);
    recent.unshift(dirPath);
    const trimmed = recent.slice(0, MAX_RECENT);
    this.#setBucket('recent', trimmed);
    return trimmed;
  }

  getFavorites() {
    return this.#getBucket('favorites');
  }

  toggleFavorite(dirPath) {
    const favorites = this.getFavorites();
    const index = favorites.indexOf(dirPath);
    if (index === -1) {
      favorites.unshift(dirPath);
    } else {
      favorites.splice(index, 1);
    }
    this.#setBucket('favorites', favorites);
    return favorites;
  }
}

module.exports = RecentBrowsePaths;
