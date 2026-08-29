import { fetchJson } from './client';

function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', String(params.status));
  if (params.posType) qs.set('posType', String(params.posType));
  if (params.branchId) qs.set('branchId', String(params.branchId));
  if (params.mine) qs.set('mine', '1');
  return qs.toString() ? `?${qs.toString()}` : '';
}

export function listDiscountApprovals(params = {}) {
  return fetchJson(`/api/discount-approvals${buildQuery(params)}`, { timeoutMs: 60000 });
}

export function requestDiscountApproval(body = {}) {
  return fetchJson('/api/discount-approvals/request', {
    method: 'POST',
    body: JSON.stringify(body || {}),
    timeoutMs: 60000
  });
}

export function approveDiscountApproval(id, body = {}) {
  return fetchJson(`/api/discount-approvals/${encodeURIComponent(String(id || ''))}/approve`, {
    method: 'POST',
    body: JSON.stringify(body || {}),
    timeoutMs: 60000
  });
}

export function rejectDiscountApproval(id, body = {}) {
  return fetchJson(`/api/discount-approvals/${encodeURIComponent(String(id || ''))}/reject`, {
    method: 'POST',
    body: JSON.stringify(body || {}),
    timeoutMs: 60000
  });
}

export function cancelDiscountApproval(id, body = {}) {
  return fetchJson(`/api/discount-approvals/${encodeURIComponent(String(id || ''))}/cancel`, {
    method: 'POST',
    body: JSON.stringify(body || {}),
    timeoutMs: 60000
  });
}
