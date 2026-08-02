import React, { useCallback, useEffect, useRef, useState } from 'react';
import Portal from 'components/Portal';
import Modal from 'components/Modal';
import ToolHint from 'components/ToolHint';
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
  IconX,
  IconStar,
  IconClock,
  IconSearch
} from '@tabler/icons';
import { transport, isElectronMode } from 'utils/common/ipc-transport';

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

  // Recent/favorites (Improvement.md P1.1) — fetched once on mount and kept
  // in sync locally from each IPC call's return value (the new list),
  // rather than re-fetching, since the backend is the sole writer and
  // always echoes the resulting list back.
  const [recentPaths, setRecentPaths] = useState([]);
  const [favoritePaths, setFavoritePaths] = useState([]);
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const newFolderInputRef = useRef(null);
  const renameInputRef = useRef(null);

  const navigate = useCallback(
    (path) => {
      setLoading(true);
      setError(null);
      setSearchQuery('');
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
          transport
            .invoke('renderer:add-recent-browse-path', result.path)
            // A malformed/undefined response (or an in-flight get-browse-paths
            // fetch resolving after this) must not clobber already-known
            // good state, so only apply a well-formed array response.
            .then((recent) => {
              if (Array.isArray(recent)) setRecentPaths(recent);
            })
            .catch(() => {});
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
    transport
      .invoke('renderer:get-browse-paths')
      .then((result) => {
        setRecentPaths(result?.recent || []);
        setFavoritePaths(result?.favorites || []);
      })
      .catch(() => {});
    // Only run once on mount — subsequent navigation is user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCurrentPathFavorited = Boolean(currentPath) && favoritePaths.includes(currentPath);

  const toggleCurrentPathFavorite = () => {
    if (!currentPath) return;
    transport
      .invoke('renderer:toggle-favorite-browse-path', currentPath)
      .then((favorites) => {
        if (Array.isArray(favorites)) setFavoritePaths(favorites);
      })
      .catch(() => {});
  };

  const visibleEntries = searchQuery.trim()
    ? entries.filter((entry) => entry.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : entries;

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
            {/* Browser Bridge mode always browses the Bridge server's own
                filesystem, never the browser's local machine — this modal has
                no way to reach the latter — so the label disambiguates which
                machine `currentPath` actually lives on (Improvement.md P1.1). */}
            {!isElectronMode() && (
              <ToolHint
                text="This path is on the Bridge server's machine, not this browser's computer."
                toolhintId="browse-folder-machine-label"
                place="top"
              >
                <span className="machine-badge" data-testid="browse-folder-machine-label">
                  Bridge server
                </span>
              </ToolHint>
            )}
            <span className="path-text" title={currentPath || ''}>
              {currentPath || '...'}
            </span>
            <button
              type="button"
              className="favorite-btn"
              onClick={toggleCurrentPathFavorite}
              disabled={!currentPath || loading}
              aria-label={isCurrentPathFavorited ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={isCurrentPathFavorited}
              title={isCurrentPathFavorited ? 'Remove from favorites' : 'Add to favorites'}
              data-testid="browse-folder-favorite-btn"
            >
              <IconStar size={16} strokeWidth={1.5} fill={isCurrentPathFavorited ? 'currentColor' : 'none'} />
            </button>
            <div className="quick-access">
              <button
                type="button"
                className="quick-access-btn"
                onClick={() => setQuickAccessOpen((prev) => !prev)}
                aria-label="Recent and favorite folders"
                title="Recent & favorites"
                data-testid="browse-folder-quick-access-btn"
              >
                <IconClock size={16} strokeWidth={1.5} />
              </button>
              {quickAccessOpen && (
                <div className="quick-access-panel" data-testid="browse-folder-quick-access-panel">
                  <div className="quick-access-section">
                    <div className="quick-access-heading">Favorites</div>
                    {favoritePaths.length === 0 ? (
                      <div className="quick-access-empty">No favorites yet</div>
                    ) : (
                      favoritePaths.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className="quick-access-item"
                          onClick={() => {
                            navigate(p);
                            setQuickAccessOpen(false);
                          }}
                          title={p}
                          data-testid="browse-folder-favorite-item"
                        >
                          <IconStar size={12} strokeWidth={1.5} fill="currentColor" />
                          <span>{p}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="quick-access-section">
                    <div className="quick-access-heading">Recent</div>
                    {recentPaths.length === 0 ? (
                      <div className="quick-access-empty">No recent folders</div>
                    ) : (
                      recentPaths.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className="quick-access-item"
                          onClick={() => {
                            navigate(p);
                            setQuickAccessOpen(false);
                          }}
                          title={p}
                          data-testid="browse-folder-recent-item"
                        >
                          <IconClock size={12} strokeWidth={1.5} />
                          <span>{p}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
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

          <div className="search-row">
            <IconSearch size={14} strokeWidth={1.5} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search this folder"
              data-testid="browse-folder-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                data-testid="browse-folder-search-clear"
              >
                <IconX size={14} strokeWidth={1.5} />
              </button>
            )}
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
            ) : visibleEntries.length === 0 ? (
              <div className="empty-row">
                {searchQuery.trim()
                  ? 'No matching results'
                  : isFileMode
                    ? 'No matching files or subfolders'
                    : 'No subfolders'}
              </div>
            ) : (
              visibleEntries.map((entry) => {
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
