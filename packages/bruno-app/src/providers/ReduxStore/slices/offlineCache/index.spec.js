import reducer, { setOfflineSnapshot, clearOfflineSnapshot } from './index';

describe('offlineCache slice', () => {
  it('starts with no snapshot', () => {
    expect(reducer(undefined, { type: '@@INIT' })).toEqual({ snapshot: null });
  });

  it('setOfflineSnapshot stores the payload', () => {
    const snapshot = { savedAt: 123, workspaces: [] };
    const state = reducer(undefined, setOfflineSnapshot(snapshot));
    expect(state.snapshot).toEqual(snapshot);
  });

  it('clearOfflineSnapshot resets to null', () => {
    const withSnapshot = { snapshot: { savedAt: 123, workspaces: [] } };
    const state = reducer(withSnapshot, clearOfflineSnapshot());
    expect(state.snapshot).toBeNull();
  });
});
