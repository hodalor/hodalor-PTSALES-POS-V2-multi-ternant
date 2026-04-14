import { fetchJson } from './client';

export function login(payload) {
  return fetchJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function me() {
  return fetchJson('/api/auth/me');
}
