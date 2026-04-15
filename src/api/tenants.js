import { fetchJson } from './client';

export function list() {
  return fetchJson('/api/tenants');
}

export function create(payload) {
  return fetchJson('/api/tenants', { method: 'POST', body: JSON.stringify(payload) });
}

export function update(tenantId, payload) {
  return fetchJson(`/api/tenants/${encodeURIComponent(tenantId)}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function remove(tenantId) {
  return fetchJson(`/api/tenants/${encodeURIComponent(tenantId)}`, { method: 'DELETE' });
}

export function setAdmin(tenantId, payload) {
  return fetchJson(`/api/tenants/${encodeURIComponent(tenantId)}/admin`, { method: 'POST', body: JSON.stringify(payload) });
}

export function me() {
  return fetchJson('/api/tenants/me');
}
