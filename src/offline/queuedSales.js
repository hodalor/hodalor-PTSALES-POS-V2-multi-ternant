import { getAll } from './queue';

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
    invoiceSerial: tempRef,
    receiptNumber: tempRef,
    created_at: body?.created_at || new Date(Number(item?.ts || Date.now())).toISOString(),
    offline: true,
    syncPending: true,
    syncError: String(item?.lastError || '')
  };
}

export async function listQueuedSales() {
  const items = await getAll();
  const seen = new Set();
  const rows = [];
  for (const item of items) {
    if (!isQueuedSaleItem(item)) continue;
    const row = toQueuedSaleRecord(item);
    const key = String(row?.clientId || row?.id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}
