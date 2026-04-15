import { fetchJson } from './client';

export function list(limit = 500, filters = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (filters.tenantId) params.set('tenantId', String(filters.tenantId));
  if (filters.from) params.set('from', String(filters.from));
  if (filters.to) params.set('to', String(filters.to));
  if (filters.severity) params.set('severity', String(filters.severity));
  return fetchJson(`/api/audits?${params.toString()}`);
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
