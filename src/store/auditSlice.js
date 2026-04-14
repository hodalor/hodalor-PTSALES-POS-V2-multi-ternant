import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  entries: []
};

const auditSlice = createSlice({
  name: 'audit',
  initialState,
  reducers: {
    setEntries(state, action) {
      const server = Array.isArray(action.payload) ? action.payload : [];
      const offline = state.entries.filter(e => e && e.offline);
      state.entries = server.concat(offline);
    },
    addAudit(state, action) {
      const { actor, actionType, details, remark, branchId, ts, offline } = action.payload || {};
      state.entries.push({
        id: nanoid(),
        ts: ts || new Date().toISOString(),
        actor: actor || 'unknown',
        actionType,
        details: details || null,
        remark: remark || '',
        branchId: branchId || null,
        offline: !!offline
      });
    },
    removeEntry(state, action) {
      const id = String(action.payload || '');
      state.entries = state.entries.filter(entry => String(entry?._id || entry?.id || '') !== id);
    },
    removeEntries(state, action) {
      const ids = new Set((Array.isArray(action.payload) ? action.payload : []).map(String));
      state.entries = state.entries.filter(entry => !ids.has(String(entry?._id || entry?.id || '')));
    },
    clearAudit(state) {
      state.entries = [];
    }
  }
});

export const { setEntries, addAudit, removeEntry, removeEntries, clearAudit } = auditSlice.actions;
export default auditSlice.reducer;
