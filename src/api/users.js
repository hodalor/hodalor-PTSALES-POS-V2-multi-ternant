import { fetchJson } from './client';

export async function list() {
  return fetchJson('/api/users', { method: 'GET' });
}

export async function create(payload) {
  return fetchJson('/api/users', { method: 'POST', body: JSON.stringify(payload) });
}

export async function update(name, payload) {
  return fetchJson(`/api/users/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function remove(name) {
  return fetchJson(`/api/users/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

