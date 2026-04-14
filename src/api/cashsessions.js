import { fetchJson } from './client';

export async function me() {
  return fetchJson('/api/cashsessions/me', { method: 'GET' });
}

export async function open(openingFloat) {
  return fetchJson('/api/cashsessions/open', { method: 'POST', body: JSON.stringify({ openingFloat }) });
}

export async function move(type, amount, note) {
  return fetchJson('/api/cashsessions/move', { method: 'POST', body: JSON.stringify({ type, amount, note }) });
}

export async function close() {
  return fetchJson('/api/cashsessions/close', { method: 'POST' });
}

