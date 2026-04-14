import { fetchJson } from './client';

export async function create(data) {
  return fetchJson('/api/branches', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function list() {
  return fetchJson('/api/branches');
}

export async function update(id, patch) {
  return fetchJson(`/api/branches/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch)
  });
}

export async function remove(id) {
  return fetchJson(`/api/branches/${id}`, {
    method: 'DELETE'
  });
}
