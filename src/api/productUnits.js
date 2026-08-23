import { fetchJson } from './client';

const CACHE_KEY = 'ptsales:serialized-units-cache:v1';
const REQUEST_CACHE_TTL_MS = 4000;
const listRequestCache = new Map();

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

function readCacheData() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
      scopes: parsed && typeof parsed.scopes === 'object' && parsed.scopes ? parsed.scopes : {}
    };
  } catch {
    return { rows: [], scopes: {} };
  }
}

function readCache() {
  return readCacheData().rows;
}

function readScopeCache() {
  return readCacheData().scopes;
}

function writeCache(rows, scopes = readScopeCache()) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rows: rows.slice(-5000), scopes }));
  } catch {}
}

function getScopeKey(params = {}) {
  return JSON.stringify({
    productId: String(params.productId || ''),
    variantId: String(params.variantId || ''),
    branchId: String(params.branchId || ''),
    inventoryType: String(params.inventoryType || ''),
    status: String(params.status || '')
  });
}

function hasExactScopeCache(params = {}) {
  return !!readScopeCache()?.[getScopeKey(params)];
}

function rowMatchesScope(row, params = {}) {
  if (params.productId && String(row.productId || '') !== String(params.productId)) return false;
  if (params.variantId && String(row.variantId || '') !== String(params.variantId)) return false;
  if (params.branchId && String(row.branchId || '') !== String(params.branchId)) return false;
  if (params.inventoryType && String(row.inventoryType || '') !== String(params.inventoryType)) return false;
  if (params.status === 'available') {
    const status = String(row.status || '');
    const reservationToken = String(params.reservationToken || '');
    return status === 'in_stock' || (status === 'reserved' && reservationToken && String(row.reservationToken || '') === reservationToken);
  }
  if (params.status && String(row.status || '') !== String(params.status)) return false;
  return true;
}

function shouldReconcileScope(params = {}, total = 0) {
  if (params.all) return true;
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.max(1, Number(params.pageSize || 30));
  if (page !== 1) return false;
  if (String(params.query || '').trim()) return false;
  return Math.max(0, Number(total || 0)) <= pageSize;
}

function reconcileScopeRows(params = {}, nextRows = [], total = 0) {
  if (!shouldReconcileScope(params, total)) return readCache();
  const liveIds = new Set((Array.isArray(nextRows) ? nextRows : []).map(row => String(row?._id || '')).filter(Boolean));
  const filteredRows = readCache().filter(row => !rowMatchesScope(row, params) || liveIds.has(String(row?._id || '')));
  const scopes = readScopeCache();
  scopes[getScopeKey(params)] = {
    ts: Date.now(),
    total: Math.max(0, Number(total || 0))
  };
  writeCache(filteredRows, scopes);
  return filteredRows;
}

function findCachedByCode(code = '', params = {}) {
  const normalized = String(code || '').trim();
  if (!normalized) return null;
  return readCache().find(row => {
    if (params.productId && String(row.productId || '') !== String(params.productId)) return false;
    if (params.variantId && String(row.variantId || '') !== String(params.variantId)) return false;
    if (params.branchId && String(row.branchId || '') !== String(params.branchId)) return false;
    if (params.inventoryType && String(row.inventoryType || '') !== String(params.inventoryType)) return false;
    return String(row.imei || '') === normalized || String(row.serialNumber || '') === normalized;
  }) || null;
}

function overlayRows(nextRows = [], params = {}) {
  const reservationToken = String(params.reservationToken || '');
  const cache = new Map(readCache().map(row => [String(row._id), row]));
  const withStatus = (Array.isArray(nextRows) ? nextRows : [])
    .map(row => cache.has(String(row?._id)) ? { ...row, ...cache.get(String(row._id)) } : row)
    .filter(Boolean);
  if (!params.status) return withStatus;
  if (String(params.status) === 'available') {
    return withStatus.filter(row => {
      const status = String(row.status || '');
      return status === 'in_stock' || (status === 'reserved' && reservationToken && String(row.reservationToken || '') === reservationToken);
    });
  }
  return withStatus.filter(row => String(row.status || '') === String(params.status));
}

