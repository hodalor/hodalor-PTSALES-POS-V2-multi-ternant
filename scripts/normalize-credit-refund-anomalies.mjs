import 'dotenv/config';
import { getTenantConnection } from '../src/config/tenancy.js';
import { modelFor as refundModelFor } from '../src/models/RefundRequest.js';
import { modelFor as saleModelFor } from '../src/models/Sale.js';
import { modelFor as creditSaleModelFor } from '../src/models/CreditSale.js';
import { modelFor as auditModelFor } from '../src/models/Audit.js';

const argv = new Map(process.argv.slice(2).map((arg) => {
  const [k, v = 'true'] = String(arg || '').split('=');
  return [k, v];
}));

const APPLY = argv.has('--apply');
const TENANTS = String(argv.get('--tenants') || 'EBK,TPK').split(',').map((x) => x.trim()).filter(Boolean);
const FROM = new Date(String(argv.get('--from') || '2026-07-25T00:00:00.000Z'));
const TO = new Date(String(argv.get('--to') || '2026-07-27T23:59:59.999Z'));

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function getRefundableSaleAmount(sale = {}) {
  return Math.max(0, Number(sale?.total || 0) - Math.max(0, Number(sale?.tax || 0)));
}

function isCreditSaleLike(sale = {}, creditSale = null) {
  const creditMode = String(sale?.creditMode || '').trim().toLowerCase();
  return !!(creditSale || (creditMode && creditMode !== 'none' && creditMode !== 'non_credit') || String(sale?.creditSaleId || '').trim());
}

function buildSettlement({ virtualTotal, virtualPaid, requestedAmount }) {
  const returnedValue = roundMoney(Math.min(Math.max(0, Number(requestedAmount || 0)), Math.max(0, Number(virtualTotal || 0))));
  const revisedCreditTotal = roundMoney(Math.max(0, Number(virtualTotal || 0) - returnedValue));
  const cashRefundAmount = roundMoney(Math.max(0, Number(virtualPaid || 0) - revisedCreditTotal));
  const revisedAmountPaid = roundMoney(Math.max(0, Number(virtualPaid || 0) - cashRefundAmount));
  const revisedCreditBalance = roundMoney(Math.max(0, revisedCreditTotal - revisedAmountPaid));
  const creditReliefAmount = roundMoney(Math.max(0, returnedValue - cashRefundAmount));
  const settlementMode = cashRefundAmount > 0 && creditReliefAmount > 0
    ? 'mixed'
    : (cashRefundAmount > 0 ? 'cash_refund' : 'credit_relief');
  return {
    returnedValue,
    cashRefundAmount,
    creditReliefAmount,
    revisedCreditTotal,
    revisedAmountPaid,
    revisedCreditBalance,
    settlementMode
  };
}

