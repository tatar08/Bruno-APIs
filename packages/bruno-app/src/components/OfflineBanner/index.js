import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { isElectronMode, transport, CONNECTION_STATE } from 'utils/common/ipc-transport';
import StyledWrapper from './StyledWrapper';

/**
 * Improvement.md P1.2 — shown only when the Bridge is offline, live
 * workspaces never loaded, and a cached snapshot exists (see
 * useOfflineCacheSync). Intentionally rendered from offlineCache.snapshot
 * only, never from the live workspaces/collections slices, so this view can
 * never be mistaken for (or accidentally interact with) real data — it's a
 * static read-only list of names, not a live tree.
 */
const OfflineBanner = () => {
  const [connectionState, setConnectionState] = useState(() => transport.getConnectionState());
  const snapshot = useSelector((state) => state.offlineCache.snapshot);

  useEffect(() => {
    return transport.onConnectionStateChange(setConnectionState);
  }, []);

  if (isElectronMode() || !snapshot || connectionState === CONNECTION_STATE.ONLINE) return null;

  const savedAtLabel = new Date(snapshot.savedAt).toLocaleString();
  const collectionsByUid = new Map(snapshot.collections.map((c) => [c.uid, c]));

  return (
    <StyledWrapper data-testid="offline-banner">
      <span className="offline-banner-message">
        Offline — showing cached data from {savedAtLabel}. Read-only until reconnected.
      </span>
      <div className="offline-banner-tree">
        {snapshot.workspaces.flatMap((workspace) =>
          workspace.collectionRefs
            .map((ref) => collectionsByUid.get(ref.uid))
            .filter(Boolean)
            .map((collection) => (
              <span key={collection.uid} className="offline-banner-collection" title={collection.pathname}>
                {collection.name}
              </span>
            ))
        )}
      </div>
    </StyledWrapper>
  );
};

export default OfflineBanner;
