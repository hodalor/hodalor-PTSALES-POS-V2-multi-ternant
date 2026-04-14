const KEY = 'ptSales:state';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
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
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}
