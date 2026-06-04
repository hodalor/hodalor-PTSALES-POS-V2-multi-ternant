function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function toDate(value) {
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
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
  if (creditMode === 'distribution_credit') return 'wholesale_credit';
  if (isCreditSale(sale)) return saleType === 'wholesale' ? 'wholesale_credit' : 'retail_credit';
  return saleType === 'wholesale' ? 'wholesale_sales' : 'retail_sales';
}

export function getSaleSettlementStatus(sale) {
  return String(sale?.settlementStatus || '').trim().toLowerCase() === 'incomplete'
    ? 'incomplete'
    : (isCreditSale(sale) && (toNumber(sale?.outstandingTotal) > 0 || toNumber(sale?.outstandingBalance) > 0) ? 'incomplete' : 'completed');
}

export function getCreditModeLabel(sale) {
  const packageName = String(sale?.creditPackageName || sale?.creditSale?.creditPackageName || '').trim();
  if (packageName) return packageName;
  const mode = String(sale?.creditMode || '').trim().toLowerCase();
  if (mode === 'retail_easybuy') return 'EasyBuy';
  if (mode === 'distribution_credit') return 'Credit Sale';
  if (isCreditSale(sale)) return String(sale?.posType || 'retail') === 'wholesale' ? 'Credit Sale' : 'EasyBuy';
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
