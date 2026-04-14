import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  branches: []
};

const branchesSlice = createSlice({
  name: 'branches',
  initialState,
  reducers: {
    setBranches(state, action) {
      const server = Array.isArray(action.payload) && action.payload.length > 0 ? action.payload : null;
      if (!server) return;
      const normalized = server.map(b => ({ ...b, id: String(b?.id || b?._id || ''), branchType: b?.branchType || 'retail' }));
      const seen = new Set(normalized.map(b => b?.id).filter(Boolean).map(String));
      const offline = state.branches.filter(b => b && b.offline && !seen.has(String(b.id)));
      state.branches = normalized.concat(offline);
    },
    addBranch: {
      reducer(state, action) {
        state.branches.push(action.payload);
      },
      prepare(data) {
        const id = data?.id != null ? String(data.id) : nanoid();
        const payload = { id, name: '', code: '', branchType: 'retail', ...data };
        return { payload };
      }
    },
    updateBranch(state, action) {
      const { id, name, code, branchType, offline } = action.payload;
      const b = state.branches.find(x => x.id === id);
      if (b) {
        b.name = name;
        b.code = code;
        if (branchType) b.branchType = branchType;
        if (typeof offline === 'boolean') b.offline = offline;
      }
    },
    removeBranch(state, action) {
      state.branches = state.branches.filter(b => b.id !== action.payload);
    }
  }
});

export const { setBranches, addBranch, updateBranch, removeBranch } = branchesSlice.actions;
export default branchesSlice.reducer;
