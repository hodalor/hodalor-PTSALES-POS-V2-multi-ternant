import { fetchJson } from './client';

export async function createSale(sale) {
  return fetchJson('/api/sales', {
    method: 'POST',
    body: JSON.stringify(sale),
    timeoutMs: 60000
  });
}

export async function updateSaleDate(id, payload) {
  return fetchJson(`/api/sales/${encodeURIComponent(String(id || ''))}/date`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
    timeoutMs: 60000
  });
}

export async function updateSaleCreditPackage(id, payload) {
  return fetchJson(`/api/sales/${encodeURIComponent(String(id || ''))}/credit-package`, {
    method: 'PATCH',
    body: JSON.stringify(payload || {}),
    timeoutMs: 60000
  });
}

export function list(params = {}) {
  const qs = new URLSearchParams();
  if (params.branchId) qs.set('branchId', String(params.branchId));
  if (params.limit) qs.set('limit', String(params.limit));
  const wantsAll = !!params.all || !Object.prototype.hasOwnProperty.call(params, 'limit');
  if (wantsAll) qs.set('all', '1');
  const query = qs.toString();
  return fetchJson(`/api/sales${query ? `?${query}` : ''}`);
}

export function removeMany(ids = []) {
  return fetchJson('/api/sales/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    timeoutMs: 0
  });
}
