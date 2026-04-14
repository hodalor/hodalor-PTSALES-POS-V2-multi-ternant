import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  suppliers: []
};

const suppliersSlice = createSlice({
  name: 'suppliers',
  initialState,
  reducers: {
    setSuppliers(state, action) {
      const server = Array.isArray(action.payload) ? action.payload : [];
      const seen = new Set(server.map(s => s?.id || s?._id).filter(Boolean).map(String));
      const offline = state.suppliers.filter(s => s && s.offline && !seen.has(String(s.id)));
      state.suppliers = server.concat(offline);
    },
    addSupplier: {
      reducer(state, action) {
        state.suppliers.push(action.payload);
      },
      prepare(data) {
        const id = data?.id != null ? String(data.id) : nanoid();
        return { payload: { id, name: '', contact: '', phone: '', email: '', address: '', notes: '', active: true, ...data } };
      }
    },
    updateSupplier(state, action) {
      const { id, ...patch } = action.payload || {};
      const idx = state.suppliers.findIndex(s => s.id === id);
      if (idx >= 0) {
        state.suppliers[idx] = { ...state.suppliers[idx], ...patch };
      }
    },
    removeSupplier(state, action) {
      const id = action.payload;
      state.suppliers = state.suppliers.filter(s => s.id !== id);
    }
  }
});

export const { setSuppliers, addSupplier, updateSupplier, removeSupplier } = suppliersSlice.actions;
export default suppliersSlice.reducer;
