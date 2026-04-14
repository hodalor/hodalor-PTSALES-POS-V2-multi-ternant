import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  customers: []
};

const customersSlice = createSlice({
  name: 'customers',
  initialState,
  reducers: {
    setCustomers(state, action) {
      const list = Array.isArray(action.payload) ? action.payload : [];
      const server = list.map(c => {
        const id = c?.id || c?._id || nanoid();
        return { ...c, id: String(id) };
      });
      const serverIds = new Set(server.map(c => c.id).filter(Boolean));
      const serverClientIds = new Set(server.map(c => c?.clientId).filter(Boolean).map(String));
      const offline = state.customers.filter(c => c && c.offline && !serverIds.has(String(c.id)) && (!c.clientId || !serverClientIds.has(String(c.clientId))));
      state.customers = server.concat(offline);
    },
    addCustomer(state, action) {
      const c = action.payload || {};
      const id = c?.id || c?._id || nanoid();
      state.customers.unshift({ ...c, id: String(id) });
    },
    updateCustomer(state, action) {
      const { id, ...patch } = action.payload || {};
      const idx = state.customers.findIndex(c => c.id === id);
      if (idx >= 0) {
        state.customers[idx] = { ...state.customers[idx], ...patch };
      }
    },
    removeCustomer(state, action) {
      const id = action.payload;
      state.customers = state.customers.filter(c => c.id !== id);
    }
  }
});

export const { setCustomers, addCustomer, updateCustomer, removeCustomer } = customersSlice.actions;
export default customersSlice.reducer;
