import { loadState } from '../store/persist';

const LS_KEY = 'apiBaseUrl';

function sanitizeClientErrorMessage(input, fallback = 'Request failed. Please try again.') {
  const raw = String(input || '').trim();
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower.includes('err_network_changed') || lower.includes('network changed')) {
    return 'Network connection changed. Please check your internet and try again.';
  }
  if (lower.includes('failed to fetch') || lower.includes('load failed') || lower.includes('networkerror')) {
    return 'Unable to reach the server. Please check your internet connection and try again.';
  }
  if (
    lower.includes('getaddrinfo') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('mongodb') ||
    lower.includes('mongo') ||
    lower.includes('srv') ||
    lower.includes('server selection') ||
    lower.includes('timed out after') ||
    lower.includes('topology')
  ) {
    return 'Service temporarily unavailable. Please try again shortly.';
  }
  return raw;
}

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
    const st = loadState();
    if (st) {
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
    throw new Error(sanitizeClientErrorMessage(e?.message || e, 'Unable to reach the server. Please try again.'));
  } finally {
    if (tid) clearTimeout(tid);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsedBody = null;
    let parsedError = '';
    try {
      const obj = JSON.parse(text);
      parsedBody = obj;
      if (obj && typeof obj === 'object' && obj.error) parsedError = String(obj.error);
    } catch {}
    const err = new Error(sanitizeClientErrorMessage(parsedError || text || `HTTP ${res.status}`, `Request failed (HTTP ${res.status})`));
    err.status = res.status;
    err.data = parsedBody;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}
