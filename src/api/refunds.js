import { fetchJson } from './client';

export function listRequests() {
  return fetchJson('/api/refunds/requests');
}
export function lookupSale(query) {
  const params = new URLSearchParams();
  params.set('q', String(query || '').trim());
  return fetchJson(`/api/refunds/lookup-sale?${params.toString()}`);
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
