import styled from 'styled-components';

const StyledWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 16px;
  font-size: 12px;
  background: ${(props) => props.theme.status.warning.background};
  color: ${(props) => props.theme.status.warning.text};
  border-bottom: 1px solid ${(props) => props.theme.status.warning.border};

  .offline-banner-message {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .offline-banner-tree {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    opacity: 0.85;
  }

  .offline-banner-collection {
    white-space: nowrap;
  }
`;

export default StyledWrapper;
