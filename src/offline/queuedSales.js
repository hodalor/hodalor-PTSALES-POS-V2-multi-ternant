import { getAll } from './queue';

function reportTenantQueueSkewDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'tenant-sale-leak',
      runId: 'pre-fix',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

function isQueuedSaleItem(item) {
  return item?.type === 'sale'
    || String(item?.payload?.collection || '') === 'sales'
    || String(item?.payload?.path || '') === '/api/sales';
}

function buildTemporaryReference(body = {}, queuedId = '', ts = 0) {
  const explicit = String(body?.invoiceSerial || body?.receiptNumber || '').trim();
  if (explicit) return explicit;
  const seed = String(body?.clientId || queuedId || ts || Date.now()).replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `TMP-${seed || 'SALE'}`;
}

function toQueuedSaleRecord(item) {
  const body = item?.type === 'http' ? (item?.payload?.body || {}) : (item?.payload || {});
  const queuedId = String(item?.id || '');
  const clientId = String(body?.clientId || '').trim() || `queued-sale-${queuedId || Date.now()}`;
  const tempRef = buildTemporaryReference(body, queuedId, Number(item?.ts || 0));
  return {
    ...body,
    id: String(body?.id || body?._id || clientId),
    clientId,
    tenantId: String(item?.tenantId || ''),
    invoiceSerial: tempRef,
    receiptNumber: tempRef,
    created_at: body?.created_at || new Date(Number(item?.ts || Date.now())).toISOString(),
    offline: true,
    syncPending: true,
    syncError: String(item?.lastError || '')
  };
}

export async function listQueuedSales() {
  const activeTenantId = (() => {
    try { return String(localStorage.getItem('ptSales:tenantId') || 'default'); } catch { return 'default'; }
  })();
  const items = await getAll();
  const seen = new Set();
  const rows = [];
  for (const item of items) {
    if (!isQueuedSaleItem(item)) continue;
    const row = toQueuedSaleRecord(item);
    // #region debug-point B:queued-sales-hydration
    reportTenantQueueSkewDebug({
      hypothesisId: 'B',
      location: 'queuedSales.js:listQueuedSales',
      msg: '[DEBUG] Hydrating queued sale into sales list',
      data: {
        activeTenantId,
        queuedTenantId: String(item?.tenantId || ''),
        queueId: Number(item?.id || 0),
        clientId: String(row?.clientId || ''),
        branchId: String(row?.branchId || ''),
        invoiceSerial: String(row?.invoiceSerial || '')
      }
    });
    // #endregion
    const key = String(row?.clientId || row?.id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}
