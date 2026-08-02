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

    .new-folder-btn,
    .favorite-btn,
    .quick-access-btn {
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

    .quick-access {
      position: relative;
      display: flex;
      flex-shrink: 0;
    }
  }

  .quick-access-panel {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 10;
    width: 18rem;
    max-height: 16rem;
    overflow-y: auto;
    padding: 0.4rem;
    border: 1px solid ${(props) => props.theme.modal.input.border};
    background: ${(props) => props.theme.modal.input.bg};
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);

    .quick-access-section + .quick-access-section {
      margin-top: 0.5rem;
    }

    .quick-access-heading {
      font-size: 0.7rem;
      text-transform: uppercase;
      opacity: 0.6;
      padding: 0.15rem 0.3rem;
    }

    .quick-access-empty {
      font-size: 0.8rem;
      opacity: 0.6;
      padding: 0.2rem 0.3rem;
    }

    .quick-access-item {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      width: 100%;
      border: none;
      background: transparent;
      text-align: left;
      cursor: pointer;
      padding: 0.25rem 0.3rem;
      font-size: 0.8rem;
      font-family: monospace;
      border-radius: 3px;
      color: ${(props) => props.theme.text};

      span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &:hover {
        background: ${(props) => props.theme.table.striped};
      }
    }
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
    opacity: 0.85;

    input[type='text'] {
      flex: 1;
      min-width: 0;
      font-size: 0.8rem;
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
