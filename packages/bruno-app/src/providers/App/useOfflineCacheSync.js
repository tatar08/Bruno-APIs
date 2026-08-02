import { useEffect } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { isElectronMode, transport, CONNECTION_STATE } from 'utils/common/ipc-transport';
import { saveOfflineSnapshot, loadOfflineSnapshot } from 'utils/common/offline-cache';
import { setOfflineSnapshot, clearOfflineSnapshot } from 'providers/ReduxStore/slices/offlineCache';

// Give the Bridge a few seconds to push live workspace/collection data before
// falling back to a cached snapshot — avoids flashing "offline" on a normal,
// merely-slow boot.
const HYDRATE_GRACE_MS = 4000;
const WRITE_DEBOUNCE_MS = 2000;

/**
 * Improvement.md P1.2 — offline read-only cache for UI state.
 *
 * Browser Bridge mode only (Electron always has the real collection tree on
 * disk, nothing to cache). Two responsibilities:
 *  - Write: while online with live workspace data loaded, periodically
 *    persist a lightweight (names/structure only, no bodies/scripts/secrets)
 *    snapshot to IndexedDB.
 *  - Read: if the store is still empty after a grace period, load the last
 *    snapshot into the dedicated offlineCache slice — never into the live
 *    workspaces/collections slices, so nothing in the interactive app ever
 *    mistakes cached data for live data. OfflineBanner is the only consumer.
 */
const useOfflineCacheSync = () => {
  const dispatch = useDispatch();
  const store = useStore();

  useEffect(() => {
    if (isElectronMode()) return undefined;

    let cancelled = false;
    let writeTimer = null;

    const hydrateTimer = setTimeout(() => {
      if (cancelled) return;
      const state = store.getState();
      if (state.workspaces?.workspaces?.length > 0) return;

      loadOfflineSnapshot().then((snapshot) => {
        if (cancelled || !snapshot) return;
        // Live data may have arrived while the cache read was in flight.
        const current = store.getState();
        if (current.workspaces?.workspaces?.length > 0) return;
        dispatch(setOfflineSnapshot(snapshot));
      });
    }, HYDRATE_GRACE_MS);

    const scheduleWrite = () => {
      if (writeTimer) clearTimeout(writeTimer);
      writeTimer = setTimeout(() => {
        writeTimer = null;
        const state = store.getState();
        if (transport.getConnectionState() !== CONNECTION_STATE.ONLINE) return;
        if (!state.workspaces?.workspaces?.length) return;
        saveOfflineSnapshot(state);
      }, WRITE_DEBOUNCE_MS);
    };

    const unsubscribeStore = store.subscribe(scheduleWrite);

    const unsubscribeConnection = transport.onConnectionStateChange((state) => {
      if (state === CONNECTION_STATE.ONLINE) {
        dispatch(clearOfflineSnapshot());
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(hydrateTimer);
      if (writeTimer) clearTimeout(writeTimer);
      unsubscribeStore();
      unsubscribeConnection();
    };
  }, []);
};

export default useOfflineCacheSync;
