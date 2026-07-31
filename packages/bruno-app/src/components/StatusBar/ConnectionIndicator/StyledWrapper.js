import styled from 'styled-components';

const StyledWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;

  .connection-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${(props) => props.theme.status[props['data-status']]?.text || props.theme.status.info.text};
    flex-shrink: 0;
  }

  &[data-status='connecting'] .connection-dot,
  &[data-status='degraded'] .connection-dot {
    animation: connection-pulse 1.4s ease-in-out infinite;
  }

  .connection-label {
    white-space: nowrap;
    color: ${(props) => props.theme.statusBar.color};
  }

  @keyframes connection-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
`;

export default StyledWrapper;
