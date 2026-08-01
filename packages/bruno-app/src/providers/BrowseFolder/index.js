import BrowseFolderModal from 'components/BrowseFolderModal';
import React, { createContext, useCallback, useState } from 'react';

const BrowseFolderContext = createContext();

export function BrowseFolderProvider({ children }) {
  const [modalState, setModalState] = useState({ open: false, options: null, resolve: null, reject: null });

  const browseFolder = useCallback((options = {}) => {
    return new Promise((resolve, reject) => {
      setModalState({ open: true, options, resolve, reject });
    });
  }, []);

  // Expose globally for non-component code (e.g. ipc-transport.js's Browser
  // Bridge folder-picking channels, which run outside any React tree).
  if (typeof window !== 'undefined') {
    window.browseFolderOnBridge = async (options) => {
      try {
        return await browseFolder(options);
      } catch (err) {
        if (err !== 'cancelled') console.error('window.browseFolderOnBridge encountered an error:', err);
        throw err;
      }
    };
  }

  const handleSubmit = (selectedPaths) => {
    modalState.resolve(selectedPaths);
    setModalState({ open: false, options: null, resolve: null, reject: null });
  };

  const handleCancel = () => {
    modalState.reject('cancelled');
    setModalState({ open: false, options: null, resolve: null, reject: null });
  };

  return (
    <BrowseFolderContext.Provider value={{ browseFolder }}>
      {children}
      {modalState.open && (
        <BrowseFolderModal
          title={modalState.options?.title || 'Select Folder'}
          multiple={Boolean(modalState.options?.multiple)}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      )}
    </BrowseFolderContext.Provider>
  );
}

export default BrowseFolderProvider;
