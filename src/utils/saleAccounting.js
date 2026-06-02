import CreditSale from '../models/CreditSale.js';
import CreditRepayment from '../models/CreditRepayment.js';
import Sale from '../models/Sale.js';

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function toId(value) {
  return String(value || '').trim();
}

function toDate(value) {
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function eventWithinRange(event, start, end) {
  const paidAt = toDate(event?.paidAt);
  if (!paidAt) return false;
  if (start && paidAt.getTime() < start.getTime()) return false;
  if (end && paidAt.getTime() > end.getTime()) return false;
  return true;
}

function sortRepayments(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => {
      const aTs = toDate(a?.approvedAt || a?.createdAt || a?.updatedAt)?.getTime() || 0;
      const bTs = toDate(b?.approvedAt || b?.createdAt || b?.updatedAt)?.getTime() || 0;
      return aTs - bTs;
    });
}

function buildReceiptRepaymentHistory(repayments = []) {
  return sortRepayments(repayments).map((row) => ({
    repaymentId: toId(row?._id),
    amount: Math.max(0, toNumber(row?.amount)),
    paymentMethod: String(row?.paymentMethod || 'cash').trim().toLowerCase() || 'cash',
    remark: String(row?.remark || '').trim(),
    status: String(row?.status || '').trim().toLowerCase() || 'pending_director',
    initiatedAt: toDate(row?.createdAt),
    initiatedByName: String(row?.initiatedByName || '').trim(),
    initiatedByRole: String(row?.initiatedByRole || '').trim(),
    approvedAt: toDate(row?.approvedAt),
    approvedByName: String(row?.approvedByName || '').trim(),
    approvedByRole: String(row?.approvedByRole || '').trim(),
    rejectedAt: toDate(row?.rejectedAt)
  }));
}

export function isCreditSaleRecord(sale) {
  return !!(
    toId(sale?.creditSaleId)
    || toId(sale?.creditMode)
    || toDate(sale?.creditDueDate)
    || toNumber(sale?.creditBalance) > 0
    || toNumber(sale?.creditAmountPaidNow) > 0
  );
}

export function buildSalePaymentTimeline(sale, creditSale = null, repayments = []) {
  const total = Math.max(0, toNumber(sale?.total));
  const costTotal = Math.max(0, toNumber(sale?.costTotal));
  const creditMode = isCreditSaleRecord(sale)
    ? (String(sale?.posType || 'retail') === 'wholesale' ? 'distribution_credit' : 'retail_easybuy')
    : 'non_credit';
  const events = [];
  if (!isCreditSaleRecord(sale)) {
    if (total > 0) {
      events.push({
        source: 'sale',
        amount: total,
        principalAmount: total,
        penaltyAmount: 0,
        recognizedCost: costTotal,
        recognizedProfit: toNumber(sale?.profitTotal || (total - costTotal)),
        paidAt: toDate(sale?.created_at) || toDate(sale?.saleCapturedAt) || toDate(sale?.recordedAt) || new Date(),
        note: 'Sale paid in full on checkout'
      });
    }
    return events;
  }
  const upfront = Math.max(0, Math.min(total, toNumber(sale?.creditAmountPaidNow)));
  let principalRecognized = upfront;
  let costRecognized = total > 0 ? (costTotal * (principalRecognized / total)) : 0;
  if (upfront > 0) {
    events.push({
      source: 'credit_upfront',
      amount: upfront,
      principalAmount: upfront,
      penaltyAmount: 0,
      recognizedCost: costRecognized,
      recognizedProfit: upfront - costRecognized,
      paidAt: toDate(sale?.created_at) || toDate(sale?.saleCapturedAt) || toDate(sale?.recordedAt) || new Date(),
      note: `${creditMode} upfront payment`
    });
  }
  const sortedRepayments = sortRepayments(repayments)
    .filter((row) => String(row?.status || '').toLowerCase() === 'approved');
  for (const repayment of sortedRepayments) {
    const amount = Math.max(0, toNumber(repayment?.amount));
    if (amount <= 0) continue;
    const principalRoom = Math.max(0, total - principalRecognized);
    const principalAmount = Math.min(amount, principalRoom);
    const penaltyAmount = Math.max(0, amount - principalAmount);
    const nextPrincipalRecognized = Math.min(total, principalRecognized + principalAmount);
    const nextCostRecognized = total > 0 ? (costTotal * (nextPrincipalRecognized / total)) : 0;
    const deltaCost = Math.max(0, nextCostRecognized - costRecognized);
    events.push({
      source: 'credit_repayment',
      amount,
      principalAmount,
      penaltyAmount,
      recognizedCost: deltaCost,
      recognizedProfit: amount - deltaCost,
      paidAt: toDate(repayment?.approvedAt || repayment?.createdAt || repayment?.updatedAt) || new Date(),
      note: String(repayment?.remark || '').trim(),
      paymentMethod: String(repayment?.paymentMethod || 'cash').trim().toLowerCase() || 'cash',
      repaymentId: toId(repayment?._id)
    });
    principalRecognized = nextPrincipalRecognized;
    costRecognized = nextCostRecognized;
  }
  return events;
}

