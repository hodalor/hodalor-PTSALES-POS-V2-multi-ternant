import { fetchJson } from './client';

export function listRequests(opts = {}) {
  const params = new URLSearchParams();
  const status = String(opts.status || '');
  const map = { pending: 'pending_approval', approved: 'approved', rejected: 'rejected' };
  if (status) params.set('status', map[status] || status);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.all) params.set('all', '1');
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/adjustments/requests${qs}`, { timeoutMs: 60000 });
}

export function createRequest(payload) {
  return fetchJson('/api/adjustments/requests', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000
  });
}

export function approve(payload) {
  return fetchJson('/api/adjustments/approve', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 180000
  });
}

export function reject(payload) {
  return fetchJson('/api/adjustments/reject', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000
  });
}
