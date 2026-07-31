const path = require('node:path');
const _ = require('lodash');
const Store = require('electron-store');
const { isDirectory } = require('../utils/filesystem');
const { getCurrentSessionKey } = require('@usebruno/requests');

class LastOpenedCollections {
  constructor() {
    this.store = new Store({
      name: 'preferences',
      clearInvalidConfig: true
    });
    console.log(`Preferences file is located at: ${this.store.path}`);
  }

  // Falls back to the single flat list when there's no session context
  // (desktop/no-auth mode, getCurrentSessionKey() always undefined --
  // unchanged behavior for that case). In Browser Bridge mode, each session
  // gets its own list keyed by session, so one session's landing view isn't
  // populated by -- or overwritten by -- another session's collection
  // history (Improvement.md P0.4).
  getAll() {
    const sessionKey = getCurrentSessionKey();
    let collections;
    if (!sessionKey) {
      collections = this.store.get('lastOpenedCollections') || [];
    } else {
      const bySession = this.store.get('lastOpenedCollectionsBySession', {});
      collections = bySession[sessionKey] || [];
    }
    return collections.map((collection) => path.resolve(collection));
  }

  #setAll(collections) {
    const sessionKey = getCurrentSessionKey();
    if (!sessionKey) {
      this.store.set('lastOpenedCollections', collections);
      return;
    }
    const bySession = this.store.get('lastOpenedCollectionsBySession', {});
    bySession[sessionKey] = collections;
    this.store.set('lastOpenedCollectionsBySession', bySession);
  }

  add(collectionPath) {
    const collections = this.getAll();

    if (isDirectory(collectionPath) && !collections.includes(collectionPath)) {
      collections.push(collectionPath);
      this.#setAll(collections);
    }
  }

  update(collectionPaths) {
    this.#setAll(collectionPaths);
  }

  remove(collectionPath) {
    let collections = this.getAll();

    if (collections.includes(collectionPath)) {
      collections = _.filter(collections, (c) => c !== collectionPath);
      this.#setAll(collections);
    }
  }

  removeAll() {
    this.#setAll([]);
  }
}

module.exports = LastOpenedCollections;
