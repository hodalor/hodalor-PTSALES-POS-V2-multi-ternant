import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  suppliers: []
};

function normalizeSupplierName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

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
        const incoming = action.payload || {};
        const incomingId = String(incoming.id || incoming._id || '').trim();
        const incomingName = normalizeSupplierName(incoming.name);
        const idx = state.suppliers.findIndex((supplier) => (
          (incomingId && String(supplier.id || supplier._id || '').trim() === incomingId)
          || (incomingName && normalizeSupplierName(supplier.name) === incomingName)
        ));
        if (idx >= 0) {
          state.suppliers[idx] = { ...state.suppliers[idx], ...incoming, id: incomingId || state.suppliers[idx].id };
        } else {
          state.suppliers.push(incoming);
        }
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
