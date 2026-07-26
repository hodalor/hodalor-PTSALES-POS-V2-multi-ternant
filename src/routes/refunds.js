import { Router } from 'express';
import RefundRequest from '../models/RefundRequest.js';
import Audit from '../models/Audit.js';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import { requireAuth, requireRole, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';
import { resolveInventoryTypeFromBranch, returnSerializedUnits } from '../utils/productUnits.js';
import { getMapQty, getStockTarget, markInventoryModified, setMapQty } from '../utils/inventory.js';
import { uploadMediaArray } from '../utils/mediaStorage.js';
import { enrichSalesWithAccounting } from '../utils/saleAccounting.js';

const r = Router();

r.use(requireAuth);

function escapeRegex(text = '') {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBranchIds(value) {
  if (value === 'all') return 'all';
  return Array.from(new Set(
    (Array.isArray(value) ? value : [value])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function computeSaleItemsSubtotal(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + (Number(item?.price || 0) * Math.max(0, Number(item?.qty || 0)))
  ), 0);
}

function computeSaleItemsCostTotal(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + (Number(item?.costPrice || 0) * Math.max(0, Number(item?.qty || 0)))
  ), 0);
}

function normalizeSaleFinancials(row = {}) {
  const itemsSubtotal = computeSaleItemsSubtotal(row.items);
  const storedSubtotal = Number(row?.subtotal);
  const hasStoredSubtotal = Number.isFinite(storedSubtotal) && (storedSubtotal !== 0 || itemsSubtotal === 0);
  const subtotal = hasStoredSubtotal ? storedSubtotal : itemsSubtotal;
  const discount = Math.max(0, Number(row?.discount || 0));
  const tax = Math.max(0, Number(row?.tax || 0));
  const storedTotal = Number(row?.total);
  const computedTotal = subtotal - discount + tax;
  const hasStoredTotal = Number.isFinite(storedTotal) && (storedTotal !== 0 || computedTotal === 0);
  const total = hasStoredTotal ? storedTotal : computedTotal;
  const itemCostTotal = computeSaleItemsCostTotal(row.items);
  const storedCostTotal = Number(row?.costTotal);
  const hasStoredCostTotal = Number.isFinite(storedCostTotal) && (storedCostTotal !== 0 || itemCostTotal === 0);
  const costTotal = hasStoredCostTotal ? storedCostTotal : itemCostTotal;
  const storedProfitTotal = Number(row?.profitTotal);
  const shouldRecomputeProfit = !Number.isFinite(storedProfitTotal)
    || (!hasStoredTotal && total !== 0);
  const profitTotal = shouldRecomputeProfit ? (total - costTotal) : storedProfitTotal;
  return {
    ...row,
    subtotal,
    total,
    costTotal,
    profitTotal
  };
}

function getRefundableSaleAmount(sale = {}) {
  return Math.max(0, Number(sale?.total || 0) - Math.max(0, Number(sale?.tax || 0)));
}

async function resolveRefundSaleReference(payload = {}) {
  const saleKey = String(payload?.saleId || '').trim();
  if (saleKey) {
    if (mongoose.isValidObjectId(saleKey)) {
      const byId = await Sale.findById(saleKey);
      if (byId) return byId;
    }
    const byClientId = await Sale.findOne({ clientId: saleKey });
    if (byClientId) return byClientId;
  }
  const invoiceSerial = String(payload?.invoiceSerial || '').trim();
  const receiptNumber = String(payload?.receiptNumber || '').trim();
  const or = [];
  if (invoiceSerial) or.push({ invoiceSerial });
  if (receiptNumber) or.push({ receiptNumber });
  if (or.length === 0) return null;
  return Sale.findOne({ $or: or }).sort({ created_at: -1 });
}

async function getRefundCoverageForSale(sale = {}, options = {}) {
  const saleId = String(sale?._id || sale?.id || sale?.clientId || '').trim();
  const invoiceSerial = String(sale?.invoiceSerial || '').trim();
  const receiptNumber = String(sale?.receiptNumber || '').trim();
  const excludeRequestId = String(options?.excludeRequestId || '').trim();
  const or = [];
  if (saleId) or.push({ saleId });
  if (invoiceSerial) or.push({ invoiceSerial });
  if (receiptNumber) or.push({ receiptNumber });
  if (or.length === 0) {
    return { activeAmount: 0, approvedAmount: 0, remainingAmount: getRefundableSaleAmount(sale), hasApprovedFull: false, hasActiveFull: false };
  }
  const rows = await RefundRequest.find({
    status: { $in: ['pending_approval', 'approved'] },
    $or: or
  }).lean();
  const filteredRows = rows.filter((row) => String(row?._id || row?.clientId || '').trim() !== excludeRequestId);
  const activeAmount = filteredRows.reduce((sum, row) => sum + Math.abs(Number(row?.requestedAmount || 0)), 0);
  const approvedRows = filteredRows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'approved');
  const approvedAmount = approvedRows.reduce((sum, row) => sum + Math.abs(Number(row?.requestedAmount || 0)), 0);
  const hasApprovedFull = approvedRows.some((row) => String(row?.type || '').trim().toLowerCase() === 'full');
  const hasActiveFull = filteredRows.some((row) => String(row?.type || '').trim().toLowerCase() === 'full');
  return {
    activeAmount,
    approvedAmount,
    remainingAmount: Math.max(0, getRefundableSaleAmount(sale) - activeAmount),
    hasApprovedFull,
    hasActiveFull
  };
}

