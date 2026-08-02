import React, { useCallback, useEffect, useRef, useState } from 'react';
import Portal from 'components/Portal';
import Modal from 'components/Modal';
import StyledWrapper from './StyledWrapper';
import {
  IconFolder,
  IconFile,
  IconArrowUp,
  IconLoader2,
  IconAlertTriangle,
  IconFolderPlus,
  IconPencil,
  IconCheck,
  IconX
} from '@tabler/icons';
import { transport } from 'utils/common/ipc-transport';

const formatBytes = (bytes) => {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return null;
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 ? value : value.toFixed(1)} ${units[exponent]}`;
};

// Matches an entry's extension against Electron dialog-style `filters`
// (`[{ name, extensions: ['png', 'jpg'] }]`) so the same filter shape works
// for both the Electron file dialog and this Browser Bridge file picker.
const matchesFilters = (entry, filters) => {
  if (!filters || filters.length === 0) return true;
  const ext = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
  return filters.some((filter) => (filter.extensions || []).some((e) => e === '*' || e.toLowerCase() === ext));
};

export default function BrowseFolderModal({
  title = 'Select Folder',
  multiple = false,
  mode = 'folders',
  filters = [],
  onSubmit,
  onCancel
}) {
  const isFileMode = mode === 'files';
  const [currentPath, setCurrentPath] = useState(null);
  const [parentPath, setParentPath] = useState(null);
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Inline create-folder / rename state (Improvement.md P1.1). Kept
  // separate from `error` (which reflects the last directory-listing
  // failure) so a failed create/rename shows next to the input that
  // caused it instead of replacing the browse-error banner.
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createError, setCreateError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [renamingPath, setRenamingPath] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [previewEntry, setPreviewEntry] = useState(null);
  const newFolderInputRef = useRef(null);
  const renameInputRef = useRef(null);

  const navigate = useCallback(
    (path) => {
      setLoading(true);
      setError(null);
      transport
        .invoke('renderer:list-directory', path)
        .then((result) => {
          setCurrentPath(result.path);
          setParentPath(result.parentPath);
          // Directories are always shown (for navigation); files only show
          // in file-picker mode, filtered by the caller's `filters`.
          setEntries(
            result.entries.filter((entry) => entry.isDirectory || (isFileMode && matchesFilters(entry, filters)))
          );
          setSelected(new Set());
          setPreviewEntry(null);
        })
        .catch((err) => {
          setError(err?.message || 'Failed to list directory');
        })
        .finally(() => setLoading(false));
    },
    [isFileMode, filters]
  );

  useEffect(() => {
    navigate(null);
    // Only run once on mount — subsequent navigation is user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (creatingFolder) newFolderInputRef.current?.focus();
  }, [creatingFolder]);

  useEffect(() => {
    if (renamingPath) renameInputRef.current?.focus();
  }, [renamingPath]);

  const toggleSelected = (path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectFile = (entry) => {
    setPreviewEntry(entry);
    setSelected((prev) => {
      if (multiple) {
        const next = new Set(prev);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
        }
        return next;
      }
      return prev.has(entry.path) ? new Set() : new Set([entry.path]);
    });
  };

  const startCreatingFolder = () => {
    setCreateError(null);
    setNewFolderName('');
    setCreatingFolder(true);
  };

  const cancelCreatingFolder = () => {
    setCreatingFolder(false);
    setCreateError(null);
    setNewFolderName('');
  };

  const confirmCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !currentPath) return;
    setCreating(true);
    setCreateError(null);
    try {
      await transport.invoke('renderer:create-directory', currentPath, name);
      setCreatingFolder(false);
      setNewFolderName('');
      navigate(currentPath);
    } catch (err) {
      setCreateError(err?.message || 'Failed to create folder');
    } finally {
      setCreating(false);
    }
  };

  const startRenaming = (entry) => {
    setRenameError(null);
    setRenameValue(entry.name);
    setRenamingPath(entry.path);
  };

  const cancelRenaming = () => {
    setRenamingPath(null);
    setRenameError(null);
    setRenameValue('');
  };

  const confirmRenaming = async (entry) => {
    const name = renameValue.trim();
    if (!name || name === entry.name) {
      cancelRenaming();
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      await transport.invoke('renderer:rename-directory', entry.path, name);
      setRenamingPath(null);
      setRenameValue('');
      navigate(currentPath);
    } catch (err) {
      setRenameError(err?.message || 'Failed to rename folder');
    } finally {
      setRenaming(false);
    }
  };

  const handleConfirm = () => {
    if (isFileMode) {
      if (selected.size === 0) return;
      onSubmit(Array.from(selected));
    } else if (multiple) {
      if (selected.size === 0) return;
      onSubmit(Array.from(selected));
    } else {
      if (!currentPath) return;
      onSubmit([currentPath]);
    }
  };

  const confirmDisabled = isFileMode || multiple ? selected.size === 0 : !currentPath || loading;

  return (
    <Portal>
      <Modal
        size="md"
        title={title}
        confirmText={
          isFileMode || multiple
            ? `Select${selected.size ? ` (${selected.size})` : ''}`
            : 'Select This Folder'
        }
        cancelText="Cancel"
        confirmDisabled={confirmDisabled}
        handleConfirm={handleConfirm}
        handleCancel={onCancel}
      >
        <StyledWrapper data-testid="browse-folder-modal-content">
          <div className="current-path">
            <button
              type="button"
              className="up-btn"
              onClick={() => parentPath && navigate(parentPath)}
              disabled={!parentPath || loading}
              aria-label="Go up one directory"
              data-testid="browse-folder-up-btn"
            >
              <IconArrowUp size={16} strokeWidth={1.5} />
            </button>
            <span className="path-text" title={currentPath || ''}>
              {currentPath || '...'}
            </span>
            <button
              type="button"
              className="new-folder-btn"
              onClick={startCreatingFolder}
              disabled={!currentPath || loading || creatingFolder}
              aria-label="Create new folder"
              title="New folder"
              data-testid="browse-folder-new-folder-btn"
            >
              <IconFolderPlus size={16} strokeWidth={1.5} />
            </button>
          </div>

          {error && (
            <div className="browse-error" data-testid="browse-folder-error">
              <IconAlertTriangle size={14} strokeWidth={1.5} />
              <span>{error}</span>
            </div>
          )}

          {creatingFolder && (
            <div className="inline-form-row">
              <div className="inline-form">
                <IconFolder size={16} strokeWidth={1.5} />
                <input
                  ref={newFolderInputRef}
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmCreateFolder();
                    if (e.key === 'Escape') cancelCreatingFolder();
                  }}
                  placeholder="Folder name"
                  disabled={creating}
                  data-testid="browse-folder-new-folder-input"
                />
                <button
                  type="button"
                  className="icon-btn confirm"
                  onClick={confirmCreateFolder}
                  disabled={creating || !newFolderName.trim()}
                  aria-label="Confirm new folder"
                  data-testid="browse-folder-new-folder-confirm"
                >
                  <IconCheck size={16} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  className="icon-btn cancel"
                  onClick={cancelCreatingFolder}
                  disabled={creating}
                  aria-label="Cancel new folder"
                  data-testid="browse-folder-new-folder-cancel"
                >
                  <IconX size={16} strokeWidth={1.5} />
                </button>
              </div>
              {createError && (
                <div className="browse-error" data-testid="browse-folder-new-folder-error">
                  <IconAlertTriangle size={14} strokeWidth={1.5} />
                  <span>{createError}</span>
                </div>
              )}
            </div>
          )}

          <div className="entry-list">
            {loading ? (
              <div className="loading-row">
                <IconLoader2 size={16} strokeWidth={1.5} className="animate-spin" />
                <span>Loading...</span>
              </div>
            ) : entries.length === 0 ? (
              <div className="empty-row">{isFileMode ? 'No matching files or subfolders' : 'No subfolders'}</div>
            ) : (
              entries.map((entry) => {
                const isRenaming = renamingPath === entry.path;
                return (
                  <div key={entry.path} className="entry-row" data-testid="browse-folder-entry">
                    {entry.isDirectory && multiple && !isRenaming && (
                      <input
                        type="checkbox"
                        checked={selected.has(entry.path)}
                        onChange={() => toggleSelected(entry.path)}
                      />
                    )}
                    {!entry.isDirectory && (
                      <input
                        type={multiple ? 'checkbox' : 'radio'}
                        checked={selected.has(entry.path)}
                        onChange={() => selectFile(entry)}
                        aria-label={`Select ${entry.name}`}
                        data-testid="browse-file-checkbox"
                      />
                    )}
                    {!entry.isDirectory ? (
                      <div className="entry-name" onClick={() => selectFile(entry)} data-testid="browse-file-entry">
                        <IconFile size={16} strokeWidth={1.5} />
                        <span>{entry.name}</span>
                        {formatBytes(entry.size) && <span className="entry-size">{formatBytes(entry.size)}</span>}
                      </div>
                    ) : isRenaming ? (
                      <div className="renaming-column">
                        <div className="inline-form">
                          <IconFolder size={16} strokeWidth={1.5} />
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmRenaming(entry);
                              if (e.key === 'Escape') cancelRenaming();
                            }}
                            disabled={renaming}
                            data-testid="browse-folder-rename-input"
                          />
                          <button
                            type="button"
                            className="icon-btn confirm"
                            onClick={() => confirmRenaming(entry)}
                            disabled={renaming || !renameValue.trim()}
                            aria-label="Confirm rename"
                            data-testid="browse-folder-rename-confirm"
                          >
                            <IconCheck size={16} strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn cancel"
                            onClick={cancelRenaming}
                            disabled={renaming}
                            aria-label="Cancel rename"
                            data-testid="browse-folder-rename-cancel"
                          >
                            <IconX size={16} strokeWidth={1.5} />
                          </button>
                        </div>
                        {renameError && (
                          <div className="browse-error inline-error" data-testid="browse-folder-rename-error">
                            <IconAlertTriangle size={14} strokeWidth={1.5} />
                            <span>{renameError}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="entry-name" onClick={() => navigate(entry.path)}>
                          <IconFolder size={16} strokeWidth={1.5} />
                          <span>{entry.name}</span>
                        </div>
                        <button
                          type="button"
                          className="rename-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRenaming(entry);
                          }}
                          aria-label={`Rename ${entry.name}`}
                          title="Rename"
                          data-testid="browse-folder-rename-btn"
                        >
                          <IconPencil size={14} strokeWidth={1.5} />
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {isFileMode && (
            <div className="file-preview" data-testid="browse-file-preview">
              {previewEntry ? (
                <>
                  <div className="preview-name">
                    <IconFile size={14} strokeWidth={1.5} />
                    <span title={previewEntry.path}>{previewEntry.name}</span>
                  </div>
                  <div className="preview-meta">
                    {formatBytes(previewEntry.size) && <span>{formatBytes(previewEntry.size)}</span>}
                    {previewEntry.mtimeMs && <span>{new Date(previewEntry.mtimeMs).toLocaleString()}</span>}
                  </div>
                </>
              ) : (
                <span className="preview-empty">
                  {selected.size ? `${selected.size} file(s) selected` : 'No file selected'}
                </span>
              )}
            </div>
          )}
        </StyledWrapper>
      </Modal>
    </Portal>
  );
}
