import { fetchJson } from './client';

export function list() {
  return fetchJson('/api/tenants');
}

export function getLimitDefaults() {
  return fetchJson('/api/tenants/limits');
}

export function updateLimitDefaults(payload) {
  return fetchJson('/api/tenants/limits', { method: 'PATCH', body: JSON.stringify(payload) });
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

export function exportMyTenantData() {
  return fetchJson('/api/tenants/data-export', { timeoutMs: 0 });
}

export function importMyTenantData(payload) {
  return fetchJson('/api/tenants/data-import', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 0 });
}

export function runUserAudit() {
  return fetchJson('/api/tenants/user-audit');
}

export function cleanupUserAuditRecord(payload) {
  return fetchJson('/api/tenants/user-audit/cleanup', { method: 'POST', body: JSON.stringify(payload) });
}

export function refreshActivationCode(tenantId) {
  return fetchJson(`/api/tenants/${encodeURIComponent(tenantId)}/activation-code/refresh`, { method: 'POST' });
}

export function exportTenantData(tenantId) {
  return fetchJson(`/api/tenants/${encodeURIComponent(tenantId)}/data-export`, { timeoutMs: 0 });
}

export function importTenantData(tenantId, payload) {
  return fetchJson(`/api/tenants/${encodeURIComponent(tenantId)}/data-import`, { method: 'POST', body: JSON.stringify(payload), timeoutMs: 0 });
}

export function getPaymentManagement() {
  return fetchJson('/api/tenants/payment-management');
}

export function updatePaymentManagement(payload) {
  return fetchJson('/api/tenants/payment-management', { method: 'PATCH', body: JSON.stringify(payload) });
}

export function getSubscriptionManagement() {
  return fetchJson('/api/tenants/subscription-management');
}

export function updateSubscriptionManagement(payload) {
  return fetchJson('/api/tenants/subscription-management', { method: 'PATCH', body: JSON.stringify(payload) });
}

export function startLimitUpgradePayment(payload) {
  return fetchJson('/api/tenants/start-limit-upgrade-payment', { method: 'POST', body: JSON.stringify(payload) });
}

export function verifyLimitUpgradePayment(payload) {
  return fetchJson('/api/tenants/verify-limit-upgrade-payment', { method: 'POST', body: JSON.stringify(payload) });
}
