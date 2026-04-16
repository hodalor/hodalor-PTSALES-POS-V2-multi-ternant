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
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function saveState(state) {
  try {
    const snapshot = {
      auth: state.auth,
      cart: state.cart,
      settings: state.settings,
      branches: state.branches,
      products: state.products,
      users: state.users,
      sales: state.sales,
      audit: state.audit,
      sessions: state.sessions,
      invoices: state.invoices
    };
    localStorage.setItem(getTenantStateKey(state?.auth?.user?.tenantId), JSON.stringify(snapshot));
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
