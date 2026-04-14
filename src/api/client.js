const LS_KEY = 'apiBaseUrl';

function readJwtPayload(token) {
  try {
    const raw = String(token || '').split('.')[1] || '';
    if (!raw) return null;
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function getApiBase() {
  const fromLs = localStorage.getItem(LS_KEY);
  if (fromLs) return fromLs.replace(/\/+$/,'');
  return process.env.REACT_APP_API_URL || 'http://localhost:4000';
}

export function setApiBase(url) {
  if (url) localStorage.setItem(LS_KEY, url.replace(/\/+$/,''));
}

export async function fetchJson(path, opts = {}) {
  const base = getApiBase();
  let url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const method = (opts.method || 'GET').toUpperCase();
  if (method === 'GET') {
    url += (url.includes('?') ? '&' : '?') + `_=${Date.now()}`;
  }
  const defaultTimeout = method === 'GET' ? 30000 : 180000;
  const timeoutMs = opts.timeoutMs === 0 ? 0 : (Number(opts.timeoutMs) || defaultTimeout);
  const ac = new AbortController();
  const tid = timeoutMs > 0 ? setTimeout(() => { try { ac.abort(); } catch {} }, timeoutMs) : null;
  let roleHeader = {};
  let tokenPayload = null;
  try {
    const token = localStorage.getItem('ptSales:authToken');
    tokenPayload = readJwtPayload(token);
    const tenantId = tokenPayload?.tenantId || localStorage.getItem('ptSales:tenantId') || '';
    if (tenantId) roleHeader['X-Tenant-Id'] = String(tenantId);
    const raw = localStorage.getItem('ptSales:state');
    if (raw) {
      const st = JSON.parse(raw);
      const role = tokenPayload?.role || st?.auth?.role;
      const user = tokenPayload?.name || st?.auth?.user?.name;
      const scopedTenantId = tokenPayload?.tenantId || st?.auth?.user?.tenantId || tenantId || '';
      if (role) roleHeader['X-Role'] = role;
      if (user) roleHeader['X-User'] = user;
      if (scopedTenantId) roleHeader['X-Tenant-Id'] = String(scopedTenantId);
    }
  } catch {}
  let authHeader = {};
  try {
    const token = localStorage.getItem('ptSales:authToken');
    if (token) authHeader['Authorization'] = `Bearer ${token}`;
  } catch {}
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...roleHeader, ...authHeader, ...(opts.headers || {}) },
      cache: 'no-store',
      signal: opts.signal || ac.signal,
      ...opts
    });
  } catch (e) {
    if (tid) clearTimeout(tid);
    if (e && (e.name === 'AbortError' || String(e.message || '').toLowerCase().includes('aborted'))) {
      throw new Error('Request timed out while processing. Refresh to confirm whether the operation completed.');
    }
    throw e;
  } finally {
    if (tid) clearTimeout(tid);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsedError = '';
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object' && obj.error) parsedError = String(obj.error);
    } catch {}
    throw new Error(parsedError || text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}
