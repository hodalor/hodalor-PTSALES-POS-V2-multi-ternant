import { isFeatureEnabled } from '../utils/featureFlags';
import { enqueue, getAll } from './queue';

export const COLLECTIONS = [
  { key: 'adjustmentrequests', label: 'adjustmentrequests' },
  { key: 'approvals', label: 'approvals' },
  { key: 'audits', label: 'audits' },
  { key: 'branches', label: 'branches' },
  { key: 'cashsessions', label: 'cashsessions' },
  { key: 'creditrepayments', label: 'creditrepayments' },
  { key: 'customers', label: 'customers' },
  { key: 'expenses', label: 'expenses' },
  { key: 'expenserequests', label: 'expenserequests' },
  { key: 'invoices', label: 'invoices' },
  { key: 'purchaserequests', label: 'purchaserequests' },
  { key: 'products', label: 'products' },
  { key: 'refundrequests', label: 'refundrequests' },
  { key: 'sales', label: 'sales' },
  { key: 'serverlogs', label: 'serverlogs' },
  { key: 'settings', label: 'settings' },
  { key: 'suppliers', label: 'suppliers' },
  { key: 'transferrequests', label: 'transferrequests' },
  { key: 'users', label: 'users' },
  { key: 'wholesaleoperations', label: 'wholesaleoperations' }
];

export function isOfflineBackupEnabled(settings) {
  return isFeatureEnabled(settings, 'features.offlineBackup') && isFeatureEnabled(settings, 'modules.backup');
}

export async function enqueueHttp({ collection, label, path, method, body }) {
  return enqueue('http', { collection, label, path, method, body });
}

export async function getQueueSummary() {
  const items = await getAll();
  const byCollection = {};
  for (const it of items) {
    const c = it?.payload?.collection || 'unknown';
    byCollection[c] = (byCollection[c] || 0) + 1;
  }
  return { total: items.length, byCollection };
}

export async function listQueuedByCollection() {
  const items = await getAll();
  const map = new Map();
  for (const it of items) {
    const c = it?.payload?.collection || 'unknown';
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(it);
  }
  return map;
}
