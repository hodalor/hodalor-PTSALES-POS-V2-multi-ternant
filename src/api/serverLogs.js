import { fetchJson } from './client';

export async function list(limit = 500) {
  return fetchJson(`/api/server-logs?limit=${encodeURIComponent(limit)}`, { method: 'GET' });
}

export async function removeMany(ids = []) {
  return fetchJson('/api/server-logs/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    timeoutMs: 0
  });
}

