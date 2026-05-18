import { fetchJson } from './client';

export function list() {
  return fetchJson('/api/products');
}
export function listByIds(ids = []) {
  const values = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  if (values.length === 0) return Promise.resolve([]);
  const query = new URLSearchParams();
  query.set('ids', values.join(','));
  return fetchJson(`/api/products?${query.toString()}`);
}
export function create(payload) {
  return fetchJson('/api/products', { method: 'POST', body: JSON.stringify(payload) });
}
export function update(id, payload) {
  return fetchJson(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(payload), timeoutMs: 60000 });
}
export function remove(id, payload = {}) {
  return fetchJson(`/api/products/${id}`, { method: 'DELETE', body: JSON.stringify(payload || {}) });
}
