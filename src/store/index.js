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
import { clearTenantState } from './persist';

const preloadedState = loadState();
if (preloadedState?.auth) {
  preloadedState.auth = {
    ...preloadedState.auth,
    initialized: false
  };
}
if (preloadedState?.settings) {
  preloadedState.settings = {
    ...preloadedState.settings,
    hydrated: false
  };
}
const appReducer = {
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
};

function rootReducer(state, action) {
  if (action?.type === 'app/resetTenantState') {
    const nextTenantId = String(action?.payload?.tenantId || localStorage.getItem('ptSales:tenantId') || 'default');
    try { clearTenantState(nextTenantId); } catch {}
    state = undefined;
  }
  return {
    auth: appReducer.auth(state?.auth, action),
    cart: appReducer.cart(state?.cart, action),
    settings: appReducer.settings(state?.settings, action),
    branches: appReducer.branches(state?.branches, action),
    products: appReducer.products(state?.products, action),
    users: appReducer.users(state?.users, action),
    suppliers: appReducer.suppliers(state?.suppliers, action),
    customers: appReducer.customers(state?.customers, action),
    sales: appReducer.sales(state?.sales, action),
    audit: appReducer.audit(state?.audit, action),
    sessions: appReducer.sessions(state?.sessions, action),
    refunds: appReducer.refunds(state?.refunds, action),
    purchases: appReducer.purchases(state?.purchases, action),
    transfers: appReducer.transfers(state?.transfers, action),
    expenseRequests: appReducer.expenseRequests(state?.expenseRequests, action),
    adjustmentRequests: appReducer.adjustmentRequests(state?.adjustmentRequests, action),
    offlineQueue: appReducer.offlineQueue(state?.offlineQueue, action),
    invoices: appReducer.invoices(state?.invoices, action)
  };
}

const store = configureStore({
  reducer: rootReducer,
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

export const resetTenantAppState = (tenantId) => ({ type: 'app/resetTenantState', payload: { tenantId } });