export function buildSaleAccountingSnapshot(sale, creditSale = null, repayments = []) {
  const events = buildSalePaymentTimeline(sale, creditSale, repayments);
  const recognizedRevenueTotal = events.reduce((sum, event) => sum + toNumber(event?.amount), 0);
  const recognizedCostTotal = events.reduce((sum, event) => sum + toNumber(event?.recognizedCost), 0);
  const recognizedProfitTotal = events.reduce((sum, event) => sum + toNumber(event?.recognizedProfit), 0);
  const outstandingBalance = Math.max(0, creditSale ? toNumber(creditSale?.balance) : toNumber(sale?.creditBalance));
  const outstandingPenalty = Math.max(0, creditSale ? toNumber(creditSale?.accumulated_penalty) : 0);
  const amountPaidToDate = recognizedRevenueTotal;
  const isCredit = isCreditSaleRecord(sale);
  const settlementStatus = !isCredit || (outstandingBalance <= 0 && outstandingPenalty <= 0) ? 'completed' : 'incomplete';
  return {
    creditMode: isCredit ? (String(sale?.posType || 'retail') === 'wholesale' ? 'distribution_credit' : 'retail_easybuy') : 'non_credit',
    settlementStatus,
    amountPaidToDate,
    outstandingBalance,
    outstandingPenalty,
    outstandingTotal: outstandingBalance + outstandingPenalty,
    recognizedRevenueTotal,
    recognizedCostTotal,
    recognizedProfitTotal,
    paymentTimeline: events
  };
}

export async function enrichSalesWithAccounting(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return [];
  const saleIds = list.map((row) => toId(row?._id || row?.id)).filter(Boolean);
  const creditSales = await CreditSale.find({ saleId: { $in: saleIds } }).lean();
  const creditSaleBySaleId = new Map(creditSales.map((row) => [toId(row?.saleId), row]));
  const creditSaleIds = creditSales.map((row) => toId(row?._id)).filter(Boolean);
  const allRepayments = creditSaleIds.length > 0
    ? await CreditRepayment.find({ creditSaleId: { $in: creditSaleIds } }).lean()
    : [];
  const repaymentsByCreditSaleId = new Map();
  allRepayments.forEach((row) => {
    const key = toId(row?.creditSaleId);
    if (!key) return;
    if (!repaymentsByCreditSaleId.has(key)) repaymentsByCreditSaleId.set(key, []);
    repaymentsByCreditSaleId.get(key).push(row);
  });
  return list.map((row) => {
    const key = toId(row?._id || row?.id);
    const creditSale = creditSaleBySaleId.get(key) || null;
    const repayments = creditSale ? (repaymentsByCreditSaleId.get(toId(creditSale?._id)) || []) : [];
    const approvedRepayments = repayments.filter((item) => String(item?.status || '').toLowerCase() === 'approved');
    return {
      ...row,
      ...buildSaleAccountingSnapshot(row, creditSale, approvedRepayments),
      creditSale: creditSale || row?.creditSale || null,
      repaymentHistory: buildReceiptRepaymentHistory(repayments)
    };
  });
}

