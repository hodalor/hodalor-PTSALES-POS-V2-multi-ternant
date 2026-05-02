import { Router } from 'express';
import RefundRequest from '../models/RefundRequest.js';
import Audit from '../models/Audit.js';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import { requireAuth, requireRole, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';
import { resolveInventoryTypeFromBranch, returnSerializedUnits } from '../utils/productUnits.js';
import { getMapQty, getStockTarget, markInventoryModified, setMapQty } from '../utils/inventory.js';

const r = Router();

r.use(requireAuth);

r.get('/requests', async (req, res) => {
  const rows = await RefundRequest.find().sort({ created_at: -1 }).limit(500);
  res.json(rows);
});

r.post('/requests', requireRoleOrPerm(['Admin','Manager','Cashier'], ['add_refunds', 'add_distribution_refunds']), async (req, res) => {
  const payload = req.body || {};
  const clientId = String(payload.clientId || '').trim();
  if (clientId) {
    const existing = await RefundRequest.findOne({ clientId });
    if (existing) return res.json(existing);
  }
  const rfd = await RefundRequest.create({ ...payload, clientId: clientId || undefined });
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
  const saleKey = String(rfd.saleId || '');
  let saleRef = null;
  if (mongoose.isValidObjectId(saleKey)) saleRef = await Sale.findById(saleKey);
  if (!saleRef) saleRef = await Sale.findOne({ clientId: saleKey });
  if (saleRef) {
    const amt = Math.abs(rfd.requestedAmount || 0);
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
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: -amt,
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
