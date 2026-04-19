const KEY = 'ptSales:state';

export function getTenantStateKey(explicitTenantId) {
  const tenantId = String(explicitTenantId || localStorage.getItem('ptSales:tenantId') || 'default').trim() || 'default';
  return `${KEY}:${tenantId}`;
}

export function loadState() {
  try {
    try {
      if (localStorage.getItem(KEY)) localStorage.removeItem(KEY);
    } catch {}
    const raw = localStorage.getItem(getTenantStateKey());
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const expectedTenantId = String(localStorage.getItem('ptSales:tenantId') || 'default').trim() || 'default';
    const snapshotTenantId = String(parsed?.__meta?.tenantId || parsed?.auth?.user?.tenantId || '').trim();
    if (snapshotTenantId && snapshotTenantId !== expectedTenantId) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveState(state) {
  try {
    const tenantId = String(state?.auth?.user?.tenantId || localStorage.getItem('ptSales:tenantId') || 'default').trim() || 'default';
    const snapshot = {
      __meta: {
        tenantId,
        userName: String(state?.auth?.user?.name || ''),
        savedAt: new Date().toISOString()
      },
      auth: state.auth,
      settings: state.settings
    };
    localStorage.setItem(getTenantStateKey(tenantId), JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export function clearTenantState(tenantId) {
  try {
    localStorage.removeItem(getTenantStateKey(tenantId));
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
