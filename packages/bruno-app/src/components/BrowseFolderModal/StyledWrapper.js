import styled from 'styled-components';

const StyledWrapper = styled.div`
  .current-path {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid ${(props) => props.theme.modal.input.border};

    .up-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: transparent;
      cursor: pointer;
      color: ${(props) => props.theme.colors.text.yellow};

      &:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
    }

    .path-text {
      font-family: monospace;
      font-size: 0.8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .browse-error {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--color-danger, #d92c2c);
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
  }

  .entry-list {
    max-height: 40vh;
    min-height: 10rem;
    overflow-y: auto;
  }

  .loading-row,
  .empty-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.25rem;
    opacity: 0.7;
    font-size: 0.85rem;
  }

  .entry-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.25rem;
    border-radius: 3px;

    .entry-name {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      cursor: pointer;
      flex: 1;
      min-width: 0;

      span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    &:hover {
      background: ${(props) => props.theme.table.striped};
    }
  }
`;

export default StyledWrapper;
