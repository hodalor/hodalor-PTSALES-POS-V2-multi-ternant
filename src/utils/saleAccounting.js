function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function toDate(value) {
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function isCreditSale(sale) {
  return String(sale?.creditMode || 'none') !== 'none'
    || !!String(sale?.creditSaleId || '').trim()
    || toNumber(sale?.creditBalance) > 0
    || toNumber(sale?.outstandingBalance) > 0
    || !!sale?.creditDueDate;
}

export function getSaleSettlementStatus(sale) {
  return String(sale?.settlementStatus || '').trim().toLowerCase() === 'incomplete'
    ? 'incomplete'
    : (isCreditSale(sale) && (toNumber(sale?.outstandingTotal) > 0 || toNumber(sale?.outstandingBalance) > 0) ? 'incomplete' : 'completed');
}

export function getCreditModeLabel(sale) {
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