function mergeRows(nextRows = []) {
  const map = new Map(readCache().map(row => [String(row._id), row]));
  (Array.isArray(nextRows) ? nextRows : []).forEach(row => {
    if (row?._id) map.set(String(row._id), { ...map.get(String(row._id)), ...row });
  });
  const merged = Array.from(map.values()).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  writeCache(merged);
  return merged;
}

function invalidateListRequestCache() {
  listRequestCache.clear();
}

function filterRows(params = {}) {
  const q = String(params.query || '').trim().toLowerCase();
  const reservationToken = String(params.reservationToken || '');
  const page = Math.max(1, Number(params.page || 1));
  const pageSize = Math.max(1, Number(params.pageSize || 30));
  const rows = readCache().filter(row => {
    if (params.productId && String(row.productId || '') !== String(params.productId)) return false;
    if (params.variantId && String(row.variantId || '') !== String(params.variantId)) return false;
    if (params.branchId && String(row.branchId || '') !== String(params.branchId)) return false;
    if (params.inventoryType && String(row.inventoryType || '') !== String(params.inventoryType)) return false;
    if (params.status === 'available') {
      const status = String(row.status || '');
      if (!(status === 'in_stock' || (status === 'reserved' && reservationToken && String(row.reservationToken || '') === reservationToken))) return false;
    } else if (params.status && String(row.status || '') !== String(params.status)) return false;
    if (q) {
      const hay = `${row.imei || ''} ${row.serialNumber || ''} ${row.productName || ''} ${row.productSku || ''} ${row.productBrand || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return {
    rows: rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    total: rows.length
  };
}

export function getCachedProductUnitCount(params = {}) {
  const baseRows = readCache().filter(row => {
    if (params.productId && String(row.productId || '') !== String(params.productId)) return false;
    if (params.variantId && String(row.variantId || '') !== String(params.variantId)) return false;
    if (params.branchId && String(row.branchId || '') !== String(params.branchId)) return false;
    if (params.inventoryType && String(row.inventoryType || '') !== String(params.inventoryType)) return false;
    return true;
  });
  const rows = baseRows.filter(row => {
    if (params.status && String(row.status || '') !== String(params.status)) return false;
    return true;
  });
  return {
    count: rows.length,
    hasCache: baseRows.length > 0 || hasExactScopeCache(params)
  };
}

export function getEffectiveCachedProductUnitCount(params = {}) {
  const reservationToken = String(params.reservationToken || '');
  const baseRows = readCache().filter(row => {
    if (params.productId && String(row.productId || '') !== String(params.productId)) return false;
    if (params.variantId && String(row.variantId || '') !== String(params.variantId)) return false;
    if (params.branchId && String(row.branchId || '') !== String(params.branchId)) return false;
    if (params.inventoryType && String(row.inventoryType || '') !== String(params.inventoryType)) return false;
    return true;
  });
  const rows = baseRows.filter(row => {
    const status = String(row.status || '');
    if (status === 'in_stock') return true;
    if (status === 'reserved' && reservationToken && String(row.reservationToken || '') === reservationToken) return true;
    return false;
  });
  return {
    count: rows.length,
    hasCache: baseRows.length > 0 || hasExactScopeCache({
      productId: params.productId,
      variantId: params.variantId,
      branchId: params.branchId,
      inventoryType: params.inventoryType,
      status: 'available'
    }) || hasExactScopeCache({
      productId: params.productId,
      variantId: params.variantId,
      branchId: params.branchId,
      inventoryType: params.inventoryType,
      status: 'in_stock'
    })
  };
}

export function getCachedProductUnits(params = {}) {
  return filterRows(params);
}

function reserveLocalUnit({ code = '', productId = '', variantId = '', branchId = '', inventoryType = '', reservationToken = '' }) {
  const rows = readCache();
  const match = rows.find(row => {
    if (branchId && String(row.branchId || '') !== String(branchId)) return false;
    if (inventoryType && String(row.inventoryType || '') !== String(inventoryType)) return false;
    if (productId && String(row.productId || '') !== String(productId)) return false;
    if (variantId && String(row.variantId || '') !== String(variantId)) return false;
    if (!['in_stock', 'reserved'].includes(String(row.status || ''))) return false;
    if (code) return String(row.imei || '') === String(code) || String(row.serialNumber || '') === String(code);
    return true;
  });
  if (!match) throw new Error('Serialized unit not available offline');
  if (String(match.status || '') === 'reserved' && match.reservationToken && String(match.reservationToken) !== String(reservationToken || '')) {
    throw new Error('Serialized unit already reserved offline');
  }
  const next = rows.map(row => String(row._id) === String(match._id) ? { ...row, status: 'reserved', reservationToken: String(reservationToken || ''), reservedAt: new Date().toISOString(), offlineCached: true } : row);
  writeCache(next);
  return next.find(row => String(row._id) === String(match._id));
}

function releaseLocalUnits({ unitIds = [], reservationToken = '' }) {
  if (!Array.isArray(unitIds) || unitIds.length === 0) return { count: 0 };
  let count = 0;
  const next = readCache().map(row => {
    if (!unitIds.map(String).includes(String(row._id))) return row;
    if (String(row.status || '') !== 'reserved') return row;
    if (reservationToken && row.reservationToken && String(row.reservationToken) !== String(reservationToken)) return row;
    count += 1;
    return { ...row, status: 'in_stock', reservationToken: '', reservedAt: null, offlineCached: true };
  });
  writeCache(next);
  return { count };
}

export function markSoldProductUnits(unitIds = []) {
  if (!Array.isArray(unitIds) || unitIds.length === 0) return;
  const next = readCache().map(row => unitIds.map(String).includes(String(row._id)) ? { ...row, status: 'sold', reservationToken: '', reservedAt: null, soldAt: new Date().toISOString(), offlineCached: true } : row);
  writeCache(next);
  invalidateListRequestCache();
  // #region debug-point A:frontend-mark-sold-cache
  reportQueuedSalesImeiDebug({
    hypothesisId: 'A',
    location: 'productUnits.js:markSoldProductUnits',
    msg: '[DEBUG] Frontend serialized cache marked units sold locally',
    data: {
      soldUnitIds: unitIds.map(String),
      affectedRows: next.filter((row) => unitIds.map(String).includes(String(row?._id || ''))).map((row) => ({
        unitId: String(row?._id || ''),
        productId: String(row?.productId || ''),
        variantId: String(row?.variantId || ''),
        branchId: String(row?.branchId || ''),
        inventoryType: String(row?.inventoryType || ''),
        status: String(row?.status || '')
      }))
    }
  });
  // #endregion
}

export function listProductUnits(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') return;
    query.set(key, String(value));
  });
  const qs = query.toString() ? `?${query.toString()}` : '';
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return Promise.resolve(filterRows(params));
  }
  const now = Date.now();
  const cached = listRequestCache.get(qs);
  if (cached?.data && cached.expiresAt > now) return Promise.resolve(cached.data);
  if (cached?.promise) return cached.promise;
  const promise = fetchJson(`/api/product-units${qs}`, { timeoutMs: 60000 }).then(result => {
    mergeRows(result?.rows || []);
    reconcileScopeRows(params, result?.rows || [], Number(result?.total || 0));
    const rows = overlayRows(result?.rows || [], params);
    const data = { ...result, rows, total: params.status ? rows.length : Number(result?.total || rows.length) };
    // #region debug-point D:frontend-list-product-units
    reportQueuedSalesImeiDebug({
      hypothesisId: 'D',
      location: 'productUnits.js:listProductUnits:online-result',
      msg: '[DEBUG] Frontend serialized unit list resolved',
      data: {
        productId: String(params?.productId || ''),
        variantId: String(params?.variantId || ''),
        branchId: String(params?.branchId || ''),
        inventoryType: String(params?.inventoryType || ''),
        status: String(params?.status || ''),
        query: String(params?.query || ''),
        reservationToken: String(params?.reservationToken || ''),
        serverRowCount: Array.isArray(result?.rows) ? result.rows.length : 0,
        overlayRowCount: Array.isArray(rows) ? rows.length : 0,
        total: Number(data?.total || 0),
        sample: (Array.isArray(rows) ? rows : []).slice(0, 5).map((row) => ({
          unitId: String(row?._id || ''),
          status: String(row?.status || ''),
          imei: String(row?.imei || ''),
          serialNumber: String(row?.serialNumber || ''),
          branchId: String(row?.branchId || ''),
          inventoryType: String(row?.inventoryType || '')
        }))
      }
    });
    // #endregion
    listRequestCache.set(qs, { data, expiresAt: Date.now() + REQUEST_CACHE_TTL_MS });
    return data;
  }).finally(() => {
    const latest = listRequestCache.get(qs);
    if (latest?.promise) listRequestCache.set(qs, { data: latest.data, expiresAt: latest.expiresAt || 0 });
  });
  listRequestCache.set(qs, { ...cached, promise, expiresAt: now + REQUEST_CACHE_TTL_MS });
  return promise;
}

export function bulkCreateProductUnits(body) {
  return fetchJson('/api/product-units/bulk-create', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 0
  }).then(result => {
    mergeRows(result?.rows || []);
    return result;
  }).finally(() => invalidateListRequestCache());
}

export function reserveProductUnit(body) {
  if (body?.unitId) {
    const rows = readCache();
    const cachedById = rows.find(row => String(row._id) === String(body.unitId));
    if (cachedById && ['sold', 'adjusted_out'].includes(String(cachedById.status || ''))) {
      return Promise.reject(new Error('Serialized unit is no longer available'));
    }
    if (cachedById && String(cachedById.status || '') === 'reserved' && cachedById.reservationToken && String(cachedById.reservationToken) !== String(body?.reservationToken || '')) {
      return Promise.reject(new Error('Serialized unit is already reserved'));
    }
  }
  const cached = findCachedByCode(body?.code || body?.imei || '', body || {});
  if (cached && ['sold', 'adjusted_out'].includes(String(cached.status || ''))) {
    return Promise.reject(new Error('Serialized unit is no longer available'));
  }
  if (cached && String(cached.status || '') === 'reserved' && cached.reservationToken && String(cached.reservationToken) !== String(body?.reservationToken || '')) {
    return Promise.reject(new Error('Serialized unit is already reserved'));
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return Promise.resolve(reserveLocalUnit(body || {}));
  }
  return fetchJson('/api/product-units/reserve', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 30000
  }).then(row => {
    mergeRows([row]);
    return row;
  }).finally(() => invalidateListRequestCache());
}

export function scanProductUnit(body) {
  const code = body?.imei || body?.code || '';
  const cached = findCachedByCode(code, body || {});
  if (cached && ['sold', 'adjusted_out'].includes(String(cached.status || ''))) {
    return Promise.reject(new Error('Serialized unit is already sold or unavailable'));
  }
  if (cached && String(cached.status || '') === 'reserved' && cached.reservationToken && String(cached.reservationToken) !== String(body?.reservationToken || '')) {
    return Promise.reject(new Error('Serialized unit is already reserved'));
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return Promise.resolve(reserveLocalUnit({ ...(body || {}), code: body?.imei || body?.code || '' }));
  }
  return fetchJson('/api/product-units/scan-imei', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 15000
  }).then(row => {
    mergeRows([row]);
    return row;
  }).finally(() => invalidateListRequestCache());
}

export function releaseProductUnits(body) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return Promise.resolve(releaseLocalUnits(body || {}));
  }
  return fetchJson('/api/product-units/release', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 30000
  }).then(result => {
    releaseLocalUnits(body || {});
    return result;
  }).finally(() => invalidateListRequestCache());
}

export function lookupProductUnit(code) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cached = readCache().find(row => String(row.imei || '') === String(code) || String(row.serialNumber || '') === String(code));
    if (!cached) return Promise.reject(new Error('Serialized unit not found offline'));
    return Promise.resolve(cached);
  }
  return fetchJson(`/api/product-units/lookup/${encodeURIComponent(code)}`, { timeoutMs: 30000 }).then(row => {
    mergeRows([row]);
    return overlayRows([row])[0] || row;
  });
}

export function removeManyProductUnits(ids = []) {
  return fetchJson('/api/product-units/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
    timeoutMs: 0
  }).then(result => {
    const set = new Set((Array.isArray(ids) ? ids : []).map(String));
    writeCache(readCache().filter(row => !set.has(String(row._id))));
    invalidateListRequestCache();
    return result;
  });
}
