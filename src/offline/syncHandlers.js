import { fetchJson } from '../api/client';
import { createSale } from '../api/sales';
import { ensureOnlineJwt, reauthIf401 } from './reAuth';
import { addImeiConflict } from './imeiConflicts';

export async function syncQueuedItem(item) {
  if (!item) return;
  const hasSerialized = !!(item?.payload?.body?.items || item?.payload?.items || []).some(line => Array.isArray(line?.soldUnitIds) && line.soldUnitIds.length > 0);
  if (item.type === 'http') {
    const p = item.payload || {};
    const method = String(p.method || 'POST').toUpperCase();
    const path = String(p.path || '');
    const body = p.body;
    if (!path) throw new Error('Missing path');
    const opts = { method, timeoutMs: 60000 };
    if (method !== 'GET') opts.body = JSON.stringify(body ?? {});
    await ensureOnlineJwt();
    try {
      await fetchJson(path, opts);
    } catch (e) {
      const retried = await reauthIf401(e);
      if (retried) {
        await fetchJson(path, opts);
        return;
      }
      if (path === '/api/sales' && hasSerialized) {
        addImeiConflict({
          queueId: item.id,
          message: String(e?.message || 'Serialized sale sync failed'),
          path,
          sale: body || {},
          units: (body?.items || []).flatMap(line => Array.isArray(line?.soldUnits) ? line.soldUnits : []).map(unit => ({ unitId: unit.unitId || '', imei: unit.imei || '', serialNumber: unit.serialNumber || '' }))
        });
      }
      throw e;
    }
    return;
  }
  if (item.type === 'sale') {
    try {
      await createSale(item.payload);
    } catch (e) {
      if (hasSerialized) {
        addImeiConflict({
          queueId: item.id,
          message: String(e?.message || 'Serialized sale sync failed'),
          path: '/api/sales',
          sale: item.payload || {},
          units: (item?.payload?.items || []).flatMap(line => Array.isArray(line?.soldUnits) ? line.soldUnits : []).map(unit => ({ unitId: unit.unitId || '', imei: unit.imei || '', serialNumber: unit.serialNumber || '' }))
        });
      }
      throw e;
    }
  }
}
