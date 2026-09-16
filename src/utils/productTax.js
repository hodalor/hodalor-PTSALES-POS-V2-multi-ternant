function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export const TAX_PRICE_TIERS = ['retail', 'wholesale', 'warehouse', 'agent'];

export function getTierTaxFieldNames(tier = 'retail') {
  const normalizedTier = TAX_PRICE_TIERS.includes(String(tier || '').toLowerCase())
    ? String(tier || '').toLowerCase()
    : 'retail';
  return {
    taxRatePercentField: `${normalizedTier}TaxRatePercent`,
    taxAmountField: `${normalizedTier}TaxAmount`
  };
}

export function getTierSalePrice(source = {}, tier = 'retail') {
  const normalizedTier = String(tier || 'retail').toLowerCase();
  if (normalizedTier === 'wholesale') return Math.max(0, toNumber(source?.wholesalePrice, toNumber(source?.retailPrice ?? source?.price, 0)));
  if (normalizedTier === 'warehouse') return Math.max(0, toNumber(source?.warehousePrice, 0));
  if (normalizedTier === 'agent') return Math.max(0, toNumber(source?.agentPrice, toNumber(source?.wholesalePrice ?? source?.retailPrice ?? source?.price, 0)));
  return Math.max(0, toNumber(source?.retailPrice ?? source?.price, 0));
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

export function normalizeTaxRatePercent(value) {
  return roundTo(Math.max(0, Math.min(100, toNumber(value, 0))), 4);
}

export function normalizeTaxAmount(value) {
  return roundTo(Math.max(0, toNumber(value, 0)), 2);
}

export function calculateTaxAmountFromPercent(taxRatePercent, salePrice) {
  const rate = normalizeTaxRatePercent(taxRatePercent);
  const price = Math.max(0, toNumber(salePrice, 0));
  return normalizeTaxAmount((price * rate) / 100);
}

export function calculateTaxPercentFromAmount(taxAmount, salePrice) {
  const amount = normalizeTaxAmount(taxAmount);
  const price = Math.max(0, toNumber(salePrice, 0));
  if (price <= 0 || amount <= 0) return 0;
  return normalizeTaxRatePercent((amount / price) * 100);
}

export function normalizeStoredTax({ taxRatePercent = 0, taxAmount = 0, salePrice = 0 } = {}) {
  const normalizedRate = normalizeTaxRatePercent(taxRatePercent);
  if (normalizedRate > 0) {
    return {
      taxRatePercent: normalizedRate,
      taxAmount: calculateTaxAmountFromPercent(normalizedRate, salePrice)
    };
  }
  const normalizedAmount = normalizeTaxAmount(taxAmount);
  return {
    taxRatePercent: calculateTaxPercentFromAmount(normalizedAmount, salePrice),
    taxAmount: normalizedAmount
  };
}

export function normalizeTierTaxForPrice(source = {}, tier = 'retail', salePrice = 0) {
  const { taxRatePercentField, taxAmountField } = getTierTaxFieldNames(tier);
  return normalizeStoredTax({
    taxRatePercent: source?.[taxRatePercentField] ?? source?.taxRatePercent,
    taxAmount: source?.[taxAmountField] ?? source?.taxAmount,
    salePrice
  });
}

export function normalizeTaxConfig(source = {}, priceByTier = {}) {
  const next = {};
  TAX_PRICE_TIERS.forEach((tier) => {
    const tierPrice = priceByTier?.[tier] ?? getTierSalePrice(source, tier);
    const normalized = normalizeTierTaxForPrice(source, tier, tierPrice);
    const { taxRatePercentField, taxAmountField } = getTierTaxFieldNames(tier);
    next[taxRatePercentField] = normalized.taxRatePercent;
    next[taxAmountField] = normalized.taxAmount;
  });
  next.taxRatePercent = next.retailTaxRatePercent;
  next.taxAmount = next.retailTaxAmount;
  return next;
}

export function computeItemTaxAmount(item = {}) {
  const quantity = Math.max(0, toNumber(item?.quantity ?? item?.qty, 0));
  const unitPrice = Math.max(0, toNumber(item?.price, 0));
  const normalizedTax = normalizeTierTaxForPrice(item, item?.priceTier || 'retail', unitPrice);
  return normalizeTaxAmount(normalizedTax.taxAmount * quantity);
}

export function computeSaleTaxTotals({ items = [], discount = 0, overrideTaxRatePercent = null } = {}) {
  const subtotal = roundTo((Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + (Math.max(0, toNumber(item?.price, 0)) * Math.max(0, toNumber(item?.quantity ?? item?.qty, 0)))
  ), 0), 2);
  const boundedDiscount = roundTo(Math.min(subtotal, Math.max(0, toNumber(discount, 0))), 2);
  const hasOverride = overrideTaxRatePercent !== null && overrideTaxRatePercent !== undefined && String(overrideTaxRatePercent).trim() !== '';
  let tax = 0;
  if (hasOverride) {
    const overrideRate = normalizeTaxRatePercent(overrideTaxRatePercent);
    tax = roundTo((Math.max(0, subtotal - boundedDiscount) * overrideRate) / 100, 2);
  } else {
    const itemTax = roundTo((Array.isArray(items) ? items : []).reduce((sum, item) => sum + computeItemTaxAmount(item), 0), 2);
    const discountFactor = subtotal > 0 ? Math.max(0, Math.min(1, boundedDiscount / subtotal)) : 0;
    tax = roundTo(itemTax * (1 - discountFactor), 2);
  }
  const total = roundTo(Math.max(0, subtotal - boundedDiscount + tax), 2);
  return {
    subtotal,
    discount: boundedDiscount,
    tax,
    total
  };
}
