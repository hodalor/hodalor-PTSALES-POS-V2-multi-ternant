import { fetchJson } from './client';

export async function createSale(sale) {
  return fetchJson('/api/sales', {
    method: 'POST',
    body: JSON.stringify(sale),
    timeoutMs: 60000
  });
}

export function list(params = {}) {
  const qs = new URLSearchParams();
  if (params.branchId) qs.set('branchId', String(params.branchId));
  if (params.limit) qs.set('limit', String(params.limit));
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
