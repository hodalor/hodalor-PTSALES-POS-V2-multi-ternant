const STORAGE_KEY = 'ptSales:tenantLimitPayment';

export function savePendingTenantLimitPayment(payload = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload || {}));
  } catch {}
}

export function readPendingTenantLimitPayment() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPendingTenantLimitPayment() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function getTenantLimitPaymentVerificationPayload(search = '', pending = null) {
  const ctx = pending || readPendingTenantLimitPayment();
  if (!ctx?.provider || !ctx?.txRef) return null;
  const params = new URLSearchParams(String(search || ''));
  if (ctx.provider === 'paypal') {
    const orderId = params.get('token') || '';
    if (!orderId) return null;
    return { provider: 'paypal', orderId, txRef: ctx.txRef };
  }
  if (ctx.provider === 'paystack') {
    const reference = params.get('reference') || params.get('trxref') || '';
    if (!reference) return null;
    return { provider: 'paystack', reference, txRef: ctx.txRef };
  }
  const transactionToken = params.get('TransactionToken') || params.get('TransID') || '';
  const txRef = params.get('CompanyRef') || params.get('companyRef') || ctx.txRef || '';
  if (!transactionToken || !txRef) return null;
  return { provider: 'dpo_pay', transactionToken, txRef };
}

export function clearTenantLimitPaymentUrlQuery() {
  try {
    const url = new URL(window.location.href);
    ['token', 'reference', 'trxref', 'TransactionToken', 'TransID', 'CompanyRef', 'companyRef', 'PnrID'].forEach((key) => {
      url.searchParams.delete(key);
    });
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  } catch {}
}
