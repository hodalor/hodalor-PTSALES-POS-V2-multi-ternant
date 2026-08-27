import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  invoices: []
};

const invoicesSlice = createSlice({
  name: 'invoices',
  initialState,
  reducers: {
    addInvoice: {
      reducer(state, action) {
        state.invoices.unshift(action.payload);
      },
      prepare(payload) {
        return { payload: { id: nanoid(), created_at: new Date().toISOString(), ...payload } };
      }
    },
    setInvoices(state, action) {
      const rows = Array.isArray(action.payload) ? action.payload : [];
      if (rows.length === 0) {
        state.invoices = [];
        return;
      }
      const merged = new Map();
      for (const it of state.invoices) {
        const key = it.clientId || it.number || it.id;
        merged.set(key, it);
      }
      for (const x of rows) {
        const id = x.id || x._id || nanoid();
        const created_at = x.created_at || x.createdAt || x.date || new Date().toISOString();
        const obj = { id, created_at, ...x };
        const key = obj.clientId || obj.number || obj.id;
        merged.set(key, obj);
      }
      state.invoices = Array.from(merged.values()).sort((a, b) => {
        const ta = new Date(a.created_at || a.date || 0).getTime();
        const tb = new Date(b.created_at || b.date || 0).getTime();
        return tb - ta;
      });
    },
    removeInvoices(state, action) {
      const ids = new Set((Array.isArray(action.payload) ? action.payload : []).map(String));
      state.invoices = state.invoices.filter((invoice) => !ids.has(String(invoice?.id || invoice?.saleId || invoice?.clientId || invoice?.number || '')));
    }
  }
});

export const { addInvoice, setInvoices, removeInvoices } = invoicesSlice.actions;
export default invoicesSlice.reducer;
