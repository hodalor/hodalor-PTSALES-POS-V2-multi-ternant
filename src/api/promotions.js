import { fetchJson } from './client';

export function list({ available = false } = {}) {
  const qs = available ? '?available=1' : '';
  return fetchJson(`/api/promotions${qs}`);
}

export function create(payload) {
  return fetchJson('/api/promotions', { method: 'POST', body: JSON.stringify(payload) });
}

export function update(id, payload) {
  return fetchJson(`/api/promotions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function remove(id) {
  return fetchJson(`/api/promotions/${id}`, { method: 'DELETE' });
}
