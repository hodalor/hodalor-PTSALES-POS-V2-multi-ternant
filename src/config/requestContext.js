import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage();

export function runWithRequestContext(context, fn) {
  return storage.run(context || {}, fn);
}

export function getRequestContext() {
  return storage.getStore() || {};
}

export function getCurrentDb() {
  return getRequestContext().db || null;
}

export function getCurrentTenantId() {
  return String(getRequestContext().tenantId || '');
}
