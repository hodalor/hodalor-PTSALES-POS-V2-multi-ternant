import * as suppliersApi from '../api/suppliers';
import { enqueueHttp } from '../offline/offlineBackup';
import { addSupplier } from '../store/suppliersSlice';

export function normalizeSupplierName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function findSupplierByName(suppliers, value) {
  const target = normalizeSupplierName(value).toLowerCase();
  if (!target) return null;
  return (Array.isArray(suppliers) ? suppliers : []).find((supplier) => (
    normalizeSupplierName(supplier?.name).toLowerCase() === target
  )) || null;
}

export async function ensureSupplierByName({
  name,
  suppliers,
  dispatch,
  offlineBackupAllowed
}) {
  const normalized = normalizeSupplierName(name);
  if (!normalized) return null;
  const existing = findSupplierByName(suppliers, normalized);
  if (existing) return existing;

  const clientId = `supplier-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = { name: normalized, clientId };

  if (!navigator.onLine) {
    if (!offlineBackupAllowed) return normalized;
    dispatch(addSupplier({ id: clientId, clientId, name: normalized, offline: true }));
    try {
      await enqueueHttp({
        collection: 'suppliers',
        label: 'Supplier',
        path: '/api/suppliers',
        method: 'POST',
        body: payload
      });
    } catch {}
    return { id: clientId, clientId, name: normalized, offline: true };
  }

  const created = await suppliersApi.create(payload);
  const incoming = created && typeof created === 'object' ? created : payload;
  dispatch(addSupplier(incoming));
  return incoming;
}
