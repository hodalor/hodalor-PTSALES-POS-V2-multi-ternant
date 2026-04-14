import { fetchJson } from './client';
import { ensureOnlineJwt, reauthIf401 } from '../offline/reAuth';

export async function create(inv) {
  await ensureOnlineJwt();
  try {
    return await fetchJson('/api/invoices', {
      method: 'POST',
      body: JSON.stringify(inv)
    });
  } catch (e) {
    const retried = await reauthIf401(e);
    if (retried) {
      return fetchJson('/api/invoices', {
        method: 'POST',
        body: JSON.stringify(inv)
      });
    }
    throw e;
  }
}

export function list() {
  return fetchJson('/api/invoices');
}