r.get('/requests', async (req, res) => {
  const rows = await RefundRequest.find().sort({ created_at: -1 }).limit(500);
  res.json(rows);
});

r.get('/lookup-sale', requireRoleOrPerm(['Admin','Manager','Cashier'], ['add_refunds', 'add_distribution_refunds', 'approve_refunds']), async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing search query' });
  const role = String(req.user?.role || '').toLowerCase();
  const query = {};
  const assigned = normalizeBranchIds(req.user?.assignedBranches);
  if (role !== 'superadmin' && role !== 'admin' && assigned !== 'all') {
    const branchIds = normalizeBranchIds([req.user?.branchId, ...(Array.isArray(assigned) ? assigned : [])]);
    if (branchIds.length > 0) query.branchId = { $in: branchIds };
  }
  const exactRegex = new RegExp(`^${escapeRegex(q)}$`, 'i');
  query.$or = [
    { invoiceSerial: exactRegex },
    { receiptNumber: exactRegex },
    { clientId: q }
  ];
  if (mongoose.isValidObjectId(q)) {
    query.$or.unshift({ _id: q });
  }
  const sale = await Sale.findOne(query).sort({ created_at: -1 }).lean();
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const [enriched] = await enrichSalesWithAccounting([normalizeSaleFinancials(sale)]);
  res.json(enriched || normalizeSaleFinancials(sale));
});

r.post('/requests', requireRoleOrPerm(['Admin','Manager','Cashier'], ['add_refunds', 'add_distribution_refunds']), async (req, res) => {
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim();
  const payload = {
    ...(req.body || {}),
    images: await uploadMediaArray(req.body?.images, (_value, index) => ({
      tenantId,
      folder: 'refunds',
      originalName: `${req.body?.saleId || req.body?.receiptNumber || 'refund'}-${index + 1}`
    }))
  };
  const clientId = String(payload.clientId || '').trim();
  if (clientId) {
    const existing = await RefundRequest.findOne({ clientId });
    if (existing) return res.json(existing);
  }
  const saleRef = await resolveRefundSaleReference(payload);
  if (!saleRef) return res.status(404).json({ error: 'Sale not found for refund' });
  const coverage = await getRefundCoverageForSale(saleRef);
  if (coverage.hasActiveFull || coverage.remainingAmount <= 0.0001) {
    return res.status(400).json({ error: 'Sale already refunded' });
  }
  const requestedType = String(payload?.type || 'full').trim().toLowerCase();
  let requestedAmount = Math.abs(Number(payload?.requestedAmount || 0));
  if (requestedType === 'full') {
    requestedAmount = coverage.remainingAmount;
  }
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return res.status(400).json({ error: 'Refund amount must be greater than zero' });
  }
  if (requestedAmount > coverage.remainingAmount + 0.0001) {
    return res.status(400).json({ error: `Refund amount exceeds remaining refundable amount of ${coverage.remainingAmount.toFixed(2)}` });
  }
  const rfd = await RefundRequest.create({
    ...payload,
    saleId: String(saleRef?._id || saleRef?.clientId || payload?.saleId || ''),
    invoiceSerial: saleRef?.invoiceSerial || payload?.invoiceSerial || '',
    receiptNumber: saleRef?.receiptNumber || payload?.receiptNumber || '',
    branchId: saleRef?.branchId || payload?.branchId || '',
    requestedAmount,
    clientId: clientId || undefined
  });
  await Audit.create({
    actor: rfd.initiatorName || 'unknown',
    actionType: 'refund_initiated',
    details: { saleId: rfd.saleId, amount: rfd.requestedAmount, type: rfd.type },
    branchId: rfd.branchId
  });
  res.json(rfd);
});

