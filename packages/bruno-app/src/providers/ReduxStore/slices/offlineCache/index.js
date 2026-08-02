import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  // Set only when live workspaces/collections are still empty at boot and a
  // cached snapshot was loaded to fill the gap; cleared once live data
  // arrives. Null means "not showing cached data" — the normal state.
  snapshot: null
};

export const offlineCacheSlice = createSlice({
  name: 'offlineCache',
  initialState,
  reducers: {
    setOfflineSnapshot: (state, action) => {
      state.snapshot = action.payload;
    },
    clearOfflineSnapshot: (state) => {
      state.snapshot = null;
    }
  }
});

export const { setOfflineSnapshot, clearOfflineSnapshot } = offlineCacheSlice.actions;

export default offlineCacheSlice.reducer;
