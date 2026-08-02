let idbStore;

jest.mock('idb', () => {
  return {
    openDB: jest.fn((name, version, { upgrade } = {}) => {
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: jest.fn()
      };
      if (upgrade) upgrade(db);
      return Promise.resolve({
        put: jest.fn((storeName, record) => {
          global.__idbStore.set(record.id, record);
          return Promise.resolve();
        }),
        get: jest.fn((storeName, id) => Promise.resolve(global.__idbStore.get(id) ?? undefined))
      });
    })
  };
});

const buildFullState = () => ({
  workspaces: {
    activeWorkspaceUid: 'ws-1',
    workspaces: [
      {
        uid: 'ws-1',
        name: 'My Workspace',
        pathname: '/home/user/ws',
        collections: [{ uid: 'col-1', path: '/home/user/ws/col-1' }]
      }
    ]
  },
  collections: {
    collections: [
      {
        uid: 'col-1',
        name: 'My Collection',
        pathname: '/home/user/ws/col-1',
        brunoConfig: { secret: 'should-not-be-cached' },
        items: [
          {
            uid: 'item-1',
            name: 'Get Users',
            type: 'http-request',
            pathname: '/home/user/ws/col-1/get-users.bru',
            request: { url: 'https://api.example.com/users', headers: [{ name: 'Authorization', value: 'Bearer secret' }] }
          },
          {
            uid: 'folder-1',
            name: 'Nested',
            type: 'folder',
            pathname: '/home/user/ws/col-1/nested',
            items: [
              {
                uid: 'item-2',
                name: 'Nested Request',
                type: 'http-request',
                pathname: '/home/user/ws/col-1/nested/req.bru',
                request: { url: 'https://api.example.com/nested', body: { mode: 'json', json: '{"secret":true}' } }
              }
            ]
          }
        ]
      }
    ]
  },
  globalEnvironments: {
    globalEnvironments: [{ uid: 'env-1', name: 'Prod', variables: [{ name: 'token', value: 'secret-value' }] }]
  }
});

describe('offline-cache', () => {
  beforeEach(() => {
    jest.resetModules();
    global.__idbStore = new Map();
    global.indexedDB = {};
  });

  afterEach(() => {
    delete global.indexedDB;
    delete global.__idbStore;
  });

  it('buildOfflineSnapshot strips request bodies, scripts, headers, and env variable values', () => {
    const { buildOfflineSnapshot } = require('./offline-cache');
    const snapshot = buildOfflineSnapshot(buildFullState());

    expect(snapshot.workspaces).toEqual([
      { uid: 'ws-1', name: 'My Workspace', pathname: '/home/user/ws', collectionRefs: [{ uid: 'col-1', path: '/home/user/ws/col-1' }] }
    ]);

    expect(snapshot.collections).toEqual([
      {
        uid: 'col-1',
        name: 'My Collection',
        pathname: '/home/user/ws/col-1',
        items: [
          { uid: 'item-1', name: 'Get Users', type: 'http-request', pathname: '/home/user/ws/col-1/get-users.bru', items: undefined },
          {
            uid: 'folder-1',
            name: 'Nested',
            type: 'folder',
            pathname: '/home/user/ws/col-1/nested',
            items: [
              { uid: 'item-2', name: 'Nested Request', type: 'http-request', pathname: '/home/user/ws/col-1/nested/req.bru', items: undefined }
            ]
          }
        ]
      }
    ]);

    expect(snapshot.globalEnvironments).toEqual([{ uid: 'env-1', name: 'Prod' }]);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('Bearer');
  });

  it('saveOfflineSnapshot returns null and writes nothing when there are no workspaces', async () => {
    const { saveOfflineSnapshot, loadOfflineSnapshot } = require('./offline-cache');
    const emptyState = { workspaces: { workspaces: [] }, collections: { collections: [] }, globalEnvironments: { globalEnvironments: [] } };

    const result = await saveOfflineSnapshot(emptyState);
    expect(result).toBeNull();
    expect(await loadOfflineSnapshot()).toBeNull();
  });

  it('round-trips a snapshot through save and load', async () => {
    const { saveOfflineSnapshot, loadOfflineSnapshot } = require('./offline-cache');

    const saved = await saveOfflineSnapshot(buildFullState());
    expect(saved.workspaces).toHaveLength(1);
    expect(saved.savedAt).toBeGreaterThan(0);

    const loaded = await loadOfflineSnapshot();
    expect(loaded).toEqual(saved);
  });

  it('returns null from save/load when indexedDB is unavailable', async () => {
    delete global.indexedDB;
    const { saveOfflineSnapshot, loadOfflineSnapshot } = require('./offline-cache');

    expect(await saveOfflineSnapshot(buildFullState())).toBeNull();
    expect(await loadOfflineSnapshot()).toBeNull();
  });
});
