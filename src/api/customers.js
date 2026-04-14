import { fetchJson } from './client';

export function list({ q, limit } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (limit != null) params.set('limit', String(limit));
  const qs = params.toString();
  return fetchJson(`/api/customers${qs ? `?${qs}` : ''}`);
}
export function create(payload) {
  return fetchJson('/api/customers', { method: 'POST', body: JSON.stringify(payload) });
}
export function update(id, payload) {
  return fetchJson(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export function remove(id) {
  return fetchJson(`/api/customers/${id}`, { method: 'DELETE' });
}

export function removeMany(ids = []) {
  return fetchJson('/api/customers/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    timeoutMs: 0
  });
}
