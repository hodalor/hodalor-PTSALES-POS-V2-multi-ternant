import { Router } from 'express';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import AdjustmentRequest from '../models/AdjustmentRequest.js';
import mongoose from 'mongoose';
import { adjustSerializedUnits, normalizeTrackType, resolveInventoryTypeFromBranch } from '../utils/productUnits.js';

const r = Router();
r.use(requireAuth);

function productLookupQuery(productId) {
  const pid = String(productId || '');
  const or = [{ id: pid }];
  if (mongoose.isValidObjectId(pid)) or.unshift({ _id: pid });
  return { $or: or };
}

function getBranchQty(mapLike, branchId) {
  if (!mapLike) return 0;
  if (typeof mapLike.get === 'function') return Number(mapLike.get(branchId) || 0);
  return Number(mapLike[branchId] || 0);
}
function setBranchQty(mapLike, branchId, qty) {
  if (!mapLike) return;
  if (typeof mapLike.set === 'function') {
    mapLike.set(branchId, qty);
  } else {
    mapLike[branchId] = qty;
  }
}
function normalizeItems(payload = {}) {
  const raw = Array.isArray(payload.items) && payload.items.length > 0
    ? payload.items
    : [{
        lineId: payload.clientId || '',
        productId: payload.productId,
        variantId: payload.variantId || '',
        delta: payload.delta,
        remark: payload.remark || '',
        status: 'pending'
      }];
  return raw
    .map((item, index) => ({
      lineId: String(item.lineId || `${index + 1}`),
      productId: String(item.productId || ''),
      variantId: String(item.variantId || ''),
      delta: Number(item.delta || 0),
      unitIds: Array.isArray(item.unitIds) ? item.unitIds.map(String).filter(Boolean) : [],
      selectedUnits: Array.isArray(item.selectedUnits) ? item.selectedUnits.map(unit => ({ unitId: String(unit?.unitId || ''), imei: String(unit?.imei || '').trim(), serialNumber: String(unit?.serialNumber || '').trim() })) : [],
      serializedEntries: Array.isArray(item.serializedEntries) ? item.serializedEntries.map(entry => ({ imei: String(entry?.imei || '').trim(), serialNumber: String(entry?.serialNumber || '').trim() })) : [],
      remark: String(item.remark || ''),
      status: String(item.status || 'pending').toLowerCase() === 'cancelled' ? 'cancelled' : 'accepted'
    }))
    .filter(item => item.productId && Number(item.delta) !== 0);
}

async function adjustBaseStock(productId, branchId, delta) {
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  if (!p.stockByBranch) p.stockByBranch = new Map();
  const cur = getBranchQty(p.stockByBranch, branchId);
  setBranchQty(p.stockByBranch, branchId, Math.max(0, cur + Number(delta)));
  p.markModified('stockByBranch');
  await p.save();
  return p;
}

async function adjustVariantStock(productId, variantId, branchId, delta) {
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const idx = variants.findIndex(v => v.id === variantId);
  if (idx < 0) {
    const err = new Error('Variant not found');
    err.status = 400;
    throw err;
  }
  const v = variants[idx];
  if (!v.stockByBranch) v.stockByBranch = new Map();
  const cur = getBranchQty(v.stockByBranch, branchId);
  setBranchQty(v.stockByBranch, branchId, Math.max(0, cur + Number(delta)));
  p.variants[idx] = v;
  p.markModified('variants');
  await p.save();
  return p;
}

r.get('/requests', requireRoleOrPerm(['Admin','Manager'], 'approve_adjustments'), async (req, res) => {
  const statusRaw = String(req.query.status || '').trim().toLowerCase();
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 200));
  const map = { pending: 'pending_approval', approved: 'approved', rejected: 'rejected' };
  const q = {};
  if (map[statusRaw]) q.status = map[statusRaw];
  const rows = await AdjustmentRequest.find(q).sort({ createdAt: -1 }).limit(limit).lean();
  res.json(rows);
});

