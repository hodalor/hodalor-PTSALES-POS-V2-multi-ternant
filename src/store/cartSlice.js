import { createSlice, nanoid } from '@reduxjs/toolkit';

function createEmptyCartScope() {
  return {
    items: [],
    discount: 0,
    notes: '',
    heldSales: []
  };
}

const SCOPE_KEYS = ['retail', 'wholesale', 'warehouse'];

const initialState = {
  scopes: {
    retail: createEmptyCartScope(),
    wholesale: createEmptyCartScope(),
    warehouse: createEmptyCartScope()
  }
};

function normalizeScopeKey(value) {
  const next = String(value || 'retail').trim().toLowerCase();
  return SCOPE_KEYS.includes(next) ? next : 'retail';
}

function ensureCartScopes(state) {
  if (!state.scopes || typeof state.scopes !== 'object') {
    state.scopes = {
      retail: {
        items: Array.isArray(state.items) ? state.items : [],
        discount: Number(state.discount || 0),
        notes: String(state.notes || ''),
        heldSales: Array.isArray(state.heldSales) ? state.heldSales : []
      },
      wholesale: createEmptyCartScope(),
      warehouse: createEmptyCartScope()
    };
  }
  SCOPE_KEYS.forEach((scopeKey) => {
    if (!state.scopes[scopeKey] || typeof state.scopes[scopeKey] !== 'object') {
      state.scopes[scopeKey] = createEmptyCartScope();
      return;
    }
    if (!Array.isArray(state.scopes[scopeKey].items)) state.scopes[scopeKey].items = [];
    if (!Array.isArray(state.scopes[scopeKey].heldSales)) state.scopes[scopeKey].heldSales = [];
    if (typeof state.scopes[scopeKey].notes !== 'string') state.scopes[scopeKey].notes = String(state.scopes[scopeKey].notes || '');
    if (!Number.isFinite(Number(state.scopes[scopeKey].discount))) state.scopes[scopeKey].discount = 0;
  });
}

function getCartScope(state, rawScope) {
  ensureCartScopes(state);
  return state.scopes[normalizeScopeKey(rawScope)];
}

export function selectCartScope(cartState, rawScope = 'retail') {
  const scopeKey = normalizeScopeKey(rawScope);
  const scopes = cartState?.scopes;
  if (scopes && typeof scopes === 'object' && scopes[scopeKey]) {
    const scope = scopes[scopeKey];
    return {
      items: Array.isArray(scope.items) ? scope.items : [],
      discount: Number(scope.discount || 0),
      notes: String(scope.notes || ''),
      heldSales: Array.isArray(scope.heldSales) ? scope.heldSales : []
    };
  }
  return scopeKey === 'retail'
    ? {
        items: Array.isArray(cartState?.items) ? cartState.items : [],
        discount: Number(cartState?.discount || 0),
        notes: String(cartState?.notes || ''),
        heldSales: Array.isArray(cartState?.heldSales) ? cartState.heldSales : []
      }
    : createEmptyCartScope();
}

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addItem: {
      reducer(state, action) {
        const { scope: scopeKey, ...itemPayload } = action.payload || {};
        const scope = getCartScope(state, scopeKey);
        const existingIndex = scope.items.findIndex(i =>
          String(i.productId || '') === String(itemPayload.productId || '')
          && String(i.variantId || '') === String(itemPayload.variantId || '')
          && String(i.priceTier || 'retail') === String(itemPayload.priceTier || 'retail')
          && String(i.unitId || '') === String(itemPayload.unitId || '')
        );
        if (existingIndex >= 0) {
          const existing = scope.items[existingIndex];
          if (itemPayload.unitId) return;
          existing.quantity += itemPayload.quantity || 1;
          if (existingIndex > 0) {
            scope.items.splice(existingIndex, 1);
            scope.items.unshift(existing);
          }
        } else {
          scope.items.unshift({ id: nanoid(), ...itemPayload, quantity: itemPayload.quantity || 1 });
        }
      },
      prepare(payload) {
        return { payload };
      }
    },
    removeItem(state, action) {
      const payload = action.payload && typeof action.payload === 'object'
        ? action.payload
        : { id: action.payload };
      const scope = getCartScope(state, payload.scope);
      scope.items = scope.items.filter(i => i.id !== payload.id);
    },
    removeItemByUnitId(state, action) {
      const payload = action.payload && typeof action.payload === 'object'
        ? action.payload
        : { unitId: action.payload };
      const scope = getCartScope(state, payload.scope);
      const unitId = String(payload.unitId || '');
      scope.items = scope.items.filter(i => String(i.unitId || '') !== unitId);
    },
    setQuantity(state, action) {
      const { id, quantity, scope: scopeKey } = action.payload || {};
      const scope = getCartScope(state, scopeKey);
      const item = scope.items.find(i => i.id === id);
      if (item) item.quantity = quantity;
    },
    updateItemPricing(state, action) {
      const { id, priceTier, price, scope: scopeKey } = action.payload || {};
      const scope = getCartScope(state, scopeKey);
      const item = scope.items.find(i => i.id === id);
      if (!item) return;
      if (priceTier) item.priceTier = String(priceTier);
      if (price != null) item.price = Number(price) || 0;
    },
    clearCart(state, action) {
      const scopeKey = action?.payload?.scope;
      const scope = getCartScope(state, scopeKey);
      scope.items = [];
      scope.discount = 0;
      scope.notes = '';
    },
    replaceCart(state, action) {
      const { items, discount, notes, scope: scopeKey } = action.payload || {};
      const scope = getCartScope(state, scopeKey);
      scope.items = Array.isArray(items) ? items : [];
      scope.discount = Number(discount || 0);
      scope.notes = String(notes || '');
    },
    addHeld(state, action) {
      const { scope: scopeKey, ...heldPayload } = action.payload || {};
      const scope = getCartScope(state, scopeKey);
      if (!Array.isArray(scope.heldSales)) scope.heldSales = [];
      scope.heldSales.unshift(heldPayload);
    },
    removeHeld(state, action) {
      const payload = action.payload && typeof action.payload === 'object'
        ? action.payload
        : { id: action.payload };
      const scope = getCartScope(state, payload.scope);
      if (!Array.isArray(scope.heldSales)) scope.heldSales = [];
      scope.heldSales = scope.heldSales.filter(h => h && h.id !== payload.id);
    },
    updateHeld(state, action) {
      const { id, scope: scopeKey, ...patch } = action.payload || {};
      const scope = getCartScope(state, scopeKey);
      if (!Array.isArray(scope.heldSales)) scope.heldSales = [];
      const idx = scope.heldSales.findIndex(h => h && h.id === id);
      if (idx >= 0) {
        scope.heldSales[idx] = { ...scope.heldSales[idx], ...patch };
      }
    },
    setDiscount(state, action) {
      const payload = action.payload && typeof action.payload === 'object'
        ? action.payload
        : { value: action.payload };
      const scope = getCartScope(state, payload.scope);
      scope.discount = Number(payload.value || 0);
    },
    setNotes(state, action) {
      const payload = action.payload && typeof action.payload === 'object'
        ? action.payload
        : { value: action.payload };
      const scope = getCartScope(state, payload.scope);
      scope.notes = String(payload.value || '');
    }
  }
});

export const { addItem, removeItem, removeItemByUnitId, setQuantity, updateItemPricing, clearCart, replaceCart, addHeld, removeHeld, updateHeld, setDiscount, setNotes } = cartSlice.actions;
export default cartSlice.reducer;
