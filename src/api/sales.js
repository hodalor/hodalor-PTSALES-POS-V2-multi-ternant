import { fetchJson } from './client';

export async function createSale(sale) {
  return fetchJson('/api/sales', {
    method: 'POST',
    body: JSON.stringify(sale),
    timeoutMs: 60000
  });
}

export function list() {
  return fetchJson('/api/sales');
}

export function removeMany(ids = []) {
  return fetchJson('/api/sales/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    timeoutMs: 0
  });
}
