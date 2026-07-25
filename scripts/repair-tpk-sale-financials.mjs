import 'dotenv/config';
import mongoose from 'mongoose';
import { getTenantConnection } from '../src/config/tenancy.js';
import { modelFor as SaleModelFor } from '../src/models/Sale.js';
import { modelFor as InvoiceModelFor } from '../src/models/Invoice.js';
import { modelFor as AuditModelFor } from '../src/models/Audit.js';

const DEFAULT_TENANT_ID = 'TPK';
const EPSILON = 0.0001;

function hasFlag(name) {
  return process.argv.includes(name);
}

function getArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return String(process.argv[index + 1]);
  return fallback;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function computeSubtotal(items = []) {
  return roundMoney((Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + (Math.max(0, Number(item?.price || 0)) * Math.max(0, Number(item?.qty || 0)))
  ), 0));
}

function computeCostTotal(items = []) {
  return roundMoney((Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + (Math.max(0, Number(item?.costPrice || 0)) * Math.max(0, Number(item?.qty || 0)))
  ), 0));
}

function computePaymentTotal(paymentMethods = []) {
  return roundMoney((Array.isArray(paymentMethods) ? paymentMethods : []).reduce((sum, row) => (
    sum + Math.max(0, Number(row?.amount || 0))
  ), 0));
}

function inferExpectedSaleTotal(sale) {
  const paymentTotal = computePaymentTotal(sale?.payment_methods);
  const creditTotal = roundMoney(
    Math.max(0, Number(sale?.creditAmountPaidNow || 0))
    + Math.max(0, Number(sale?.creditBalance || 0))
  );
  if (creditTotal > 0) return creditTotal;
  if (paymentTotal > 0) return paymentTotal;
  return 0;
}

function buildFinancials(sale) {
  const subtotal = computeSubtotal(sale?.items);
  const tax = roundMoney(Math.max(0, Number(sale?.tax || 0)));
  const storedDiscount = roundMoney(Math.max(0, Number(sale?.discount || 0)));
  const storedComputedTotal = roundMoney(Math.max(0, subtotal - storedDiscount + tax));
  const expectedTotal = inferExpectedSaleTotal(sale);
  const hasBrokenDiscountedZero = (
    subtotal > 0
    && expectedTotal > 0
    && storedComputedTotal <= 0
    && storedDiscount + EPSILON >= subtotal
  );
  const discount = hasBrokenDiscountedZero
    ? roundMoney(Math.max(0, Math.min(subtotal + tax, subtotal + tax - expectedTotal)))
    : storedDiscount;
  const total = roundMoney(Math.max(0, subtotal - discount + tax));
  const costTotal = computeCostTotal(sale?.items);
  const profitTotal = roundMoney(total - costTotal);
  return {
    subtotal,
    discount,
    tax,
    total,
    costTotal,
    profitTotal,
    expectedTotal,
    repairReason: hasBrokenDiscountedZero ? 'recovered_total_from_settlement' : ''
  };
}

function differs(currentValue, nextValue) {
  return Math.abs(Number(currentValue || 0) - Number(nextValue || 0)) > EPSILON;
}

function isCandidateSale(sale, next) {
  if (!Array.isArray(sale?.items) || sale.items.length === 0) return false;
  if (next.subtotal <= 0 && next.total <= 0 && next.costTotal <= 0) return false;
  return differs(sale?.subtotal, next.subtotal)
    || differs(sale?.discount, next.discount)
    || differs(sale?.total, next.total)
    || differs(sale?.costTotal, next.costTotal)
    || differs(sale?.profitTotal, next.profitTotal);
}

async function main() {
  const tenantId = getArg('--tenant', DEFAULT_TENANT_ID);
  const invoiceFilter = getArg('--invoice', '').trim();
  const applyMode = hasFlag('--apply');

  const conn = await getTenantConnection(tenantId);
  const Sale = SaleModelFor(conn);
  const Invoice = InvoiceModelFor(conn);
  const Audit = AuditModelFor(conn);

  const query = invoiceFilter ? { invoiceSerial: invoiceFilter } : {};
  const sales = await Sale.find(query).sort({ created_at: -1 });
  const reports = [];

  for (const sale of sales) {
    const next = buildFinancials(sale);
    if (!isCandidateSale(sale, next)) continue;

    const report = {
      saleId: String(sale?._id || ''),
      invoiceSerial: String(sale?.invoiceSerial || ''),
      receiptNumber: String(sale?.receiptNumber || ''),
      created_at: sale?.created_at || null,
      customerName: String(sale?.customerName || ''),
      before: {
        subtotal: roundMoney(sale?.subtotal),
        discount: roundMoney(sale?.discount),
        total: roundMoney(sale?.total),
        costTotal: roundMoney(sale?.costTotal),
        profitTotal: roundMoney(sale?.profitTotal)
      },
      after: {
        subtotal: next.subtotal,
        discount: next.discount,
        tax: next.tax,
        total: next.total,
        costTotal: next.costTotal,
        profitTotal: next.profitTotal
      },
      evidence: {
        expectedTotal: next.expectedTotal,
        repairReason: next.repairReason || null
      }
    };
    reports.push(report);

    if (!applyMode) continue;

    sale.subtotal = next.subtotal;
    sale.discount = next.discount;
    sale.total = next.total;
    sale.costTotal = next.costTotal;
    sale.profitTotal = next.profitTotal;
    await sale.save();

    await Invoice.updateMany(
      { saleId: String(sale._id) },
      {
        $set: {
          subtotal: next.subtotal,
          tax: next.tax,
          total: next.total
        }
      }
    );
  }

  if (applyMode && reports.length > 0) {
    await Audit.create({
      actor: 'repair-script',
      actionType: 'sale_financial_repair_apply',
      details: {
        tenantId,
        invoiceFilter,
        repairCount: reports.length,
        repairs: reports.map((row) => ({
          saleId: row.saleId,
          invoiceSerial: row.invoiceSerial,
          before: row.before,
          after: row.after
        }))
      },
      remark: 'Repaired sale financial figures from saved sold items only; stock untouched',
      branchId: ''
    });
  }

  console.log(JSON.stringify({
    mode: applyMode ? 'apply' : 'dry-run',
    tenantId,
    invoiceFilter: invoiceFilter || null,
    safety: {
      stockUntouched: true,
      productQuantitiesUntouched: true,
      fieldsUpdated: ['subtotal', 'discount', 'total', 'costTotal', 'profitTotal', 'invoice.subtotal', 'invoice.tax', 'invoice.total']
    },
    repairCount: reports.length,
    reports
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {}
  });
