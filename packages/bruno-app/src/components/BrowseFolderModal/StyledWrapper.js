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
      flex: 1;
    }

    .new-folder-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      color: ${(props) => props.theme.colors.text.yellow};

      &:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
    }
  }

  .browse-error {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--color-danger, #d92c2c);
    font-size: 0.8rem;
    margin-bottom: 0.5rem;

    &.inline-error {
      margin-top: 0.25rem;
      margin-bottom: 0;
    }
  }

  .inline-form-row {
    margin-bottom: 0.5rem;
  }

  .inline-form {
    display: flex;
    align-items: center;
    gap: 0.4rem;

    input[type='text'] {
      flex: 1;
      min-width: 0;
      font-size: 0.85rem;
      padding: 0.2rem 0.4rem;
      border: 1px solid ${(props) => props.theme.modal.input.border};
      background: ${(props) => props.theme.modal.input.bg};
      color: ${(props) => props.theme.text};
      border-radius: 3px;
    }

    .icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: none;
      background: transparent;
      cursor: pointer;

      &.confirm {
        color: var(--color-success, #2ea043);
      }

      &.cancel {
        color: var(--color-danger, #d92c2c);
      }

      &:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
    }
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

      .entry-size {
        flex-shrink: 0;
        font-size: 0.7rem;
        opacity: 0.6;
        margin-left: auto;
      }
    }

    .rename-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border: none;
      background: transparent;
      cursor: pointer;
      opacity: 0;
      color: ${(props) => props.theme.colors.text.muted};
    }

    .renaming-column {
      flex: 1;
      min-width: 0;
    }

    &:hover {
      background: ${(props) => props.theme.table.striped};

      .rename-btn {
        opacity: 1;
      }
    }
  }

  .file-preview {
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid ${(props) => props.theme.modal.input.border};
    font-size: 0.75rem;

    .preview-name {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      color: ${(props) => props.theme.colors.text.yellow};

      span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .preview-meta {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.2rem;
      opacity: 0.65;
    }

    .preview-empty {
      opacity: 0.6;
    }
  }
`;

export default StyledWrapper;
