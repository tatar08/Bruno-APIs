import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from 'styled-components';
import OfflineBanner from './index';
import offlineCacheReducer from 'providers/ReduxStore/slices/offlineCache';
import { CONNECTION_STATE } from 'utils/common/ipc-transport';

const theme = {
  status: {
    warning: { background: '#fff3cd', text: '#856404', border: '#856404' }
  }
};

let mockConnectionState = CONNECTION_STATE.OFFLINE;
let mockIsElectronMode = false;

jest.mock('utils/common/ipc-transport', () => {
  const actual = jest.requireActual('utils/common/ipc-transport');
  return {
    CONNECTION_STATE: actual.CONNECTION_STATE,
    isElectronMode: jest.fn(() => mockIsElectronMode),
    transport: {
      getConnectionState: jest.fn(() => mockConnectionState),
      onConnectionStateChange: jest.fn((handler) => {
        handler(mockConnectionState);
        return () => {};
      })
    }
  };
});

const renderBanner = (snapshot) => {
  const store = configureStore({
    reducer: { offlineCache: offlineCacheReducer },
    preloadedState: { offlineCache: { snapshot } }
  });

  return render(
    <ThemeProvider theme={theme}>
      <Provider store={store}>
        <OfflineBanner />
      </Provider>
    </ThemeProvider>
  );
};

describe('OfflineBanner', () => {
  beforeEach(() => {
    mockConnectionState = CONNECTION_STATE.OFFLINE;
    mockIsElectronMode = false;
  });

  it('renders nothing when there is no cached snapshot', () => {
    const { container } = renderBanner(null);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the connection is online, even with a snapshot', () => {
    mockConnectionState = CONNECTION_STATE.ONLINE;
    const { container } = renderBanner({ savedAt: Date.now(), workspaces: [], collections: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing in Electron mode', () => {
    mockIsElectronMode = true;
    const { container } = renderBanner({ savedAt: Date.now(), workspaces: [], collections: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the cached timestamp and collection names when offline with a snapshot', () => {
    const snapshot = {
      savedAt: new Date('2026-01-01T00:00:00Z').getTime(),
      workspaces: [
        { uid: 'ws-1', name: 'My Workspace', collectionRefs: [{ uid: 'col-1', path: '/x' }] }
      ],
      collections: [{ uid: 'col-1', name: 'My Collection', pathname: '/x' }]
    };

    renderBanner(snapshot);

    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
    expect(screen.getByText(/Offline — showing cached data from/)).toBeInTheDocument();
    expect(screen.getByText('My Collection')).toBeInTheDocument();
  });
});
