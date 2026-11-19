import { fetchJson } from './client';

export function createSale(sale) {
  return fetchJson('/api/sales', {
    method: 'POST',
    body: JSON.stringify(sale),
    timeoutMs: 0
  });
}

export function updateSaleDate(id, body = {}) {
  return fetchJson(`/api/sales/${encodeURIComponent(id)}/date`, {
    method: 'PATCH',
    body: JSON.stringify(body || {}),
    timeoutMs: 0
  });
}

export function updateSaleCreditPackage(id, body = {}) {
  return fetchJson(`/api/sales/${encodeURIComponent(id)}/credit-package`, {
    method: 'PATCH',
    body: JSON.stringify(body || {}),
    timeoutMs: 0
  });
}

export function list(params = {}) {
  const qs = new URLSearchParams();
  if (params.branchId) qs.set('branchId', String(params.branchId));
  if (params.from) qs.set('from', String(params.from));
  if (params.to) qs.set('to', String(params.to));
  if (params.days) qs.set('days', String(params.days));
  if (params.limit != null) qs.set('limit', String(params.limit));
  else if (params.all) qs.set('limit', '2000');
  else qs.set('limit', '500');
  if (params.all) qs.set('all', '1');
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
