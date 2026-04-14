import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  items: [],
  discount: 0,
  notes: '',
  heldSales: []
};

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addItem: {
      reducer(state, action) {
        const existing = state.items.find(i =>
          i.sku === action.payload.sku
          && String(i.priceTier || 'retail') === String(action.payload.priceTier || 'retail')
          && String(i.unitId || '') === String(action.payload.unitId || '')
        );
        if (existing) {
          if (action.payload.unitId) return;
          existing.quantity += action.payload.quantity || 1;
        } else {
          state.items.push({ id: nanoid(), ...action.payload, quantity: action.payload.quantity || 1 });
        }
      },
      prepare(payload) {
        return { payload };
      }
    },
    removeItem(state, action) {
      state.items = state.items.filter(i => i.id !== action.payload);
    },
    removeItemByUnitId(state, action) {
      const unitId = String(action.payload || '');
      state.items = state.items.filter(i => String(i.unitId || '') !== unitId);
    },
    setQuantity(state, action) {
      const { id, quantity } = action.payload;
      const item = state.items.find(i => i.id === id);
      if (item) item.quantity = quantity;
    },
    updateItemPricing(state, action) {
      const { id, priceTier, price } = action.payload || {};
      const item = state.items.find(i => i.id === id);
      if (!item) return;
      if (priceTier) item.priceTier = String(priceTier);
      if (price != null) item.price = Number(price) || 0;
    },
    clearCart(state) {
      state.items = [];
      state.discount = 0;
      state.notes = '';
    },
    replaceCart(state, action) {
      const { items, discount, notes } = action.payload || {};
      state.items = Array.isArray(items) ? items : [];
      state.discount = Number(discount || 0);
      state.notes = String(notes || '');
    },
    addHeld(state, action) {
      const h = action.payload || {};
      if (!Array.isArray(state.heldSales)) state.heldSales = [];
      state.heldSales.unshift(h);
    },
    removeHeld(state, action) {
      const id = action.payload;
      if (!Array.isArray(state.heldSales)) state.heldSales = [];
      state.heldSales = state.heldSales.filter(h => h && h.id !== id);
    },
    updateHeld(state, action) {
      const { id, ...patch } = action.payload || {};
      if (!Array.isArray(state.heldSales)) state.heldSales = [];
      const idx = state.heldSales.findIndex(h => h && h.id === id);
      if (idx >= 0) {
        state.heldSales[idx] = { ...state.heldSales[idx], ...patch };
      }
    },
    setDiscount(state, action) {
      state.discount = action.payload || 0;
    },
    setNotes(state, action) {
      state.notes = action.payload || '';
    }
  }
});

export const { addItem, removeItem, removeItemByUnitId, setQuantity, updateItemPricing, clearCart, replaceCart, addHeld, removeHeld, updateHeld, setDiscount, setNotes } = cartSlice.actions;
export default cartSlice.reducer;
