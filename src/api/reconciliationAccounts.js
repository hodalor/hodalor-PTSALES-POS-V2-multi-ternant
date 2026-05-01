import { fetchJson } from './client';

export function listReconciliationAccounts(params = {}) {
  const query = new URLSearchParams();
  if (params.active) query.set('active', 'true');
  const qs = query.toString() ? `?${query.toString()}` : '';
  return fetchJson(`/api/reconciliation-accounts${qs}`, { timeoutMs: 60000 });
}

export function createReconciliationAccount(body) {
  return fetchJson('/api/reconciliation-accounts', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 120000
  });
}

export function updateReconciliationAccount(id, body) {
  return fetchJson(`/api/reconciliation-accounts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    timeoutMs: 120000
  });
}

export function removeReconciliationAccount(id) {
  return fetchJson(`/api/reconciliation-accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    timeoutMs: 120000
  });
}
