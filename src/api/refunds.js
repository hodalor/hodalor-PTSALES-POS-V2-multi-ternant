import { fetchJson } from './client';

export function listRequests() {
  return fetchJson('/api/refunds/requests');
}
export function createRequest(payload) {
  return fetchJson('/api/refunds/requests', { method: 'POST', body: JSON.stringify(payload) });
}
export function approve(payload) {
  return fetchJson('/api/refunds/approve', { method: 'POST', body: JSON.stringify(payload) });
}
export function reject(payload) {
  return fetchJson('/api/refunds/reject', { method: 'POST', body: JSON.stringify(payload) });
}
