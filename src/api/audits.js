import { fetchJson } from './client';

export function list(limit = 500) {
  return fetchJson(`/api/audits?limit=${encodeURIComponent(limit)}`);
}

export function remove(id) {
  return fetchJson(`/api/audits/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

export function removeMany(ids = []) {
  return fetchJson('/api/audits/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    timeoutMs: 0
  });
}
