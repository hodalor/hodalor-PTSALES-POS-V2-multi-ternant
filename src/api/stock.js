import { fetchJson } from './client';

export function receive(payload) {
  return fetchJson('/api/stock/receive', { method: 'POST', body: JSON.stringify(payload) });
}
export function adjust(payload) {
  return fetchJson('/api/stock/adjust', { method: 'POST', body: JSON.stringify(payload) });
}
export function damageRemove(payload) {
  return fetchJson('/api/stock/damage-remove', { method: 'POST', body: JSON.stringify(payload) }); 
}
export function transfer(payload) {
  return fetchJson('/api/stock/transfer', { method: 'POST', body: JSON.stringify(payload) });
}
export function setStock(payload) {
  return fetchJson('/api/stock/set', { method: 'POST', body: JSON.stringify(payload) });
}
