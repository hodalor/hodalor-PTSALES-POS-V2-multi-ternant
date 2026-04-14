import { fetchJson } from './client';

export function list({ branchId, from, to } = {}) {
  const params = new URLSearchParams();
  if (branchId) params.set('branchId', branchId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return fetchJson(`/api/expenses${qs ? `?${qs}` : ''}`);
}

export function create(payload) {
  return fetchJson('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
}

export function listRequests(opts = {}) {
  const params = new URLSearchParams();
  const status = String(opts.status || '');
  const map = { pending: 'pending_approval', approved: 'approved', rejected: 'rejected' };
  if (status) params.set('status', map[status] || status);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/expenses/requests${qs}`, { timeoutMs: 60000 });
}

export function createRequest(payload) {
  return fetchJson('/api/expenses/requests', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000
  });
}

export function approve(payload) {
  return fetchJson('/api/expenses/approve', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000
  });
}

export function reject(payload) {
  return fetchJson('/api/expenses/reject', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000
  });
}

export function update(id, payload) {
  return fetchJson(`/api/expenses/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export function remove(id) {
  return fetchJson(`/api/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

