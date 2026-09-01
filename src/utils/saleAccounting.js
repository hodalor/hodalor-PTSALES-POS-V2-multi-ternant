function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function toDate(value) {
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isDateInRange(value, fromDate = null, endDate = null) {
  const dt = toDate(value);
  if (!dt) return false;
  if (fromDate && dt.getTime() < fromDate.getTime()) return false;
  if (endDate && dt.getTime() > endDate.getTime()) return false;
  return true;
}

function getSaleKey(sale) {
  return String(sale?.id || sale?._id || sale?.clientId || '').trim();
}

export function isCreditSale(sale) {
  const creditMode = String(sale?.creditMode || 'none').trim().toLowerCase();
  return (creditMode && creditMode !== 'none' && creditMode !== 'non_credit')
    || !!String(sale?.creditSaleId || '').trim()
    || toNumber(sale?.creditBalance) > 0
    || toNumber(sale?.outstandingBalance) > 0
    || !!sale?.creditDueDate;
}

export function getSaleActivityType(sale) {
  const saleType = String(sale?.posType || sale?.inventoryType || 'retail').trim().toLowerCase();
  const creditMode = String(sale?.creditMode || '').trim().toLowerCase();
  if (creditMode === 'retail_easybuy') return 'retail_credit';
  if (creditMode === 'distribution_credit') {
    if (saleType === 'warehouse') return 'warehouse_credit';
    return 'wholesale_credit';
  }
  if (isCreditSale(sale)) {
    if (saleType === 'warehouse') return 'warehouse_credit';
    return saleType === 'wholesale' ? 'wholesale_credit' : 'retail_credit';
  }
  if (saleType === 'warehouse') return 'warehouse_sales';
  return saleType === 'wholesale' ? 'wholesale_sales' : 'retail_sales';
}

export function getSaleSettlementStatus(sale) {
  return String(sale?.settlementStatus || '').trim().toLowerCase() === 'incomplete'
    ? 'incomplete'
    : (isCreditSale(sale) && (toNumber(sale?.outstandingTotal) > 0 || toNumber(sale?.outstandingBalance) > 0) ? 'incomplete' : 'completed');
}

export function getCreditModeLabel(sale) {
  const packageName = String(sale?.creditPackageName || sale?.creditSale?.creditPackageName || '').trim();
  if (packageName) {
    if (String(packageName).toLowerCase() === 'easybuy' && String(sale?.creditMode || '').trim().toLowerCase() === 'retail_easybuy') {
      return 'Credit';
    }
    return packageName;
  }
  const mode = String(sale?.creditMode || '').trim().toLowerCase();
  if (mode === 'retail_easybuy') return 'Credit';
  if (mode === 'distribution_credit') return 'Credit Sale';
  if (isCreditSale(sale)) return String(sale?.posType || 'retail') === 'retail' ? 'Credit' : 'Credit Sale';
  return 'Non Credit';
}

export function getSalePaymentTimeline(sale) {
  const timeline = Array.isArray(sale?.paymentTimeline) ? sale.paymentTimeline : [];
  if (timeline.length > 0) return timeline;
  const paidAt = toDate(sale?.created_at) || new Date();
  if (isCreditSale(sale)) {
    const total = Math.max(0, toNumber(sale?.total));
    const upfront = Math.max(0, Math.min(total, toNumber(sale?.creditAmountPaidNow)));
    const costTotal = Math.max(0, toNumber(sale?.costTotal));
    if (upfront <= 0) return [];
    return [{
      source: 'credit_upfront',
      amount: upfront,
      principalAmount: upfront,
      penaltyAmount: 0,
      recognizedCost: Math.min(costTotal, upfront),
      recognizedProfit: Math.max(0, upfront - costTotal),
      paidAt
    }];
  }
  return [{
    source: 'sale',
    amount: toNumber(sale?.total),
    principalAmount: toNumber(sale?.total),
    penaltyAmount: 0,
    recognizedCost: toNumber(sale?.costTotal),
    recognizedProfit: toNumber(sale?.profitTotal),
    paidAt
  }];
}

export function getSaleRangeTotals(sale, fromDate = null, endDate = null) {
  const timeline = getSalePaymentTimeline(sale);
  return timeline.reduce((acc, row) => {
    const paidAt = toDate(row?.paidAt);
    if (!paidAt) return acc;
    if (fromDate && paidAt.getTime() < fromDate.getTime()) return acc;
    if (endDate && paidAt.getTime() > endDate.getTime()) return acc;
    acc.revenue += toNumber(row?.amount);
    acc.profit += toNumber(row?.recognizedProfit);
    acc.cost += toNumber(row?.recognizedCost);
    acc.payments += 1;
    return acc;
  }, { revenue: 0, profit: 0, cost: 0, payments: 0 });
}

export function saleHasActivityInRange(sale, fromDate = null, endDate = null) {
  const saleDate = toDate(sale?.created_at);
  if (saleDate) {
    const inSaleRange = (!fromDate || saleDate.getTime() >= fromDate.getTime()) && (!endDate || saleDate.getTime() <= endDate.getTime());
    if (inSaleRange) return true;
  }
  return getSalePaymentTimeline(sale).some((row) => {
    const paidAt = toDate(row?.paidAt);
    if (!paidAt) return false;
    if (fromDate && paidAt.getTime() < fromDate.getTime()) return false;
    if (endDate && paidAt.getTime() > endDate.getTime()) return false;
    return true;
  });
}

export function getRefundEventDate(refund) {
  return refund?.approved_at || refund?.approvedAt || refund?.created_at || refund?.createdAt || null;
}

export function getRefundReturnedValue(refund, originalSale = null) {
  const requested = Math.abs(toNumber(refund?.requestedAmount));
  if (requested > 0) return requested;
  if (String(refund?.type || '').trim().toLowerCase() === 'full') {
    return Math.max(0, toNumber(originalSale?.total));
  }
  return 0;
}

export function getRefundCashImpact(refund, originalSale = null) {
  const explicit = Math.abs(toNumber(refund?.cashRefundAmount));
  const settlementMode = String(refund?.settlementMode || '').trim().toLowerCase();
  if (explicit > 0 || ['cash_refund', 'credit_relief', 'mixed'].includes(settlementMode)) return explicit;
  const returnedValue = getRefundReturnedValue(refund, originalSale);
  if (!isCreditSale(originalSale)) return returnedValue;
  const collectedToDate = Math.max(0, toNumber(originalSale?.creditSale?.amount_paid ?? originalSale?.creditAmountPaidNow));
  const currentCreditTotal = Math.max(0, toNumber(originalSale?.creditSale?.total_amount ?? originalSale?.total));
  const revisedCreditTotal = Math.max(0, currentCreditTotal - Math.min(returnedValue, currentCreditTotal));
  return Math.max(0, collectedToDate - revisedCreditTotal);
}

export function buildRefundAdjustedSaleMetrics(sales = [], refunds = [], fromDate = null, endDate = null) {
  const saleList = Array.isArray(sales) ? sales : [];
  const saleById = new Map();
  const bySaleId = new Map();
  saleList.forEach((sale) => {
    const saleId = getSaleKey(sale);
    if (!saleId) return;
    const base = getSaleRangeTotals(sale, fromDate, endDate);
    saleById.set(saleId, sale);
    bySaleId.set(saleId, {
      saleId,
      baseRevenue: base.revenue,
      baseProfit: base.profit,
      baseCost: base.cost,
      refundRevenue: 0,
      refundProfit: 0,
      refundCost: 0,
      adjustedRevenue: base.revenue,
      adjustedProfit: base.profit,
      adjustedCost: base.cost
    });
  });
  let approvedRefundAmountInRange = 0;
  for (const refund of Array.isArray(refunds) ? refunds : []) {
    if (String(refund?.status || '').trim().toLowerCase() !== 'approved') continue;
    const originalSale = saleById.get(String(refund?.saleId || '').trim());
    if (!originalSale) continue;
    const saleId = getSaleKey(originalSale);
    const entry = bySaleId.get(saleId);
    if (!entry) continue;
    const refundCashImpact = Math.max(0, getRefundCashImpact(refund, originalSale));
    if (isDateInRange(getRefundEventDate(refund), fromDate, endDate)) {
      approvedRefundAmountInRange += refundCashImpact;
    }
    if (refundCashImpact <= 0) continue;
    const remainingRevenueImpact = Math.max(0, entry.baseRevenue - entry.refundRevenue);
    const appliedRevenueImpact = Math.min(remainingRevenueImpact, refundCashImpact);
    if (appliedRevenueImpact <= 0) continue;
    const refundRatio = entry.baseRevenue > 0
      ? Math.min(1, appliedRevenueImpact / Math.max(0.0001, entry.baseRevenue))
      : 0;
    const remainingProfitImpact = Math.max(0, entry.baseProfit - entry.refundProfit);
    const remainingCostImpact = Math.max(0, entry.baseCost - entry.refundCost);
    const appliedProfitImpact = Math.min(remainingProfitImpact, Math.max(0, entry.baseProfit * refundRatio));
    const appliedCostImpact = Math.min(remainingCostImpact, Math.max(0, entry.baseCost * refundRatio));
    entry.refundRevenue += appliedRevenueImpact;
    entry.refundProfit += appliedProfitImpact;
    entry.refundCost += appliedCostImpact;
    entry.adjustedRevenue = Math.max(0, entry.baseRevenue - entry.refundRevenue);
    entry.adjustedProfit = Math.max(0, entry.baseProfit - entry.refundProfit);
    entry.adjustedCost = Math.max(0, entry.baseCost - entry.refundCost);
  }
  return {
    bySaleId,
    approvedRefundAmountInRange,
    recognizedRefundRevenueImpact: Array.from(bySaleId.values()).reduce((sum, row) => sum + toNumber(row?.refundRevenue), 0)
  };
}
