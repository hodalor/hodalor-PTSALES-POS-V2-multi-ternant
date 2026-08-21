import { fetchJson } from './client';

export function list(limitOrFilters = 500, maybeFilters = {}) {
  const filters = (limitOrFilters && typeof limitOrFilters === 'object' && !Array.isArray(limitOrFilters))
    ? limitOrFilters
    : (maybeFilters || {});
  const explicitLimit = (typeof limitOrFilters === 'number' || /^\d+$/.test(String(limitOrFilters || '')))
    ? Number(limitOrFilters)
    : Number(filters.limit || 0);
  const wantsAll = !!filters.all;
  const params = new URLSearchParams();
  if (!wantsAll && Number.isFinite(explicitLimit) && explicitLimit > 0) params.set('limit', String(explicitLimit));
  if (wantsAll) params.set('all', '1');
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
