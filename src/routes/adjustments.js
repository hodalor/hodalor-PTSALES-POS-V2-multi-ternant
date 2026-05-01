import { Router } from 'express';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import AdjustmentRequest from '../models/AdjustmentRequest.js';
import mongoose from 'mongoose';
import { adjustSerializedUnits, normalizeTrackType, resolveInventoryTypeFromBranch } from '../utils/productUnits.js';
import { getMapQty, getStockTarget, markInventoryModified, setMapQty } from '../utils/inventory.js';
import { safeErrorMessage, safeErrorStatus } from '../utils/safeError.js';

const r = Router();
r.use(requireAuth);

function canDirectorApproveRetail(user) {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  return ['superadmin', 'admin', 'director'].includes(role)
    || grants.includes('approve_wholesale_director')
    || grants.includes('approve_credit_director')
    || grants.includes('approve_adjustments');
}

function canManagerApproveRetail(user) {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  return ['superadmin', 'admin', 'manager'].includes(role)
    || grants.includes('approve_wholesale_manager')
    || grants.includes('approve_credit_manager')
    || grants.includes('approve_adjustments');
}

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

async function adjustBaseStock(productId, branchId, delta, inventoryType = 'retail') {
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  const target = getStockTarget(p, '', inventoryType);
  if (!target) {
    const err = new Error('Product stock target not found');
    err.status = 400;
    throw err;
  }
  const cur = getMapQty(target.container, branchId);
  const next = cur + Number(delta);
  if (next < 0) {
    const err = new Error('Insufficient stock for adjustment');
    err.status = 400;
    throw err;
  }
  setMapQty(target.container, branchId, next);
  markInventoryModified(target);
  await p.save();
  return p;
}

async function adjustVariantStock(productId, variantId, branchId, delta, inventoryType = 'retail') {
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  const target = getStockTarget(p, variantId, inventoryType);
  if (!target) {
    const err = new Error('Variant not found');
    err.status = 400;
    throw err;
  }
  const cur = getMapQty(target.container, branchId);
  const next = cur + Number(delta);
  if (next < 0) {
    const err = new Error('Insufficient stock for adjustment');
    err.status = 400;
    throw err;
  }
  setMapQty(target.container, branchId, next);
  markInventoryModified(target);
  await p.save();
  return p;
}

r.get('/requests', requireRoleOrPerm(['Admin','Manager','Director'], 'approve_adjustments'), async (req, res) => {
  const statusRaw = String(req.query.status || '').trim().toLowerCase();
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 200));
  const map = { pending: 'pending_approval', pending_director: 'pending_director', pending_manager: 'pending_manager', approved: 'approved', rejected: 'rejected' };
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
    transactionTitle: String((req.body || {}).transactionTitle || '').trim(),
    remark: String(remark || ''),
    items: draftItems,
    status: 'pending_director',
    initiatorName: req.user?.name || '',
    initiatorRole: req.user?.role || ''
  });
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'adjustment_request_create',
    details: { id: String(row._id), productId: row.productId, variantId: row.variantId || '', delta: row.delta, branchId: row.branchId, transactionTitle: row.transactionTitle || '', itemCount: Array.isArray(row.items) ? row.items.length : 0 },
    remark: row.remark || '',
    branchId: row.branchId
  });
  res.json(row);
});

r.post('/approve', requireRoleOrPerm(['Admin','Manager','Director'], 'approve_adjustments'), async (req, res) => {
  const { id, remark, items: reviewedItems } = req.body || {};
  const row = await AdjustmentRequest.findById(id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (!['pending_approval', 'pending_director', 'pending_manager'].includes(String(row.status || ''))) return res.status(400).json({ error: 'Request not pending' });
  const nextItems = normalizeItems({ items: reviewedItems && reviewedItems.length ? reviewedItems : (row.items || []) });
  if (String(row.status || '') === 'pending_approval' || String(row.status || '') === 'pending_director') {
    if (!canDirectorApproveRetail(req.user)) return res.status(403).json({ error: 'Director approval required' });
    row.status = 'pending_manager';
    row.items = nextItems;
    row.directorApproverName = req.user?.name || '';
    row.directorApproverRole = req.user?.role || '';
    row.directorApprovalRemark = String(remark || '');
    row.directorApproved_at = new Date();
    await row.save();
    return res.json({ ok: true, request: row });
  }
  if (!canManagerApproveRetail(req.user)) return res.status(403).json({ error: 'Manager approval required' });
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
        p = await adjustVariantStock(item.productId, item.variantId, row.branchId, item.delta, inventoryType);
      } else {
        p = await adjustBaseStock(item.productId, row.branchId, item.delta, inventoryType);
      }
    }
  } catch (e) {
    return res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to apply adjustment') });
  }
  row.status = 'approved';
  row.managerApproverName = req.user?.name || '';
  row.managerApproverRole = req.user?.role || '';
  row.managerApprovalRemark = String(remark || '');
  row.managerApproved_at = new Date();
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

r.post('/reject', requireRoleOrPerm(['Admin','Manager','Director'], 'approve_adjustments'), async (req, res) => {
  const { id, remark } = req.body || {};
  const row = await AdjustmentRequest.findById(id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (!['pending_approval', 'pending_director', 'pending_manager'].includes(String(row.status || ''))) return res.status(400).json({ error: 'Request not pending' });
  const currentStatus = String(row.status || '');
  if ((currentStatus === 'pending_approval' || currentStatus === 'pending_director') && !canDirectorApproveRetail(req.user)) {
    return res.status(403).json({ error: 'Director approval required' });
  }
  if (currentStatus === 'pending_manager' && !canManagerApproveRetail(req.user)) {
    return res.status(403).json({ error: 'Manager approval required' });
  }
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
