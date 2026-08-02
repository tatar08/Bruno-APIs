import { openDB } from 'idb';

const DB_NAME = 'bruno-offline-cache';
const STORE = 'snapshot';
const DB_VERSION = 1;
const RECORD_ID = 'latest';

let dbPromise = null;

const getDb = () => {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      }
    }).catch((err) => {
      console.warn('[OfflineCache] Failed to open cache DB:', err);
      dbPromise = null;
      return null;
    });
  }
  return dbPromise;
};

/**
 * Recursively strips a collection item tree down to the fields needed to
 * render a read-only navigation view: names and structure only. Never
 * includes request/response bodies, scripts, auth, or headers — those can
 * go stale (or contain secrets) and would be misleading to show as "current"
 * while offline.
 */
const stripItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    uid: item.uid,
    name: item.name,
    type: item.type,
    pathname: item.pathname,
    items: item.items ? stripItems(item.items) : undefined
  }));
};

const stripCollection = (collection) => ({
  uid: collection.uid,
  name: collection.name,
  pathname: collection.pathname,
  items: stripItems(collection.items)
});

/**
 * Builds the lightweight, read-only snapshot persisted for offline viewing.
 * Deliberately excludes request/response bodies, scripts, drafts, and
 * response history (size, and staleness/secrecy risk of showing them as
 * "current"). Global environment variables are excluded for the same reason
 * — only names are kept.
 */
export const buildOfflineSnapshot = (state) => {
  const workspaces = state.workspaces?.workspaces || [];
  const collections = state.collections?.collections || [];
  const globalEnvironments = state.globalEnvironments?.globalEnvironments || [];

  return {
    id: RECORD_ID,
    savedAt: Date.now(),
    activeWorkspaceUid: state.workspaces?.activeWorkspaceUid,
    workspaces: workspaces.map((w) => ({
      uid: w.uid,
      name: w.name,
      pathname: w.pathname,
      collectionRefs: (w.collections || []).map((c) => ({ uid: c.uid, path: c.path }))
    })),
    collections: collections.map(stripCollection),
    globalEnvironments: globalEnvironments.map((e) => ({ uid: e.uid, name: e.name }))
  };
};

export const saveOfflineSnapshot = async (state) => {
  const db = await getDb();
  if (!db) return null;

  const snapshot = buildOfflineSnapshot(state);
  if (!snapshot.workspaces.length) return null;

  try {
    await db.put(STORE, snapshot);
    return snapshot;
  } catch (err) {
    console.warn('[OfflineCache] Failed to save snapshot:', err);
    return null;
  }
};

export const loadOfflineSnapshot = async () => {
  const db = await getDb();
  if (!db) return null;

  try {
    return (await db.get(STORE, RECORD_ID)) || null;
  } catch (err) {
    console.warn('[OfflineCache] Failed to load snapshot:', err);
    return null;
  }
};