export function buildRecognizedDayTotals(rows = [], start, end) {
  const totals = new Map();
  for (const sale of Array.isArray(rows) ? rows : []) {
    const paymentMethods = Array.isArray(sale?.payment_methods) ? sale.payment_methods : [];
    const paymentMethodBreakdown = paymentMethods.reduce((map, row) => {
      const type = String(row?.type || 'cash').trim().toLowerCase() || 'cash';
      if (type === 'easybuy') return map;
      const amount = Math.max(0, toNumber(row?.amount));
      if (amount <= 0) return map;
      map.set(type, (map.get(type) || 0) + amount);
      return map;
    }, new Map());
    const snapshot = buildSaleAccountingSnapshot(sale, sale?.creditSale || null, sale?.approvedRepayments || []);
    const events = Array.isArray(snapshot.paymentTimeline) ? snapshot.paymentTimeline : [];
    events.forEach((event) => {
      if (!eventWithinRange(event, start, end)) return;
      const paidAt = toDate(event?.paidAt);
      if (!paidAt) return;
      const day = paidAt.toISOString().slice(0, 10);
      const branchId = toId(sale?.branchId);
      if (!branchId || !day) return;
      const key = `${branchId}:${day}`;
      if (!totals.has(key)) {
        totals.set(key, {
          branchId,
          date: day,
          total: 0,
          paymentBreakdown: {}
        });
      }
      const row = totals.get(key);
      row.total += Math.max(0, toNumber(event?.amount));
      if (String(event?.source || '') === 'credit_repayment') {
        const paymentMethod = String(event?.paymentMethod || 'cash').trim().toLowerCase() || 'cash';
        row.paymentBreakdown[paymentMethod] = (row.paymentBreakdown[paymentMethod] || 0) + Math.max(0, toNumber(event?.amount));
      } else {
        paymentMethodBreakdown.forEach((amount, paymentMethod) => {
          row.paymentBreakdown[paymentMethod] = (row.paymentBreakdown[paymentMethod] || 0) + amount;
        });
      }
    });
  }
  return totals;
}

export async function listRecognizedSalesTotalsByDay(branchIds = [], start, end) {
  const normalizedBranchIds = Array.from(new Set((Array.isArray(branchIds) ? branchIds : [branchIds]).map(toId).filter(Boolean)));
  if (normalizedBranchIds.length === 0) return new Map();
  const regularRows = await Sale.find({
    branchId: { $in: normalizedBranchIds },
    $or: [
      { created_at: { $gte: start, $lte: end } },
      { creditSaleId: { $exists: true, $ne: '' } }
    ]
  }).lean();
  if (regularRows.length === 0) return new Map();
  const saleIds = regularRows.map((row) => toId(row?._id)).filter(Boolean);
  const creditSales = await CreditSale.find({ saleId: { $in: saleIds } }).lean();
  const creditSalesBySaleId = new Map(creditSales.map((row) => [toId(row?.saleId), row]));
  const creditSaleIds = creditSales.map((row) => toId(row?._id)).filter(Boolean);
  const approvedRepayments = creditSaleIds.length > 0
    ? await CreditRepayment.find({ creditSaleId: { $in: creditSaleIds }, status: 'approved' }).lean()
    : [];
  const repaymentsByCreditSaleId = new Map();
  approvedRepayments.forEach((row) => {
    const key = toId(row?.creditSaleId);
    if (!key) return;
    if (!repaymentsByCreditSaleId.has(key)) repaymentsByCreditSaleId.set(key, []);
    repaymentsByCreditSaleId.get(key).push(row);
  });
  const salesWithCredit = regularRows.map((row) => {
    const creditSale = creditSalesBySaleId.get(toId(row?._id)) || null;
    return {
      ...row,
      creditSale,
      approvedRepayments: creditSale ? (repaymentsByCreditSaleId.get(toId(creditSale?._id)) || []) : []
    };
  });
  return buildRecognizedDayTotals(salesWithCredit, start, end);
}
