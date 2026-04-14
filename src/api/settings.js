import { fetchJson } from './client';

export function get() {
  return fetchJson('/api/settings');
}

export function save(data) {
  return fetchJson('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}
