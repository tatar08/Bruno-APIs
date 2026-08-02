import BrowseFolderModal from 'components/BrowseFolderModal';
import React, { createContext, useCallback, useState } from 'react';

const BrowseFolderContext = createContext();

const CLOSED_STATE = { open: false, mode: 'folders', options: null, resolve: null, reject: null };

export function BrowseFolderProvider({ children }) {
  const [modalState, setModalState] = useState(CLOSED_STATE);

  const browseFolder = useCallback((options = {}) => {
    return new Promise((resolve, reject) => {
      setModalState({ open: true, mode: 'folders', options, resolve, reject });
    });
  }, []);

  const browseFiles = useCallback((options = {}) => {
    return new Promise((resolve, reject) => {
      setModalState({ open: true, mode: 'files', options, resolve, reject });
    });
  }, []);

  // Expose globally for non-component code (e.g. ipc-transport.js's Browser
  // Bridge folder/file-picking channels, which run outside any React tree).
  if (typeof window !== 'undefined') {
    window.browseFolderOnBridge = async (options) => {
      try {
        return await browseFolder(options);
      } catch (err) {
        if (err !== 'cancelled') console.error('window.browseFolderOnBridge encountered an error:', err);
        throw err;
      }
    };
    window.browseFilesOnBridge = async (options) => {
      try {
        return await browseFiles(options);
      } catch (err) {
        if (err !== 'cancelled') console.error('window.browseFilesOnBridge encountered an error:', err);
        throw err;
      }
    };
  }

  const handleSubmit = (selectedPaths) => {
    modalState.resolve(selectedPaths);
    setModalState(CLOSED_STATE);
  };

  const handleCancel = () => {
    modalState.reject('cancelled');
    setModalState(CLOSED_STATE);
  };

  return (
    <BrowseFolderContext.Provider value={{ browseFolder, browseFiles }}>
      {children}
      {modalState.open && (
        <BrowseFolderModal
          title={modalState.options?.title || (modalState.mode === 'files' ? 'Select File' : 'Select Folder')}
          multiple={Boolean(modalState.options?.multiple)}
          mode={modalState.mode}
          filters={modalState.options?.filters || []}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}
    </BrowseFolderContext.Provider>
  );
}

export default BrowseFolderProvider;
