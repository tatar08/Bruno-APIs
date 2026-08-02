import React from 'react';
import { render, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import useOfflineCacheSync from './useOfflineCacheSync';
import offlineCacheReducer from 'providers/ReduxStore/slices/offlineCache';
import workspacesReducer, { createWorkspace } from 'providers/ReduxStore/slices/workspaces';
import { saveOfflineSnapshot, loadOfflineSnapshot } from 'utils/common/offline-cache';
import { CONNECTION_STATE } from 'utils/common/ipc-transport';

jest.mock('utils/common/offline-cache', () => ({
  saveOfflineSnapshot: jest.fn(() => Promise.resolve({})),
  loadOfflineSnapshot: jest.fn(() => Promise.resolve(null))
}));

let mockConnectionState = CONNECTION_STATE.OFFLINE;
let mockConnectionHandlers = [];

jest.mock('utils/common/ipc-transport', () => {
  const actual = jest.requireActual('utils/common/ipc-transport');
  return {
    CONNECTION_STATE: actual.CONNECTION_STATE,
    isElectronMode: jest.fn(() => false),
    transport: {
      getConnectionState: jest.fn(() => mockConnectionState),
      onConnectionStateChange: jest.fn((handler) => {
        mockConnectionHandlers.push(handler);
        handler(mockConnectionState);
        return () => {
          mockConnectionHandlers = mockConnectionHandlers.filter((h) => h !== handler);
        };
      })
    }
  };
});

const TestComponent = () => {
  useOfflineCacheSync();
  return null;
};

const buildStore = (preloadedState) =>
  configureStore({
    reducer: { offlineCache: offlineCacheReducer, workspaces: workspacesReducer },
    preloadedState
  });

describe('useOfflineCacheSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockConnectionState = CONNECTION_STATE.OFFLINE;
    mockConnectionHandlers = [];
    saveOfflineSnapshot.mockClear();
    loadOfflineSnapshot.mockClear();
    loadOfflineSnapshot.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('hydrates the offlineCache slice from a cached snapshot when workspaces are still empty after the grace period', async () => {
    const snapshot = { savedAt: 1, workspaces: [], collections: [] };
    loadOfflineSnapshot.mockResolvedValue(snapshot);
    const store = buildStore({ workspaces: { workspaces: [], activeWorkspaceUid: 'default' } });

    render(
      <Provider store={store}>
        <TestComponent />
      </Provider>
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });

    expect(loadOfflineSnapshot).toHaveBeenCalled();
    expect(store.getState().offlineCache.snapshot).toEqual(snapshot);
  });

  it('does not hydrate if live workspaces already arrived before the grace period elapses', async () => {
    loadOfflineSnapshot.mockResolvedValue({ savedAt: 1, workspaces: [], collections: [] });
    const store = buildStore({ workspaces: { workspaces: [{ uid: 'ws-1' }], activeWorkspaceUid: 'ws-1' } });

    render(
      <Provider store={store}>
        <TestComponent />
      </Provider>
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });

    expect(loadOfflineSnapshot).not.toHaveBeenCalled();
    expect(store.getState().offlineCache.snapshot).toBeNull();
  });

  it('writes a snapshot after the debounce window when online with live workspace data', async () => {
    mockConnectionState = CONNECTION_STATE.ONLINE;
    const store = buildStore({ workspaces: { workspaces: [{ uid: 'ws-1' }], activeWorkspaceUid: 'ws-1' } });

    render(
      <Provider store={store}>
        <TestComponent />
      </Provider>
    );

    act(() => {
      store.dispatch(createWorkspace({ uid: 'ws-2', name: 'Two' }));
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(saveOfflineSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not write while offline', async () => {
    mockConnectionState = CONNECTION_STATE.OFFLINE;
    const store = buildStore({ workspaces: { workspaces: [{ uid: 'ws-1' }], activeWorkspaceUid: 'ws-1' } });

    render(
      <Provider store={store}>
        <TestComponent />
      </Provider>
    );

    act(() => {
      store.dispatch(createWorkspace({ uid: 'ws-2', name: 'Two' }));
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(saveOfflineSnapshot).not.toHaveBeenCalled();
  });

  it('clears the offlineCache snapshot once the connection becomes online', () => {
    const store = buildStore({
      workspaces: { workspaces: [], activeWorkspaceUid: 'default' },
      offlineCache: { snapshot: { savedAt: 1, workspaces: [], collections: [] } }
    });

    render(
      <Provider store={store}>
        <TestComponent />
      </Provider>
    );

    act(() => {
      mockConnectionState = CONNECTION_STATE.ONLINE;
      mockConnectionHandlers.forEach((h) => h(CONNECTION_STATE.ONLINE));
    });

    expect(store.getState().offlineCache.snapshot).toBeNull();
  });
});
