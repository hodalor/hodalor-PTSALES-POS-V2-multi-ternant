import { fetchJson } from './client';

export function list(params = {}) {
  const search = new URLSearchParams();
  if (params.tenantId) search.set('tenantId', String(params.tenantId));
  if (params.entityType && String(params.entityType) !== 'all') search.set('entityType', String(params.entityType));
  if (params.q) search.set('q', String(params.q));
  if (params.limit) search.set('limit', String(params.limit));
  const query = search.toString();
  return fetchJson(`/api/super-bin${query ? `?${query}` : ''}`);
}

export function restore(ids = [], tenantId = '') {
  return fetchJson('/api/super-bin/restore', {
    method: 'POST',
    body: JSON.stringify({
      ids: Array.isArray(ids) ? ids : [],
      tenantId: tenantId ? String(tenantId) : ''
    })
  });
}

export function deleteForever(ids = [], tenantId = '') {
  return fetchJson('/api/super-bin/delete-forever', {
    method: 'POST',
    body: JSON.stringify({
      ids: Array.isArray(ids) ? ids : [],
      tenantId: tenantId ? String(tenantId) : ''
    })
  });
}
