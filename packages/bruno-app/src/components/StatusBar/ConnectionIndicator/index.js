import React, { useEffect, useState } from 'react';
import ToolHint from 'components/ToolHint';
import { isElectronMode, transport, CONNECTION_STATE } from 'utils/common/ipc-transport';
import StyledWrapper from './StyledWrapper';

const STATE_META = {
  [CONNECTION_STATE.CONNECTING]: { label: 'Connecting…', status: 'info' },
  [CONNECTION_STATE.ONLINE]: { label: 'Online', status: 'success' },
  [CONNECTION_STATE.DEGRADED]: { label: 'Degraded', status: 'warning' },
  [CONNECTION_STATE.OFFLINE]: { label: 'Offline', status: 'danger' }
};

/**
 * Connection & Recovery UX (Improvement.md P1.2) — a small persistent
 * indicator of the Browser Bridge WebSocket connection quality. Only
 * meaningful in Browser Mode (bruno-server), since Electron's IPC has no
 * network hop to degrade — see ElectronTransport.getConnectionState().
 */
const ConnectionIndicator = () => {
  const [connectionState, setConnectionState] = useState(() => transport.getConnectionState());

  useEffect(() => {
    return transport.onConnectionStateChange(setConnectionState);
  }, []);

  if (isElectronMode()) return null;

  const { label, status } = STATE_META[connectionState] || STATE_META[CONNECTION_STATE.OFFLINE];

  return (
    <ToolHint text={`Bridge connection: ${label}`} toolhintId="ConnectionIndicator" place="top" offset={10}>
      <StyledWrapper className="connection-indicator" data-status={status} aria-label={`Bridge connection: ${label}`}>
        <span className="connection-dot" />
        <span className="connection-label">{label}</span>
      </StyledWrapper>
    </ToolHint>
  );
};

export default ConnectionIndicator;
