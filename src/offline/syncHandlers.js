import { fetchJson } from '../api/client';
import { createSale } from '../api/sales';
import { ensureOnlineJwt, reauthIf401 } from './reAuth';
import { addImeiConflict } from './imeiConflicts';

function reportQueuedSalesImeiDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'queued-sales-imei',
      runId: 'pre-fix',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

function reportTenantQueueSkewDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'tenant-queue-skew',
      runId: 'pre-fix',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

function reportQueuedSaleRetryDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'queued-sale-retry',
      runId: 'pre-fix',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

export async function syncQueuedItem(item) {
  if (!item) return;
  const hasSerialized = !!(item?.payload?.body?.items || item?.payload?.items || []).some(line => Array.isArray(line?.soldUnitIds) && line.soldUnitIds.length > 0);
  const isSalesPath = String(item?.payload?.path || '') === '/api/sales';
  const isSaleReplay = item?.type === 'sale' || (item?.type === 'http' && isSalesPath);
  const salePayload = item?.type === 'http' ? (item?.payload?.body || {}) : (item?.payload || {});
  const tenantId = (() => {
    try { return String(localStorage.getItem('ptSales:tenantId') || 'default'); } catch { return 'default'; }
  })();
  // #region debug-point C:sync-handler-active-tenant
  reportTenantQueueSkewDebug({
    hypothesisId: 'C',
    location: 'syncHandlers.js:syncQueuedItem',
    msg: '[DEBUG] Queue sync handler resolved active tenant before replay',
    data: {
      tenantId,
      queueId: Number(item?.id || 0),
      itemType: String(item?.type || ''),
      path: String(item?.payload?.path || ''),
      clientId: String(salePayload?.clientId || ''),
      branchId: String(salePayload?.branchId || ''),
      hasSerialized
    }
  });
  // #endregion
  if (isSaleReplay) {
    // #region debug-point A:sync-sale-start
    reportQueuedSalesImeiDebug({
      hypothesisId: 'A',
      location: 'syncHandlers.js:syncQueuedItem:start',
      msg: '[DEBUG] Queued sale replay starting',
      data: {
        queueId: Number(item?.id || 0),
        itemType: String(item?.type || ''),
        path: String(item?.payload?.path || '/api/sales'),
        clientId: String(salePayload?.clientId || ''),
        branchId: String(salePayload?.branchId || ''),
        reservationToken: String(salePayload?.reservationToken || ''),
        itemCount: Array.isArray(salePayload?.items) ? salePayload.items.length : 0,
        soldUnitIds: (Array.isArray(salePayload?.items) ? salePayload.items : []).flatMap((line) => Array.isArray(line?.soldUnitIds) ? line.soldUnitIds.map(String) : []),
        hasSerialized
      }
    });
    // #endregion
  }
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
      if (isSaleReplay) {
        // #region debug-point B:sync-sale-success
        reportQueuedSalesImeiDebug({
          hypothesisId: 'B',
          location: 'syncHandlers.js:syncQueuedItem:http-success',
          msg: '[DEBUG] Queued sale replay completed successfully',
          data: {
            queueId: Number(item?.id || 0),
            clientId: String(body?.clientId || ''),
            branchId: String(body?.branchId || ''),
            soldUnitIds: (Array.isArray(body?.items) ? body.items : []).flatMap((line) => Array.isArray(line?.soldUnitIds) ? line.soldUnitIds.map(String) : [])
          }
        });
        // #endregion
      }
    } catch (e) {
      const retried = await reauthIf401(e);
      if (retried) {
        await fetchJson(path, opts);
        if (isSaleReplay) {
          // #region debug-point B:sync-sale-success-after-reauth
          reportQueuedSalesImeiDebug({
            hypothesisId: 'B',
            location: 'syncHandlers.js:syncQueuedItem:http-success-after-reauth',
            msg: '[DEBUG] Queued sale replay succeeded after reauth',
            data: {
              queueId: Number(item?.id || 0),
              clientId: String(body?.clientId || ''),
              branchId: String(body?.branchId || ''),
              soldUnitIds: (Array.isArray(body?.items) ? body.items : []).flatMap((line) => Array.isArray(line?.soldUnitIds) ? line.soldUnitIds.map(String) : [])
            }
          });
          // #endregion
        }
        return;
      }
      if (isSaleReplay) {
        // #region debug-point A:queued-sale-retry-http-error
        reportQueuedSaleRetryDebug({
          hypothesisId: 'A',
          location: 'syncHandlers.js:syncQueuedItem:http-error',
          msg: '[DEBUG] Queued sale replay failed during HTTP sync',
          data: {
            queueId: Number(item?.id || 0),
            clientId: String(body?.clientId || ''),
            branchId: String(body?.branchId || ''),
            status: Number(e?.status || 0),
            message: String(e?.message || ''),
            errorData: e?.data || null,
            reservationToken: String(body?.reservationToken || ''),
            soldUnitIds: (Array.isArray(body?.items) ? body.items : []).flatMap((line) => Array.isArray(line?.soldUnitIds) ? line.soldUnitIds.map(String) : []),
            soldUnits: (Array.isArray(body?.items) ? body.items : []).flatMap((line) => Array.isArray(line?.soldUnits) ? line.soldUnits : []).map((unit) => ({
              unitId: String(unit?.unitId || ''),
              imei: String(unit?.imei || ''),
              serialNumber: String(unit?.serialNumber || '')
            }))
          }
        });
        // #endregion
        // #region debug-point E:sync-sale-error
        reportQueuedSalesImeiDebug({
          hypothesisId: 'E',
          location: 'syncHandlers.js:syncQueuedItem:http-error',
          msg: '[DEBUG] Queued sale replay failed',
          data: {
            queueId: Number(item?.id || 0),
            clientId: String(body?.clientId || ''),
            branchId: String(body?.branchId || ''),
            message: String(e?.message || ''),
            soldUnitIds: (Array.isArray(body?.items) ? body.items : []).flatMap((line) => Array.isArray(line?.soldUnitIds) ? line.soldUnitIds.map(String) : []),
            hasSerialized
          }
        });
        // #endregion
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
      // #region debug-point B:sync-sale-direct-success
      reportQueuedSalesImeiDebug({
        hypothesisId: 'B',
        location: 'syncHandlers.js:syncQueuedItem:direct-success',
        msg: '[DEBUG] Legacy queued sale replay completed successfully',
        data: {
          queueId: Number(item?.id || 0),
          clientId: String(item?.payload?.clientId || ''),
          branchId: String(item?.payload?.branchId || ''),
          soldUnitIds: (Array.isArray(item?.payload?.items) ? item.payload.items : []).flatMap((line) => Array.isArray(line?.soldUnitIds) ? line.soldUnitIds.map(String) : [])
        }
      });
      // #endregion
    } catch (e) {
      // #region debug-point A:queued-sale-retry-direct-error
      reportQueuedSaleRetryDebug({
        hypothesisId: 'A',
        location: 'syncHandlers.js:syncQueuedItem:direct-error',
        msg: '[DEBUG] Legacy queued sale replay failed',
        data: {
          queueId: Number(item?.id || 0),
          clientId: String(item?.payload?.clientId || ''),
          branchId: String(item?.payload?.branchId || ''),
          status: Number(e?.status || 0),
          message: String(e?.message || ''),
          errorData: e?.data || null,
          reservationToken: String(item?.payload?.reservationToken || ''),
          soldUnitIds: (Array.isArray(item?.payload?.items) ? item.payload.items : []).flatMap((line) => Array.isArray(line?.soldUnitIds) ? line.soldUnitIds.map(String) : [])
        }
      });
      // #endregion
      // #region debug-point E:sync-sale-direct-error
      reportQueuedSalesImeiDebug({
        hypothesisId: 'E',
        location: 'syncHandlers.js:syncQueuedItem:direct-error',
        msg: '[DEBUG] Legacy queued sale replay failed',
        data: {
          queueId: Number(item?.id || 0),
          clientId: String(item?.payload?.clientId || ''),
          branchId: String(item?.payload?.branchId || ''),
          message: String(e?.message || ''),
          soldUnitIds: (Array.isArray(item?.payload?.items) ? item.payload.items : []).flatMap((line) => Array.isArray(line?.soldUnitIds) ? line.soldUnitIds.map(String) : []),
          hasSerialized
        }
      });
      // #endregion
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
