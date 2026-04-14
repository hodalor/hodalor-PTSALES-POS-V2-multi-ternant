import { fetchJson } from './client';

export function list() {
  return fetchJson('/api/suppliers');
}
export function create(payload) {
  return fetchJson('/api/suppliers', { method: 'POST', body: JSON.stringify(payload) });
}
export function update(id, payload) {
  return fetchJson(`/api/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export function remove(id) {
  return fetchJson(`/api/suppliers/${id}`, { method: 'DELETE' });
}
