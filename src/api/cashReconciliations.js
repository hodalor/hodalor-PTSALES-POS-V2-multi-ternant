import { fetchJson } from './client';

function buildQuery(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function listCashReconciliations(params = {}) {
  return fetchJson(`/api/cash-reconciliations${buildQuery(params)}`, { timeoutMs: 60000 });
}

export function listCashReconciliationBacklog(params = {}) {
  return fetchJson(`/api/cash-reconciliations/backlog${buildQuery(params)}`, { timeoutMs: 60000 });
}

export function getCashReconciliationSummary(params = {}) {
  return fetchJson(`/api/cash-reconciliations/summary${buildQuery(params)}`, { timeoutMs: 60000 });
}

export function createCashReconciliation(body) {
  return fetchJson('/api/cash-reconciliations', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 180000
  });
}

export function getAccountDepositTotals(params = {}) {
  return fetchJson(`/api/cash-reconciliations/accounts/deposits${buildQuery(params)}`, { timeoutMs: 60000 });
}
