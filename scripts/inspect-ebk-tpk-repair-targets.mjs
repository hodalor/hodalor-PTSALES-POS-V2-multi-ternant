import 'dotenv/config';
import mongoose from 'mongoose';
import { getTenantConnection } from '../src/config/tenancy.js';
import { modelFor as SaleModelFor } from '../src/models/Sale.js';
import { modelFor as RefundModelFor } from '../src/models/RefundRequest.js';
import { modelFor as ProductModelFor } from '../src/models/Product.js';
import { modelFor as InvoiceModelFor } from '../src/models/Invoice.js';
import { modelFor as BranchModelFor } from '../src/models/Branch.js';

function stockFieldForInventoryType(value = 'retail') {
  const kind = String(value || 'retail').trim().toLowerCase();
  if (kind === 'warehouse') return 'warehouseStockByBranch';
  if (kind === 'wholesale') return 'wholesaleStockByBranch';
  return 'stockByBranch';
}

function mapQty(container, branchId) {
  if (!container) return 0;
  if (container instanceof Map) return Number(container.get(String(branchId)) || 0);
  return Number(container?.[String(branchId)] || 0);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function toKey(productId = '', variantId = '') {
  return `${String(productId || '')}::${String(variantId || '')}`;
}

async function inspectEbkDoubleRefund() {
  const conn = await getTenantConnection('EBK');
  const Sale = SaleModelFor(conn);
  const Refund = RefundModelFor(conn);
  const Product = ProductModelFor(conn);
  const Branch = BranchModelFor(conn);
  const invoiceSerial = 'INV-EBK Wholesale-006244';
  const sale = await Sale.findOne({ invoiceSerial }).lean();
  const branches = await Branch.find({}).lean();
  const branchNameById = new Map(branches.map((row) => [String(row?.id || row?._id || ''), row?.name || row?.code || '']));
  if (!sale) {
    return { invoiceSerial, error: 'Sale not found' };
  }
  const refunds = await Refund.find({
    status: 'approved',
    $or: [
      { saleId: String(sale?._id || '') },
      { invoiceSerial }
    ]
  }).sort({ approved_at: 1, created_at: 1 }).lean();
  const duplicateRefund = refunds[1] || null;
  const affected = [];
  const productIds = Array.from(new Set(refunds.flatMap((refund) => (
    Array.isArray(refund?.restockItems) ? refund.restockItems.map((item) => String(item?.productId || '')).filter(Boolean) : []
  ))));
  const products = productIds.length > 0 ? await Product.find({ id: { $in: productIds } }).lean() : [];
  const productById = new Map(products.map((row) => [String(row?.id || row?._id || ''), row]));
  const saleItems = Array.isArray(sale?.items) ? sale.items : [];
  const duplicateApprovedAt = duplicateRefund?.approved_at ? new Date(duplicateRefund.approved_at) : null;
  const inventoryType = String(sale?.inventoryType || sale?.posType || 'retail').trim().toLowerCase() || 'retail';
  for (const refund of refunds) {
    for (const item of (Array.isArray(refund?.restockItems) ? refund.restockItems : [])) {
      const key = toKey(item?.productId, item?.variantId);
      let row = affected.find((entry) => entry.key === key);
      if (!row) {
        const product = productById.get(String(item?.productId || '')) || {};
        const variant = (Array.isArray(product?.variants) ? product.variants : []).find((entry) => String(entry?.id || '') === String(item?.variantId || '')) || null;
        const stockField = stockFieldForInventoryType(inventoryType);
        const currentStock = variant
          ? mapQty(variant?.[stockField], sale?.branchId)
          : mapQty(product?.[stockField], sale?.branchId);
        const saleItem = saleItems.find((entry) => (
          String(entry?.productId || '') === String(item?.productId || '')
          && String(entry?.variantId || '') === String(item?.variantId || '')
        )) || {};
        row = {
          key,
          productId: String(item?.productId || ''),
          variantId: String(item?.variantId || ''),
          sku: String(item?.sku || saleItem?.sku || variant?.sku || product?.sku || ''),
          productName: String(saleItem?.name || product?.name || ''),
          branchId: String(sale?.branchId || ''),
          branchName: branchNameById.get(String(sale?.branchId || '')) || String(sale?.branchId || ''),
          inventoryType,
          soldQty: Number(saleItem?.qty || 0),
          currentStock,
          firstRefundAdded: 0,
          duplicateRefundAdded: 0,
          totalRefundAdded: 0,
          laterKnownSalesQty: 0,
          laterKnownRefundQty: 0
        };
        affected.push(row);
      }
      const qty = Math.max(0, Number(item?.qty || 0));
      row.totalRefundAdded += qty;
      if (duplicateRefund && String(refund?._id || '') === String(duplicateRefund?._id || '')) row.duplicateRefundAdded += qty;
      else row.firstRefundAdded += qty;
    }
  }
  if (duplicateApprovedAt && affected.length > 0) {
    const laterSales = await Sale.find({
      branchId: sale.branchId,
      created_at: { $gt: duplicateApprovedAt }
    }).lean();
    const laterRefunds = await Refund.find({
      branchId: sale.branchId,
      status: 'approved',
      approved_at: { $gt: duplicateApprovedAt }
    }).lean();
    for (const row of affected) {
      row.laterKnownSalesQty = laterSales.reduce((sum, laterSale) => {
        if (Number(laterSale?.total || 0) < 0) return sum;
        if (String(laterSale?.inventoryType || laterSale?.posType || 'retail').trim().toLowerCase() !== inventoryType) return sum;
        const item = (Array.isArray(laterSale?.items) ? laterSale.items : []).find((entry) => (
          String(entry?.productId || '') === row.productId
          && String(entry?.variantId || '') === row.variantId
        ));
        return sum + Math.max(0, Number(item?.qty || 0));
      }, 0);
      row.laterKnownRefundQty = laterRefunds.reduce((sum, laterRefund) => {
        const item = (Array.isArray(laterRefund?.restockItems) ? laterRefund.restockItems : []).find((entry) => (
          String(entry?.productId || '') === row.productId
          && String(entry?.variantId || '') === row.variantId
        ));
        return sum + Math.max(0, Number(item?.qty || 0));
      }, 0);
      row.estimatedStockBeforeDuplicate = Math.max(
        0,
        row.currentStock - row.duplicateRefundAdded - row.laterKnownRefundQty + row.laterKnownSalesQty
      );
      row.safeToReverseNow = row.laterKnownSalesQty === 0 && row.laterKnownRefundQty === 0 && row.currentStock >= row.duplicateRefundAdded;
      row.stockIfReversedNow = Math.max(0, row.currentStock - row.duplicateRefundAdded);
    }
  }
  return {
    tenantId: 'EBK',
    invoiceSerial,
    sale: {
      saleId: String(sale?._id || ''),
      branchId: String(sale?.branchId || ''),
      branchName: branchNameById.get(String(sale?.branchId || '')) || String(sale?.branchId || ''),
      inventoryType,
      created_at: sale?.created_at || null,
      total: Number(sale?.total || 0),
      items: saleItems.map((item) => ({
        productId: String(item?.productId || ''),
        variantId: String(item?.variantId || ''),
        sku: String(item?.sku || ''),
        name: String(item?.name || ''),
        qty: Number(item?.qty || 0)
      }))
    },
    refunds: refunds.map((refund, index) => ({
      index: index + 1,
      refundId: String(refund?._id || ''),
      approved_at: refund?.approved_at || null,
      requestedAmount: Number(refund?.requestedAmount || 0),
      settlementMode: String(refund?.settlementMode || ''),
      restockMode: String(refund?.restockMode || ''),
      restockItems: (Array.isArray(refund?.restockItems) ? refund.restockItems : []).map((item) => ({
        productId: String(item?.productId || ''),
        variantId: String(item?.variantId || ''),
        sku: String(item?.sku || ''),
        qty: Number(item?.qty || 0)
      }))
    })),
    affectedProducts: affected
  };
}

async function inspectTpkSaleRepair() {
  const conn = await getTenantConnection('TPK');
  const Sale = SaleModelFor(conn);
  const Invoice = InvoiceModelFor(conn);
  const invoiceSerial = 'INV-MAIN-000040';
  const sale = await Sale.findOne({ invoiceSerial }).lean();
  const invoice = sale ? await Invoice.findOne({ saleId: String(sale?._id || '') }).lean() : await Invoice.findOne({ number: invoiceSerial }).lean();
  if (!sale) {
    return { invoiceSerial, error: 'Sale not found' };
  }
  const itemSubtotal = roundMoney((Array.isArray(sale?.items) ? sale.items : []).reduce((sum, item) => sum + (Number(item?.price || 0) * Number(item?.qty || 0)), 0));
  const costTotalFromItems = roundMoney((Array.isArray(sale?.items) ? sale.items : []).reduce((sum, item) => sum + (Number(item?.costPrice || 0) * Number(item?.qty || 0)), 0));
  const paymentTotal = roundMoney((Array.isArray(sale?.payment_methods) ? sale.payment_methods : []).reduce((sum, row) => sum + Math.max(0, Number(row?.amount || 0)), 0));
  const targetPaidAmount = 1600;
  const targetDiscount = Math.max(0, roundMoney(itemSubtotal + Number(sale?.tax || 0) - targetPaidAmount));
  const targetTotal = roundMoney(Math.max(0, itemSubtotal - targetDiscount + Number(sale?.tax || 0)));
  const targetProfit = roundMoney(targetTotal - costTotalFromItems);
  return {
    tenantId: 'TPK',
    invoiceSerial,
    saleId: String(sale?._id || ''),
    before: {
      subtotal: Number(sale?.subtotal || 0),
      discount: Number(sale?.discount || 0),
      tax: Number(sale?.tax || 0),
      total: Number(sale?.total || 0),
      costTotal: Number(sale?.costTotal || 0),
      profitTotal: Number(sale?.profitTotal || 0),
      paymentMethods: Array.isArray(sale?.payment_methods) ? sale.payment_methods : []
    },
    evidence: {
      itemSubtotal,
      costTotalFromItems,
      paymentTotal,
      targetPaidAmount
    },
    target: {
      subtotal: itemSubtotal,
      discount: targetDiscount,
      total: targetTotal,
      costTotal: costTotalFromItems,
      profitTotal: targetProfit,
      paymentMethods: (Array.isArray(sale?.payment_methods) ? sale.payment_methods : []).map((row, index) => ({
        index,
        type: String(row?.type || 'cash'),
        beforeAmount: Number(row?.amount || 0),
        afterAmount: index === 0 ? targetPaidAmount : 0
      }))
    },
    invoice: invoice ? {
      invoiceId: String(invoice?._id || ''),
      number: String(invoice?.number || ''),
      subtotal: Number(invoice?.subtotal || 0),
      discount: Number(invoice?.discount || 0),
      tax: Number(invoice?.tax || 0),
      total: Number(invoice?.total || 0)
    } : null
  };
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    ebk: await inspectEbkDoubleRefund(),
    tpk: await inspectTpkSaleRepair()
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