async function main() {
  const reports = [];
  for (const tenantId of TENANTS) {
    const conn = await getTenantConnection(tenantId);
    const RefundRequest = refundModelFor(conn);
    const Sale = saleModelFor(conn);
    const CreditSale = creditSaleModelFor(conn);
    const Audit = auditModelFor(conn);

    const refunds = await RefundRequest.find({
      status: 'approved',
      approved_at: { $gte: FROM, $lte: TO }
    }).sort({ approved_at: 1, created_at: 1 }).exec();

    const saleIds = Array.from(new Set(refunds.map((row) => String(row?.saleId || '')).filter(Boolean)));
    const sales = await Sale.find({ _id: { $in: saleIds } }).exec();
    const saleById = new Map(sales.map((row) => [String(row._id), row]));
    const creditSales = await CreditSale.find({ saleId: { $in: saleIds } }).exec();
    const creditSaleBySaleId = new Map(creditSales.map((row) => [String(row.saleId || ''), row]));
    const negativeSales = await Sale.find({
      created_at: { $gte: FROM, $lte: TO },
      total: { $lt: 0 }
    }).sort({ created_at: 1 }).exec();

    const groupedRefunds = new Map();
    for (const refund of refunds) {
      const key = String(refund?.saleId || '');
      if (!groupedRefunds.has(key)) groupedRefunds.set(key, []);
      groupedRefunds.get(key).push(refund);
    }

    for (const [saleId, rows] of groupedRefunds.entries()) {
      const sale = saleById.get(saleId);
      const creditSale = creditSaleBySaleId.get(saleId) || null;
      if (!sale || !isCreditSaleLike(sale, creditSale)) continue;

      const invoiceKey = String(sale.invoiceSerial || sale.receiptNumber || '').trim();
      const candidateNegativeSales = negativeSales.filter((row) => String(row?.items?.[0]?.name || '').includes(invoiceKey));

      let virtualTotal = roundMoney(Math.max(0, Number(creditSale?.total_amount ?? sale?.total ?? 0)));
      let virtualPaid = roundMoney(Math.max(0, Number(creditSale?.amount_paid ?? sale?.creditAmountPaidNow ?? 0)));
      const rowReports = [];

      for (let index = 0; index < rows.length; index += 1) {
        const refund = rows[index];
        const settlement = buildSettlement({
          virtualTotal,
          virtualPaid,
          requestedAmount: refund.requestedAmount
        });
        const candidateNegativeSale = candidateNegativeSales[index] || null;
        rowReports.push({
          refundId: String(refund._id),
          invoiceSerial: sale.invoiceSerial || '',
          approvedAt: refund.approved_at,
          requestedAmount: roundMoney(refund.requestedAmount),
          settlement,
          negativeSaleId: candidateNegativeSale ? String(candidateNegativeSale._id) : '',
          negativeSaleTotal: candidateNegativeSale ? roundMoney(candidateNegativeSale.total) : 0
        });

        if (APPLY) {
          refund.settlementMode = settlement.settlementMode;
          refund.cashRefundAmount = settlement.cashRefundAmount;
          refund.creditReliefAmount = settlement.creditReliefAmount;
          refund.revisedCreditTotal = settlement.revisedCreditTotal;
          refund.revisedCreditBalance = settlement.revisedCreditBalance;
          refund.creditSaleId = creditSale ? String(creditSale._id || '') : '';

          if (candidateNegativeSale) {
            if (settlement.cashRefundAmount <= 0) {
              await candidateNegativeSale.deleteOne();
              refund.refundSaleId = '';
            } else {
              candidateNegativeSale.subtotal = -settlement.cashRefundAmount;
              candidateNegativeSale.total = -settlement.cashRefundAmount;
              candidateNegativeSale.profitTotal = -settlement.cashRefundAmount;
              candidateNegativeSale.payment_methods = [{ type: 'refund', amount: -settlement.cashRefundAmount }];
              if (Array.isArray(candidateNegativeSale.items) && candidateNegativeSale.items[0]) {
                candidateNegativeSale.items[0].price = -settlement.cashRefundAmount;
              }
              await candidateNegativeSale.save();
              refund.refundSaleId = String(candidateNegativeSale._id || '');
            }
          }
          await refund.save();
        }

        virtualTotal = settlement.revisedCreditTotal;
        virtualPaid = settlement.revisedAmountPaid;
      }

      if (APPLY && creditSale) {
        creditSale.total_amount = virtualTotal;
        creditSale.amount_paid = virtualPaid;
        creditSale.balance = roundMoney(Math.max(0, virtualTotal - virtualPaid));
        creditSale.accumulated_penalty = 0;
        creditSale.overdue_days = 0;
        creditSale.status = creditSale.balance <= 0 ? 'completed' : 'active';
        await creditSale.save();

        sale.creditBalance = creditSale.balance;
        await sale.save();

        await Audit.create({
          actor: 'script:normalize-credit-refund-anomalies',
          actionType: 'credit_refund_financial_normalized',
          details: {
            saleId: String(sale._id),
            invoiceSerial: sale.invoiceSerial || '',
            finalCreditTotal: creditSale.total_amount,
            finalCreditBalance: creditSale.balance,
            refundCount: rows.length
          },
          branchId: sale.branchId || ''
        });
      }

      reports.push({
        tenantId,
        saleId,
        invoiceSerial: sale.invoiceSerial || '',
        originalCreditTotal: roundMoney(creditSale?.total_amount ?? sale?.total ?? 0),
        originalCollected: roundMoney(creditSale?.amount_paid ?? sale?.creditAmountPaidNow ?? 0),
        rows: rowReports,
        finalCreditTotal: virtualTotal,
        finalCreditBalance: roundMoney(Math.max(0, virtualTotal - virtualPaid))
      });
    }
  }

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    tenants: TENANTS,
    from: FROM,
    to: TO,
    safety: {
      stockUntouched: true,
      financialOnly: true,
      creditStatusAdjusted: true
    },
    reportCount: reports.length,
    reports
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
