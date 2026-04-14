import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import cartReducer from './cartSlice';
import settingsReducer from './settingsSlice';
import branchesReducer from './branchesSlice';
import productsReducer from './productsSlice';
import usersReducer from './usersSlice';
import suppliersReducer from './suppliersSlice';
import customersReducer from './customersSlice';
import salesReducer from './salesSlice';
import sessionsReducer from './sessionsSlice';
import auditReducer from './auditSlice';
import refundsReducer from './refundsSlice';
import purchasesReducer from './purchasesSlice';
import transfersReducer from './transfersSlice';
import offlineQueueReducer from './offlineQueueSlice';
import { loadState, saveState } from './persist';
import invoicesReducer from './invoicesSlice';
import expenseRequestsReducer from './expenseRequestsSlice';
import adjustmentRequestsReducer from './adjustmentRequestsSlice';

const preloadedState = loadState();
const store = configureStore({
  reducer: {
    auth: authReducer,
    cart: cartReducer,
    settings: settingsReducer,
    branches: branchesReducer,
    products: productsReducer,
    users: usersReducer,
    suppliers: suppliersReducer,
    customers: customersReducer,
    sales: salesReducer,
    audit: auditReducer,
    sessions: sessionsReducer,
    refunds: refundsReducer,
    purchases: purchasesReducer,
    transfers: transfersReducer,
    expenseRequests: expenseRequestsReducer,
    adjustmentRequests: adjustmentRequestsReducer,
    offlineQueue: offlineQueueReducer,
    invoices: invoicesReducer
  },
  preloadedState
});

let saveTimer = null;
store.subscribe(() => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { saveState(store.getState()); } catch {}
  }, 500);
});

export default store;
