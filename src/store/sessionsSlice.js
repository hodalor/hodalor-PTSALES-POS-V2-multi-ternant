import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  isOpen: false,
  openedAt: null,
  closedAt: null,
  openingFloat: 0,
  movements: [] // {time, type: 'in'|'out', amount, note}
};

const sessionsSlice = createSlice({
  name: 'sessions',
  initialState,
  reducers: {
    setSession(state, action) {
      const s = action.payload || {};
      state.isOpen = !!s.isOpen;
      state.openedAt = s.openedAt || null;
      state.closedAt = s.closedAt || null;
      state.openingFloat = Number(s.openingFloat || 0);
      state.movements = Array.isArray(s.movements) ? s.movements.map(m => ({
        time: m.time || m.ts || new Date().toISOString(),
        type: m.type,
        amount: Number(m.amount),
        note: m.note || ''
      })) : [];
    },
    openSession(state, action) {
      if (state.isOpen) return;
      state.isOpen = true;
      state.openedAt = new Date().toISOString();
      state.closedAt = null;
      state.openingFloat = Number(action.payload || 0);
      state.movements = [];
    },
    closeSession(state) {
      if (!state.isOpen) return;
      state.isOpen = false;
      state.closedAt = new Date().toISOString();
    },
    addMovement(state, action) {
      if (!state.isOpen) return;
      const { type, amount, note } = action.payload;
      state.movements.push({ time: new Date().toISOString(), type, amount: Number(amount), note });
    }
  }
});

export const { setSession, openSession, closeSession, addMovement } = sessionsSlice.actions;
export default sessionsSlice.reducer;
