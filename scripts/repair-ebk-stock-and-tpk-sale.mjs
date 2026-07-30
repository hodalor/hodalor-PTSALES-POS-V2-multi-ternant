import 'dotenv/config';
import mongoose from 'mongoose';
import { getTenantConnection } from '../src/config/tenancy.js';
import { modelFor as SaleModelFor } from '../src/models/Sale.js';
import { modelFor as RefundModelFor } from '../src/models/RefundRequest.js';
import { modelFor as ProductModelFor } from '../src/models/Product.js';
import { modelFor as InvoiceModelFor } from '../src/models/Invoice.js';
import { modelFor as AuditModelFor } from '../src/models/Audit.js';

function hasFlag(name) {
  return process.argv.includes(name);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function stockFieldForInventoryType(value = 'retail') {
  const kind = String(value || 'retail').trim().toLowerCase();
  if (kind === 'warehouse') return 'warehouseStockByBranch';
  if (kind === 'wholesale') return 'wholesaleStockByBranch';
  return 'stockByBranch';
}

function getMapQty(container, branchId) {
  if (!container) return 0;
  if (container instanceof Map) return Number(container.get(String(branchId)) || 0);
  return Number(container?.[String(branchId)] || 0);
}

function setMapQty(container, branchId, value) {
  if (!container) return;
  if (container instanceof Map) {
    container.set(String(branchId), Number(value || 0));
    return;
  }
  container[String(branchId)] = Number(value || 0);
}

function extractProductIdsFromAudit(audit) {
  const ids = new Set();
  const details = audit?.details || {};
  if (details?.productId) ids.add(String(details.productId));
  if (Array.isArray(details?.inventoryLines)) {
    details.inventoryLines.forEach((line) => {
      if (line?.productId) ids.add(String(line.productId));
    });
  }
  return Array.from(ids);
}

async function repairEbkStock({ apply = false } = {}) {
  const conn = await getTenantConnection('EBK');
  const Sale = SaleModelFor(conn);
  const Refund = RefundModelFor(conn);
  const Product = ProductModelFor(conn);
  const Audit = AuditModelFor(conn);
  const invoiceSerial = 'INV-EBK Wholesale-006244';
  const sale = await Sale.findOne({ invoiceSerial });
  if (!sale) throw new Error(`Sale not found for ${invoiceSerial}`);
  const refunds = await Refund.find({
    status: 'approved',
    $or: [{ saleId: String(sale._id) }, { invoiceSerial }]
  }).sort({ approved_at: 1, created_at: 1 });
  if (refunds.length < 2) {
    return { mode: apply ? 'apply' : 'dry-run', tenantId: 'EBK', invoiceSerial, repaired: false, reason: 'No duplicate approved refund found' };
  }
  const duplicateRefund = refunds[1];
  const duplicateApprovedAt = duplicateRefund?.approved_at ? new Date(duplicateRefund.approved_at) : null;
  const duplicateItems = Array.isArray(duplicateRefund?.restockItems) ? duplicateRefund.restockItems : [];
  const productIds = Array.from(new Set(duplicateItems.map((item) => String(item?.productId || '')).filter(Boolean)));
  const products = await Product.find({ id: { $in: productIds } });
  const productById = new Map(products.map((row) => [String(row?.id || row?._id || ''), row]));
  const relevantAudits = duplicateApprovedAt
    ? await Audit.find({ ts: { $gt: duplicateApprovedAt }, actionType: 'stock_set_manual' }).lean()
    : [];
  const manualStockSets = relevantAudits.filter((audit) => (
    extractProductIdsFromAudit(audit).some((productId) => productIds.includes(String(productId)))
  ));
  const inventoryType = String(sale?.inventoryType || sale?.posType || 'retail').trim().toLowerCase() || 'retail';
  const stockField = stockFieldForInventoryType(inventoryType);
  const adjustments = [];
  for (const item of duplicateItems) {
    const productId = String(item?.productId || '');
    const qty = Math.max(0, Number(item?.qty || 0));
    if (!productId || qty <= 0) continue;
    const product = productById.get(productId);
    if (!product) throw new Error(`Product not found for duplicate refund stock reversal: ${productId}`);
    const before = getMapQty(product?.[stockField], sale.branchId);
    const after = before - qty;
    if (after < 0) {
      throw new Error(`Refusing to reverse ${qty} from ${product.name || productId} because branch stock would go negative`);
    }
    adjustments.push({
      productId,
      productName: String(product?.name || ''),
      sku: String(item?.sku || product?.sku || ''),
      branchId: String(sale.branchId || ''),
      inventoryType,
      before,
      reverseQty: qty,
      after
    });
  }
  if (apply) {
    if (manualStockSets.length > 0) {
      throw new Error('Manual stock-set audit found after the duplicate refund; automatic EBK stock reversal aborted');
    }
    for (const adjustment of adjustments) {
      const product = productById.get(adjustment.productId);
      setMapQty(product[stockField], sale.branchId, adjustment.after);
      product.markModified(stockField);
      await product.save();
    }
    await Audit.create({
      actor: 'repair-script',
      actionType: 'duplicate_refund_stock_reversal_apply',
      details: {
        invoiceSerial,
        saleId: String(sale._id || ''),
        duplicateRefundId: String(duplicateRefund?._id || ''),
        adjustments
      },
      remark: 'Reversed stock added by EBK duplicate approved refund; one duplicate restock removed',
      branchId: String(sale.branchId || '')
    });
  }
  return {
    mode: apply ? 'apply' : 'dry-run',
    tenantId: 'EBK',
    invoiceSerial,
    duplicateRefundId: String(duplicateRefund?._id || ''),
    duplicateApprovedAt: duplicateRefund?.approved_at || null,
    manualStockSetAuditCountAfterDuplicate: manualStockSets.length,
    adjustments
  };
}

async function repairTpkSale({ apply = false } = {}) {
  const conn = await getTenantConnection('TPK');
  const Sale = SaleModelFor(conn);
  const Invoice = InvoiceModelFor(conn);
  const Audit = AuditModelFor(conn);
  const invoiceSerial = 'INV-MAIN-000040';
  const targetPaidAmount = 1600;
  const sale = await Sale.findOne({ invoiceSerial });
  if (!sale) throw new Error(`Sale not found for ${invoiceSerial}`);
  const invoice = await Invoice.findOne({ saleId: String(sale._id || '') }) || await Invoice.findOne({ number: invoiceSerial });
  const subtotal = roundMoney((Array.isArray(sale?.items) ? sale.items : []).reduce((sum, item) => (
    sum + (Math.max(0, Number(item?.price || 0)) * Math.max(0, Number(item?.qty || 0)))
  ), 0));
  const tax = roundMoney(Math.max(0, Number(sale?.tax || 0)));
  const discount = roundMoney(Math.max(0, subtotal + tax - targetPaidAmount));
  const total = roundMoney(Math.max(0, subtotal - discount + tax));
  const costTotal = roundMoney((Array.isArray(sale?.items) ? sale.items : []).reduce((sum, item) => (
    sum + (Math.max(0, Number(item?.costPrice || 0)) * Math.max(0, Number(item?.qty || 0)))
  ), 0));
  const profitTotal = roundMoney(total - costTotal);
  const existingPayments = Array.isArray(sale?.payment_methods) ? sale.payment_methods : [];
  const primaryType = String(existingPayments[0]?.type || 'cash') || 'cash';
  const paymentMethods = [{ type: primaryType, amount: total }];
  const before = {
    subtotal: Number(sale?.subtotal || 0),
    discount: Number(sale?.discount || 0),
    total: Number(sale?.total || 0),
    costTotal: Number(sale?.costTotal || 0),
    profitTotal: Number(sale?.profitTotal || 0),
    paymentMethods: existingPayments.map((row) => ({ type: String(row?.type || ''), amount: Number(row?.amount || 0) })),
    invoice: invoice ? {
      subtotal: Number(invoice?.subtotal || 0),
      discount: Number(invoice?.discount || 0),
      total: Number(invoice?.total || 0)
    } : null
  };
  const after = {
    subtotal,
    discount,
    total,
    costTotal,
    profitTotal,
    paymentMethods,
    invoice: invoice ? { subtotal, discount, total, tax } : null
  };
  if (apply) {
    sale.subtotal = subtotal;
    sale.discount = discount;
    sale.total = total;
    sale.costTotal = costTotal;
    sale.profitTotal = profitTotal;
    sale.payment_methods = paymentMethods;
    await sale.save();
    if (invoice) {
      invoice.subtotal = subtotal;
      invoice.discount = discount;
      invoice.tax = tax;
      invoice.total = total;
      await invoice.save();
    }
    await Audit.create({
      actor: 'repair-script',
      actionType: 'sale_financial_repair_apply',
      details: {
        invoiceSerial,
        saleId: String(sale._id || ''),
        before,
        after
      },
      remark: 'Corrected TPK sale to paid amount 1600 with remaining amount recorded as discount; stock untouched',
      branchId: String(sale.branchId || '')
    });
  }
  return {
    mode: apply ? 'apply' : 'dry-run',
    tenantId: 'TPK',
    invoiceSerial,
    saleId: String(sale._id || ''),
    before,
    after
  };
}

async function main() {
  const applyEbk = hasFlag('--apply-ebk-stock');
  const applyTpk = hasFlag('--apply-tpk-sale');
  const report = {
    generatedAt: new Date().toISOString(),
    ebk: await repairEbkStock({ apply: applyEbk }),
    tpk: await repairTpkSale({ apply: applyTpk })
  };
  console.log(JSON.stringify(report, null, 2));
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
