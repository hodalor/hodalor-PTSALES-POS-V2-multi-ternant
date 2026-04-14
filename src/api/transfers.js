import { fetchJson } from './client';

export function listRequests(opts = {}) {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchJson(`/api/transfers/requests${qs}`, { timeoutMs: 60000 });
}

export function createRequest(payload) {
  return fetchJson('/api/transfers/requests', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000
  });
}

export function approve(payload) {
  return fetchJson('/api/transfers/approve', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000
  });
}

export function reject(payload) {
  return fetchJson('/api/transfers/reject', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeoutMs: 60000
  });
}
