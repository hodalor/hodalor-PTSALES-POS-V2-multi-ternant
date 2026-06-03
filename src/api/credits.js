import { fetchJson } from './client';

export function listCreditSales(params = {}) {
  const query = new URLSearchParams();
  if (params.customerId) query.set('customerId', String(params.customerId));
  if (params.status) query.set('status', String(params.status));
  if (params.branchId) query.set('branchId', String(params.branchId));
  if (params.posType) query.set('posType', String(params.posType));
  if (params.creditPackageName) query.set('creditPackageName', String(params.creditPackageName));
  const qs = query.toString() ? `?${query.toString()}` : '';
  return fetchJson(`/api/credits/sales${qs}`, { timeoutMs: 60000 });
}

export function listCreditCustomers() {
  return fetchJson('/api/credits/customers', { timeoutMs: 60000 });
}

export function getCustomerCreditSummary(id) {
  return fetchJson(`/api/credits/customers/${encodeURIComponent(id)}/summary`, { timeoutMs: 60000 });
}

export function listRepayments(params = {}) {
  const query = new URLSearchParams();
  if (params.customerId) query.set('customerId', String(params.customerId));
  if (params.status) query.set('status', String(params.status));
  const qs = query.toString() ? `?${query.toString()}` : '';
  return fetchJson(`/api/credits/repayments${qs}`, { timeoutMs: 60000 });
}

export function createRepayment(body) {
  return fetchJson('/api/credits/repayments', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 0
  });
}

export function removeRepayment(id) {
  return fetchJson(`/api/credits/repayments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    timeoutMs: 0
  });
}

export function removeCreditSale(id) {
  return fetchJson(`/api/credits/sales/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    timeoutMs: 0
  });
}

export function removeManyRepayments(ids = []) {
  return fetchJson('/api/credits/repayments/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    timeoutMs: 0
  });
}

export function removeManyCreditSales(ids = []) {
  return fetchJson('/api/credits/sales/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    timeoutMs: 0
  });
}
