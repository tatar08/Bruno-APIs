import React, { useCallback, useEffect, useState } from 'react';
import Portal from 'components/Portal';
import Modal from 'components/Modal';
import StyledWrapper from './StyledWrapper';
import { IconFolder, IconArrowUp, IconLoader2, IconAlertTriangle } from '@tabler/icons';
import { transport } from 'utils/common/ipc-transport';

export default function BrowseFolderModal({ title = 'Select Folder', multiple = false, onSubmit, onCancel }) {
  const [currentPath, setCurrentPath] = useState(null);
  const [parentPath, setParentPath] = useState(null);
  const [entries, setEntries] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const navigate = useCallback((path) => {
    setLoading(true);
    setError(null);
    transport
      .invoke('renderer:list-directory', path)
      .then((result) => {
        setCurrentPath(result.path);
        setParentPath(result.parentPath);
        setEntries(result.entries.filter((entry) => entry.isDirectory));
        setSelected(new Set());
      })
      .catch((err) => {
        setError(err?.message || 'Failed to list directory');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    navigate(null);
    // Only run once on mount — subsequent navigation is user-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleConfirm = () => {
    if (multiple) {
      if (selected.size === 0) return;
      onSubmit(Array.from(selected));
    } else {
      if (!currentPath) return;
      onSubmit([currentPath]);
    }
  };

  const confirmDisabled = multiple ? selected.size === 0 : !currentPath || loading;

  return (
    <Portal>
      <Modal
        size="md"
        title={title}
        confirmText={multiple ? `Select${selected.size ? ` (${selected.size})` : ''}` : 'Select This Folder'}
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
          </div>

          {error && (
            <div className="browse-error" data-testid="browse-folder-error">
              <IconAlertTriangle size={14} strokeWidth={1.5} />
              <span>{error}</span>
            </div>
          )}

          <div className="entry-list">
            {loading ? (
              <div className="loading-row">
                <IconLoader2 size={16} strokeWidth={1.5} className="animate-spin" />
                <span>Loading...</span>
              </div>
            ) : entries.length === 0 ? (
              <div className="empty-row">No subfolders</div>
            ) : (
              entries.map((entry) => (
                <div key={entry.path} className="entry-row" data-testid="browse-folder-entry">
                  {multiple && (
                    <input
                      type="checkbox"
                      checked={selected.has(entry.path)}
                      onChange={() => toggleSelected(entry.path)}
                    />
                  )}
                  <div className="entry-name" onClick={() => navigate(entry.path)}>
                    <IconFolder size={16} strokeWidth={1.5} />
                    <span>{entry.name}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </StyledWrapper>
      </Modal>
    </Portal>
  );
}
