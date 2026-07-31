const Store = require('electron-store');
const { runWithSessionKey } = require('@usebruno/requests');
const LastOpenedWorkspaces = require('../../src/store/last-opened-workspaces');
const LastOpenedCollections = require('../../src/store/last-opened-collections');

// Both stores persist to the same underlying 'preferences' electron-store file.
const clearPreferencesStore = () => new Store({ name: 'preferences', defaults: {} }).clear();

describe('LastOpenedWorkspaces — session isolation (Improvement.md P0.4)', () => {
  let lastOpenedWorkspaces;

  beforeEach(() => {
    clearPreferencesStore();
    lastOpenedWorkspaces = new LastOpenedWorkspaces();
  });

  it('behaves as a single flat list when there is no session context (desktop mode)', () => {
    expect(lastOpenedWorkspaces.getAll()).toEqual([]);
    lastOpenedWorkspaces.add('/ws/desktop');
    expect(lastOpenedWorkspaces.getAll()).toEqual(['/ws/desktop']);
  });

  it('keeps each Browser Bridge session\'s list separate', () => {
    runWithSessionKey('session-A', () => lastOpenedWorkspaces.add('/ws/a1'));
    runWithSessionKey('session-B', () => lastOpenedWorkspaces.add('/ws/b1'));

    runWithSessionKey('session-A', () => {
      expect(lastOpenedWorkspaces.getAll()).toEqual(['/ws/a1']);
    });
    runWithSessionKey('session-B', () => {
      expect(lastOpenedWorkspaces.getAll()).toEqual(['/ws/b1']);
    });

    // desktop/no-session flat list untouched by session-scoped writes
    expect(new Store({ name: 'preferences' }).get('workspaces.lastOpenedWorkspaces', [])).toEqual([]);
  });

  it('remove() only affects the calling session\'s own list', () => {
    runWithSessionKey('session-A', () => lastOpenedWorkspaces.add('/ws/shared-path'));
    runWithSessionKey('session-B', () => lastOpenedWorkspaces.add('/ws/shared-path'));

    runWithSessionKey('session-A', () => lastOpenedWorkspaces.remove('/ws/shared-path'));

    runWithSessionKey('session-A', () => {
      expect(lastOpenedWorkspaces.getAll()).toEqual([]);
    });
    runWithSessionKey('session-B', () => {
      expect(lastOpenedWorkspaces.getAll()).toEqual(['/ws/shared-path']);
    });
  });
});

describe('LastOpenedCollections — session isolation (Improvement.md P0.4)', () => {
  let lastOpenedCollections;
  const dirPath = __dirname; // a real directory, since add() checks isDirectory()

  beforeEach(() => {
    clearPreferencesStore();
    lastOpenedCollections = new LastOpenedCollections();
  });

  it('behaves as a single flat list when there is no session context (desktop mode)', () => {
    expect(lastOpenedCollections.getAll()).toEqual([]);
    lastOpenedCollections.add(dirPath);
    expect(lastOpenedCollections.getAll()).toEqual([dirPath]);
  });

  it('keeps each Browser Bridge session\'s list separate', () => {
    runWithSessionKey('session-A', () => lastOpenedCollections.add(dirPath));

    runWithSessionKey('session-A', () => {
      expect(lastOpenedCollections.getAll()).toEqual([dirPath]);
    });
    runWithSessionKey('session-B', () => {
      expect(lastOpenedCollections.getAll()).toEqual([]);
    });

    // desktop/no-session flat list untouched by session-scoped writes
    expect(new Store({ name: 'preferences' }).get('lastOpenedCollections', [])).toEqual([]);
  });

  it('removeAll() only clears the calling session\'s own list', () => {
    runWithSessionKey('session-A', () => lastOpenedCollections.add(dirPath));
    runWithSessionKey('session-B', () => lastOpenedCollections.add(dirPath));

    runWithSessionKey('session-A', () => lastOpenedCollections.removeAll());

    runWithSessionKey('session-A', () => {
      expect(lastOpenedCollections.getAll()).toEqual([]);
    });
    runWithSessionKey('session-B', () => {
      expect(lastOpenedCollections.getAll()).toEqual([dirPath]);
    });
  });
});