r.post('/approve', requireRoleOrPerm(['Admin','Manager'], 'approve_refunds'), async (req, res) => {
  const { id, approverName, approverRole, approvalRemark, restockMode, restockItems } = req.body || {};
  const key = String(id || '');
  const or = [];
  if (mongoose.isValidObjectId(key)) or.push({ _id: key });
  or.push({ clientId: key });
  const rfd = await RefundRequest.findOne({ $or: or });
  if (!rfd) return res.status(404).json({ error: 'Not found' });
  if (rfd.status !== 'pending_approval') return res.json(rfd);
  const saleRef = await resolveRefundSaleReference(rfd);
  if (!saleRef) return res.status(404).json({ error: 'Sale not found for refund approval' });
  const coverage = await getRefundCoverageForSale(saleRef, { excludeRequestId: String(rfd?._id || '') });
  if (coverage.hasApprovedFull || coverage.remainingAmount <= 0.0001) {
    return res.status(400).json({ error: 'Sale already refunded' });
  }
  const requestedAmount = Math.abs(Number(rfd?.requestedAmount || 0));
  if (requestedAmount > coverage.remainingAmount + 0.0001) {
    return res.status(400).json({ error: `Refund amount exceeds remaining refundable amount of ${coverage.remainingAmount.toFixed(2)}` });
  }
  
  // 1. Update request
  rfd.status = 'approved';
  rfd.approverName = approverName || 'unknown';
  rfd.approverRole = approverRole || '';
  rfd.approvalRemark = approvalRemark || '';
  rfd.restockMode = restockMode || 'none';
  if (Array.isArray(restockItems)) rfd.restockItems = restockItems.map(x => ({ sku: x.sku, productId: x.productId || '', variantId: x.variantId || '', qty: Number(x.qty) || 0, unitIds: Array.isArray(x.unitIds) ? x.unitIds.map(String).filter(Boolean) : [] }));
  rfd.approved_at = new Date();
  await rfd.save();

  // 2. Create negative sale (Refund Record)
  if (saleRef) {
    const amt = requestedAmount;
    const refundSale = new Sale({
      branchId: saleRef.branchId,
      sellerName: approverName || 'unknown',
      customerId: saleRef.customerId,
      customerCode: saleRef.customerCode,
      customerName: saleRef.customerName,
      customerPhone: saleRef.customerPhone,
      items: [{
        name: `REFUND ${saleRef.invoiceSerial || saleRef.receiptNumber || saleRef.id}`,
        sku: 'REFUND',
        qty: 1,
        price: -amt,
        spec: ''
      }],
      subtotal: -amt,
      discount: 0,
      tax: 0,
      total: -amt,
      costTotal: 0,
      profitTotal: -amt,
      posType: saleRef.posType || 'retail',
      inventoryType: saleRef.inventoryType || saleRef.posType || 'retail',
      defaultPriceTier: saleRef.defaultPriceTier || (saleRef.posType || 'retail'),
      payment_methods: [{ type: 'refund', amount: -amt }],
      invoiceSerial: '',
      receiptNumber: '',
      created_at: new Date()
    });
    await refundSale.save();
  }

  // 3. Restock inventory if needed
  if ((restockMode === 'full' || restockMode === 'partial') && Array.isArray(rfd.restockItems) && rfd.restockItems.length > 0) {
    const inventoryType = await resolveInventoryTypeFromBranch(rfd.branchId, saleRef?.inventoryType || 'retail');
    for (const item of rfd.restockItems) {
      if ((!item.sku && !item.productId) || item.qty <= 0) continue;
      
      // Try finding by SKU (main product)
      let p = await Product.findOne({ sku: item.sku });
      let variantId = null;
      
      if (!p) {
        // Try finding by variant SKU manually
        // Since variant SKU isn't indexed at top level, we might need to search products with variants
        // But for performance, let's fetch all products that *might* have variants or rely on SKU convention if possible
        // Actually, let's just search all products where variants.sku matches
        const pVar = await Product.findOne({ "variants.sku": item.sku });
        if (pVar) {
          p = pVar;
          const v = p.variants.find(v => v.sku === item.sku);
          if (v) variantId = v.id; // Assuming variant has ID
        } else {
           // Fallback: maybe SKU is constructed "PROD-VAR"
           // If frontend sends real SKU, we should be fine.
           // If not found, skip
           continue;
        }
      } else {
        // Found main product. Check if it's actually a variant SKU that happens to match main SKU (unlikely if unique)
        // or if we need to update main product stock.
        // If product has variants but we matched main SKU, we might need to know WHICH variant?
        // But usually restockItems should contain the specific SKU of the item sold.
        // If the sold item was a variant, its SKU is stored in sale item.
      }

      if (p) {
        // Update stock
        const bid = rfd.branchId;
        if (variantId) {
             const target = getStockTarget(p, variantId, inventoryType);
             if (target) {
               const current = getMapQty(target.container, bid);
               setMapQty(target.container, bid, current + Number(item.qty || 0));
               markInventoryModified(target);
             }
        } else {
            const target = getStockTarget(p, '', inventoryType);
            if (target) {
              const current = getMapQty(target.container, bid);
              setMapQty(target.container, bid, current + Number(item.qty || 0));
              markInventoryModified(target);
            }
        }
        await p.save();
      }
      const saleItem = Array.isArray(saleRef?.items)
        ? saleRef.items.find(saleRow => String(saleRow.productId || '') === String(item.productId || '') && String(saleRow.variantId || '') === String(item.variantId || variantId || ''))
        : null;
      const unitIds = Array.isArray(item.unitIds) && item.unitIds.length > 0
        ? item.unitIds
        : (Array.isArray(saleItem?.soldUnitIds) ? saleItem.soldUnitIds.slice(0, Math.max(0, Number(item.qty || 0))) : []);
      if (unitIds.length > 0) {
        await returnSerializedUnits({
          unitIds,
          branchId: rfd.branchId,
          inventoryType,
          saleId: String(saleRef._id || '')
        });
      }
    }
  }

  await Audit.create({
    actor: approverName || 'unknown',
    actionType: rfd.restockMode !== 'none' ? 'stock_restock_refund' : 'refund_approved',
    details: { saleId: rfd.saleId, items: rfd.restockItems || [], refundSale: true },
    branchId: rfd.branchId
  });

  res.json(rfd);
});

r.post('/reject', requireRoleOrPerm(['Admin','Manager'], 'approve_refunds'), async (req, res) => {
  const { id, approverName, approverRole, remark } = req.body || {};
  const key = String(id || '');
  const or = [];
  if (mongoose.isValidObjectId(key)) or.push({ _id: key });
  or.push({ clientId: key });
  const rfd = await RefundRequest.findOne({ $or: or });
  if (!rfd) return res.status(404).json({ error: 'Not found' });
  if (rfd.status !== 'pending_approval') return res.json(rfd);
  rfd.status = 'rejected';
  rfd.rejectionRemark = remark || '';
  rfd.approverName = approverName || 'unknown';
  rfd.approverRole = approverRole || '';
  rfd.rejected_at = new Date();
  await rfd.save();
  await Audit.create({
    actor: approverName || 'unknown',
    actionType: 'refund_rejected',
    details: { saleId: rfd.saleId },
    branchId: rfd.branchId
  });
  res.json(rfd);
});

export default r;
