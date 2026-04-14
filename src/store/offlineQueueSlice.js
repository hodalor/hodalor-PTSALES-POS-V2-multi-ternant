import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  total: 0,
  byCollection: {}
};

const offlineQueueSlice = createSlice({
  name: 'offlineQueue',
  initialState,
  reducers: {
    setQueueSummary(state, action) {
      const data = action.payload || {};
      state.total = Number(data.total || 0);
      state.byCollection = data.byCollection || {};
    }
  }
});

export const { setQueueSummary } = offlineQueueSlice.actions;
export default offlineQueueSlice.reducer;