r.post('/requests', requireRoleOrPerm(['Admin','Manager','Inventory Staff'], 'add_adjustments'), async (req, res) => {
  const { productId, branchId, delta, variantId, remark, clientId } = req.body || {};
  if (!productId || !branchId) return res.status(400).json({ error: 'Missing productId or branchId' });
  if (!Number.isFinite(Number(delta)) || Number(delta) === 0) return res.status(400).json({ error: 'Delta must be non-zero number' });
  const cid = String(clientId || '').trim();
  if (cid) {
    const existing = await AdjustmentRequest.findOne({ clientId: cid });
    if (existing) return res.json(existing);
  }
  const draftItems = normalizeItems(req.body || {});
  for (const item of draftItems) {
    const product = await Product.findOne(productLookupQuery(item.productId));
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (normalizeTrackType(product.trackType) === 'serialized') {
      if (Number(item.delta || 0) > 0 && (!Array.isArray(item.serializedEntries) || item.serializedEntries.length !== Math.abs(Number(item.delta || 0)))) {
        return res.status(400).json({ error: `Serialized adjustment increase for ${product.name} requires exactly ${Math.abs(Number(item.delta || 0))} IMEI/serial entries` });
      }
      if (Number(item.delta || 0) < 0 && (!Array.isArray(item.unitIds) || item.unitIds.length !== Math.abs(Number(item.delta || 0)))) {
        return res.status(400).json({ error: `Serialized adjustment decrease for ${product.name} requires exactly ${Math.abs(Number(item.delta || 0))} selected unit(s)` });
      }
    }
  }
  const row = await AdjustmentRequest.create({
    clientId: cid || undefined,
    productId: String(productId),
    variantId: variantId ? String(variantId) : undefined,
    branchId: String(branchId),
    delta: Number(delta),
    remark: String(remark || ''),
    items: draftItems,
    initiatorName: req.user?.name || '',
    initiatorRole: req.user?.role || ''
  });
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'adjustment_request_create',
    details: { id: String(row._id), productId: row.productId, variantId: row.variantId || '', delta: row.delta, branchId: row.branchId, itemCount: Array.isArray(row.items) ? row.items.length : 0 },
    remark: row.remark || '',
    branchId: row.branchId
  });
  res.json(row);
});

r.post('/approve', requireRoleOrPerm(['Admin','Manager'], 'approve_adjustments'), async (req, res) => {
  const { id, remark, items: reviewedItems } = req.body || {};
  const row = await AdjustmentRequest.findById(id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.status !== 'pending_approval') return res.status(400).json({ error: 'Request not pending' });
  const nextItems = normalizeItems({ items: reviewedItems && reviewedItems.length ? reviewedItems : (row.items || []) });
  let p = null;
  try {
    const inventoryType = await resolveInventoryTypeFromBranch(row.branchId, 'retail');
    for (const item of nextItems) {
      if (item.status === 'cancelled') continue;
      const product = await Product.findOne(productLookupQuery(item.productId));
      if (!product) return res.status(404).json({ error: 'Product not found' });
      if (normalizeTrackType(product.trackType) === 'serialized') {
        if (Number(item.delta || 0) > 0) {
          await adjustSerializedUnits({
            productId: item.productId,
            variantId: item.variantId || '',
            branchId: row.branchId,
            inventoryType,
            entries: item.serializedEntries || [],
            mode: 'increase'
          });
        } else {
          await adjustSerializedUnits({
            productId: item.productId,
            variantId: item.variantId || '',
            branchId: row.branchId,
            inventoryType,
            unitIds: item.unitIds || [],
            mode: 'decrease'
          });
        }
        p = product;
        continue;
      }
      if (item.variantId) {
        p = await adjustVariantStock(item.productId, item.variantId, row.branchId, item.delta);
      } else {
        p = await adjustBaseStock(item.productId, row.branchId, item.delta);
      }
    }
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || 'Failed to apply adjustment' });
  }
  row.status = 'approved';
  row.approverName = req.user?.name || '';
  row.approverRole = req.user?.role || '';
  row.approvalRemark = String(remark || '');
  row.items = nextItems;
  row.approved_at = new Date();
  await row.save();
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === row.variantId)?.label : '') || '';
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'stock_adjust',
    details: { product: p?.name || row.productId, variant: varLabel, delta: Number(row.delta), branchId: row.branchId, itemCount: nextItems.length, acceptedCount: nextItems.filter(item => item.status !== 'cancelled').length },
    remark: row.remark || '',
    branchId: row.branchId
  });
  await ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: '/api/adjustments/approve',
    method: 'POST',
    status: 200,
    message: `Adjustment approved Δ ${Number(row.delta)} for ${p?.name || row.productId} @ ${row.branchId}${row.variantId ? ` (variant ${varLabel})` : ''}`
  });
  res.json({ ok: true, request: row });
});

r.post('/reject', requireRoleOrPerm(['Admin','Manager'], 'approve_adjustments'), async (req, res) => {
  const { id, remark } = req.body || {};
  const row = await AdjustmentRequest.findById(id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.status !== 'pending_approval') return res.status(400).json({ error: 'Request not pending' });
  row.status = 'rejected';
  row.approverName = req.user?.name || '';
  row.approverRole = req.user?.role || '';
  row.rejectionRemark = String(remark || '');
  row.rejected_at = new Date();
  await row.save();
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'adjustment_reject',
    details: { id: String(row._id), productId: row.productId, variantId: row.variantId || '', delta: row.delta, branchId: row.branchId, itemCount: Array.isArray(row.items) ? row.items.length : 0 },
    remark: String(remark || ''),
    branchId: row.branchId
  });
  res.json({ ok: true, request: row });
});

export default r;
