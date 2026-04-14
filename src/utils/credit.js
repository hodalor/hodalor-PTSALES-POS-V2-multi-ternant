import CreditSale from '../models/CreditSale.js';
import CreditRepayment from '../models/CreditRepayment.js';
import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';

export function customerRankFromScore(score = 100) {
  if (score >= 90) return 'Platinum';
  if (score >= 75) return 'Gold';
  if (score >= 60) return 'Silver';
  return 'Bronze';
}

export function computeCreditStatus(doc, now = new Date()) {
  const total = Math.max(0, Number(doc?.total_amount || 0));
  const paid = Math.max(0, Number(doc?.amount_paid || 0));
  const balance = Math.max(0, total - paid);
  const dueAt = doc?.due_date ? new Date(doc.due_date) : now;
  const overdueDays = balance > 0 && dueAt.getTime() < now.getTime()
    ? Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / 86400000))
    : 0;
  const penaltyPerDay = Math.max(0, Number(doc?.penalty_per_day || 0));
  const accumulatedPenalty = overdueDays * penaltyPerDay;
  let status = 'active';
  if (balance <= 0) status = 'completed';
  else if (overdueDays > 0) status = 'overdue';
  return {
    balance,
    overdueDays,
    accumulatedPenalty,
    status
  };
}

export async function refreshCreditSaleStatus(creditSale) {
  if (!creditSale) return null;
  const next = computeCreditStatus(creditSale);
  creditSale.balance = next.balance;
  creditSale.overdue_days = next.overdueDays;
  creditSale.accumulated_penalty = next.accumulatedPenalty;
  creditSale.status = next.status;
  await creditSale.save();
  return creditSale;
}

export async function updateCustomerCreditMetrics(customerId) {
  const customerKey = String(customerId || '');
  if (!customerKey) return null;
  const creditSales = await CreditSale.find({ customer_id: customerKey }).sort({ createdAt: -1 });
  const repayments = await CreditRepayment.find({ customerId: customerKey, status: 'approved' }).sort({ createdAt: -1 });
  const sales = await Sale.find({ customerId: customerKey }).sort({ created_at: -1 }).limit(100);
  let totalCreditPurchases = 0;
  let totalCreditPaid = 0;
  let outstandingBalance = 0;
  let overdueDays = 0;
  let onTimePayments = 0;
  let latePayments = 0;
  for (const doc of creditSales) {
    const current = computeCreditStatus(doc);
    totalCreditPurchases += Number(doc.total_amount || 0);
    outstandingBalance += Number(current.balance || 0);
    overdueDays += Number(current.overdueDays || 0);
    if (current.status === 'completed') {
      if (current.overdueDays > 0) latePayments += 1;
      else onTimePayments += 1;
    } else if (current.status === 'overdue') {
      latePayments += 1;
    }
  }
  for (const doc of repayments) {
    totalCreditPaid += Number(doc.amount || 0);
  }
  const scoreBase = 100 + (onTimePayments * 5) - (latePayments * 10) - Math.min(overdueDays, 30);
  const creditScore = Math.max(0, Math.min(100, scoreBase));
  const creditRank = customerRankFromScore(creditScore);
  const updated = await Customer.findByIdAndUpdate(
    customerKey,
    {
      $set: {
        totalCreditPurchases,
        totalCreditPaid,
        outstandingBalance,
        overdueDays,
        onTimePayments,
        latePayments,
        creditScore,
        creditRank
      }
    },
    { new: true }
  );
  return {
    customer: updated,
    creditSales,
    repayments,
    sales,
    summary: {
      totalCreditPurchases,
      totalCreditPaid,
      outstandingBalance,
      overdueDays,
      onTimePayments,
      latePayments,
      creditScore,
      creditRank
    }
  };
}
