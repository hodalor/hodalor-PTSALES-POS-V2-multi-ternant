import { isCreditSale } from './saleAccounting';

export function parseCreditLimit(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function customerHasCreditLimit(customer) {
  return parseCreditLimit(customer?.maxCreditLimit) > 0;
}

export function getSaleOutstandingBalance(sale) {
  const outstanding = Number(
    sale?.outstandingTotal
    ?? sale?.outstandingBalance
    ?? sale?.creditBalance
    ?? 0
  );
  return Number.isFinite(outstanding) ? Math.max(0, outstanding) : 0;
}

export function getCustomerOutstandingFromSales(sales = [], customer) {
  if (!customer) return 0;
  const sid = String(customer.id || customer._id || '').trim();
  const sc = String(customer.customerCode || '').trim();
  if (!sid && !sc) return 0;
  return (Array.isArray(sales) ? sales : []).reduce((sum, sale) => {
    const sameCustomer = String(sale?.customerId || '') === sid
      || (sc && String(sale?.customerCode || '') === sc);
    if (!sameCustomer || !isCreditSale(sale)) return sum;
    return sum + getSaleOutstandingBalance(sale);
  }, 0);
}

export function getLiveCustomerOutstanding(customer, sales = []) {
  const stored = Math.max(0, Number(customer?.outstandingBalance || 0) || 0);
  const fromSales = getCustomerOutstandingFromSales(sales, customer);
  return Math.max(stored, fromSales);
}

export function getCustomerCreditRemaining(customer, sales = []) {
  const limit = parseCreditLimit(customer?.maxCreditLimit);
  if (!(limit > 0)) return 0;
  return Math.max(0, limit - getLiveCustomerOutstanding(customer, sales));
}

export function evaluateCustomerCreditSale({
  settings,
  customer,
  outstanding,
  requestedBalance
} = {}) {
  const enforce = !!settings?.enforceCustomerCreditLimits;
  const limit = parseCreditLimit(customer?.maxCreditLimit);
  const used = Math.max(0, Number(outstanding || 0) || 0);
  const remaining = limit > 0 ? Math.max(0, limit - used) : 0;
  const requested = Math.max(0, Number(requestedBalance || 0) || 0);
  if (!enforce) {
    return { ok: true, enforce: false, limit, remaining, used, missingLimit: !(limit > 0) };
  }
  if (!(limit > 0)) {
    return {
      ok: false,
      enforce: true,
      limit: 0,
      remaining: 0,
      used,
      missingLimit: true,
      reason: 'Credit sales are only allowed for customers with a credit limit set.'
    };
  }
  if (requested - remaining > 0.005) {
    return {
      ok: false,
      enforce: true,
      limit,
      remaining,
      used,
      missingLimit: false,
      reason: `This sale exceeds the remaining credit of ${remaining.toFixed(2)}. Limit ${limit.toFixed(2)}, already used ${used.toFixed(2)}.`
    };
  }
  return { ok: true, enforce: true, limit, remaining, used, missingLimit: false };
}
