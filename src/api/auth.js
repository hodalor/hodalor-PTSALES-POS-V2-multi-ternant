import { fetchJson } from './client';

export function login(payload) {
  return fetchJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function me() {
  return fetchJson('/api/auth/me');
}

export function updateMe(payload) {
  return fetchJson('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export function logout() {
  return fetchJson('/api/auth/logout', { method: 'POST' });
}

export function activateSubscription(payload) {
  return fetchJson('/api/auth/activate-subscription', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function getRenewalInfo(tenantId) {
  return fetchJson(`/api/auth/renewal-info?tenantId=${encodeURIComponent(tenantId)}`);
}

export function startRenewalPayment(payload) {
  return fetchJson('/api/auth/start-renewal-payment', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function verifyRenewalPayment(payload) {
  return fetchJson('/api/auth/verify-renewal-payment', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
