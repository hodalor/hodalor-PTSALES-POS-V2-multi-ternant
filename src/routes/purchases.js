import { Router } from 'express';
import mongoose from 'mongoose';
import PurchaseRequest from '../models/PurchaseRequest.js';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { createSerializedUnits, normalizeTrackType, resolveInventoryTypeFromBranch } from '../utils/productUnits.js';
import { safeErrorMessage } from '../utils/safeError.js';

const r = Router();
r.use(requireAuth);

function canDirectorApproveRetail(user) {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  return ['superadmin', 'admin', 'director'].includes(role)
    || grants.includes('approve_wholesale_director')
    || grants.includes('approve_credit_director')
    || grants.includes('approve_purchases');
}

function canManagerApproveRetail(user) {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  return ['superadmin', 'admin', 'manager'].includes(role)
    || grants.includes('approve_wholesale_manager')
    || grants.includes('approve_credit_manager')
    || grants.includes('approve_purchases');
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
  if (typeof mapLike.set === 'function') mapLike.set(branchId, qty);
  else mapLike[branchId] = qty;
}
function normalizeItems(payload = {}) {
  const raw = Array.isArray(payload.items) && payload.items.length > 0
    ? payload.items
    : [{
        lineId: payload.clientId || '',
        productId: payload.productId,
        variantId: payload.variantId || '',
        baseUnits: payload.baseUnits,
        pack: payload.pack || '',
        supplier: payload.supplier || '',
        cost: payload.cost,
        costPerUnit: payload.costPerUnit,
        expiryDate: payload.expiryDate,
        remark: payload.remark || '',
        status: 'pending'
      }];
  return raw
    .map((item, index) => ({
      lineId: String(item.lineId || `${index + 1}`),
      productId: String(item.productId || ''),
      variantId: String(item.variantId || ''),
      baseUnits: Number(item.baseUnits || 0),
      serializedEntries: Array.isArray(item.serializedEntries) ? item.serializedEntries.map(entry => ({ imei: String(entry?.imei || '').trim(), serialNumber: String(entry?.serialNumber || '').trim() })) : [],
      pack: String(item.pack || ''),
      supplier: String(item.supplier || ''),
      cost: Number(item.cost || 0),
      costPerUnit: Number(item.costPerUnit || 0),
      expiryDate: item.expiryDate || undefined,
      remark: String(item.remark || ''),
      status: String(item.status || 'pending').toLowerCase() === 'cancelled' ? 'cancelled' : 'accepted'
    }))
    .filter(item => item.productId && item.baseUnits > 0);
}

r.get('/requests', async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  const assigned = req.user?.assignedBranches ?? 'all';
  const statusRaw = String(req.query?.status || '').trim().toLowerCase();
  const map = { pending: 'pending_approval', pending_director: 'pending_director', pending_manager: 'pending_manager', approved: 'approved', rejected: 'rejected' };
  const q = {};
  if (map[statusRaw]) q.status = map[statusRaw];
  if (!(role === 'superadmin' || role === 'admin') && assigned !== 'all') {
    const arr = Array.isArray(assigned) ? assigned : [assigned];
    q.branchId = { $in: arr };
  }
  const limit = Math.min(1000, Math.max(20, Number(req.query?.limit || 200)));
  if (String(req.query?.status || '') === 'pending') q.status = { $in: ['pending_approval', 'pending_director', 'pending_manager'] };
  const rows = await PurchaseRequest.find(q).sort({ createdAt: -1 }).limit(limit).lean();
  res.json(rows);
});

r.post('/requests', requireRoleOrPerm(['Admin','Manager','Inventory Staff'], 'add_purchases'), async (req, res) => {
  const payload = req.body || {};
  const clientId = String(payload.clientId || '').trim();
  if (clientId) {
    const existing = await PurchaseRequest.findOne({ clientId });
    if (existing) return res.json(existing);
  }
  const pr = await PurchaseRequest.create({
    ...payload,
    status: 'pending_director',
    clientId: clientId || undefined,
    transactionTitle: String(payload.transactionTitle || '').trim(),
    items: normalizeItems(payload)
  });
  await Audit.create({
    actor: pr.initiatorName || 'unknown',
    actionType: 'purchase_initiated',
    details: { productId: pr.productId, variantId: pr.variantId || '', baseUnits: Number(pr.baseUnits || 0), supplier: pr.supplier || '', transactionTitle: pr.transactionTitle || '', cost: Number(pr.cost) || 0, itemCount: Array.isArray(pr.items) ? pr.items.length : 0 },
    remark: pr.remark || '',
    branchId: pr.branchId
  });
  res.json(pr);
});

r.post('/approve', requireRoleOrPerm(['Admin','Manager','Director'], 'approve_purchases'), async (req, res) => {
  const { id, approverName, approverRole, remark, items: reviewedItems } = req.body || {};
  if (!remark || !String(remark).trim()) return res.status(400).json({ error: 'Approval remark required' });
  const key = String(id || '');
  const or = [];
  if (mongoose.isValidObjectId(key)) or.push({ _id: key });
  or.push({ clientId: key });
  const pr = await PurchaseRequest.findOne({ $or: or });
  if (!pr) return res.status(404).json({ error: 'Not found' });
  if (!['pending_approval', 'pending_director', 'pending_manager'].includes(String(pr.status || ''))) return res.json(pr);
  const role = String(req.user?.role || '').toLowerCase();
  const assigned = req.user?.assignedBranches ?? 'all';
  if (!(role === 'superadmin' || role === 'admin')) {
    if (assigned !== 'all') {
      const arr = Array.isArray(assigned) ? assigned : [assigned];
      if (!arr.includes(pr.branchId)) return res.status(403).json({ error: 'Forbidden for branch' });
    }
  }

  const nextItems = normalizeItems({ items: reviewedItems && reviewedItems.length ? reviewedItems : (pr.items || []) });
  if (String(pr.status || '') === 'pending_approval' || String(pr.status || '') === 'pending_director') {
    if (!canDirectorApproveRetail(req.user)) return res.status(403).json({ error: 'Director approval required' });
    pr.status = 'pending_manager';
    pr.directorApproverName = approverName || req.user?.name || 'unknown';
    pr.directorApproverRole = approverRole || req.user?.role || '';
    pr.directorApprovalRemark = String(remark || '').trim();
    pr.directorApproved_at = new Date();
    pr.items = nextItems;
    await pr.save();
    return res.json(pr);
  }
  if (!canManagerApproveRetail(req.user)) return res.status(403).json({ error: 'Manager approval required' });
  let lastProduct = null;
  try {
    const inventoryType = await resolveInventoryTypeFromBranch(pr.branchId, 'retail');
    for (const item of nextItems) {
      if (item.status === 'cancelled') continue;
      const q = Number(item.baseUnits);
      if (!Number.isFinite(q) || q <= 0) continue;
      const doc = await Product.findOne(productLookupQuery(item.productId));
      if (!doc) return res.status(404).json({ error: 'Product not found' });
      if (normalizeTrackType(doc.trackType) === 'serialized') {
        if (!Array.isArray(item.serializedEntries) || item.serializedEntries.length !== q) {
          return res.status(400).json({ error: `Serialized purchase for ${doc.name} requires exactly ${q} IMEI/serial entries` });
        }
        await createSerializedUnits({
          productId: item.productId,
          variantId: item.variantId || '',
          branchId: pr.branchId,
          inventoryType,
          entries: item.serializedEntries
        });
        const cpu = item.costPerUnit != null ? Number(item.costPerUnit) : null;
        if (cpu != null && Number.isFinite(cpu) && cpu >= 0) doc.costPrice = cpu;
        if (item.expiryDate) {
          const dt = new Date(item.expiryDate);
          if (!Number.isNaN(dt.getTime())) doc.expiryDate = dt;
        }
        if (cpu != null || item.expiryDate) await doc.save();
        lastProduct = doc;
        continue;
      }
      if (item.variantId) {
        const variants = Array.isArray(doc.variants) ? doc.variants : [];
        const idx = variants.findIndex(v => v.id === item.variantId);
        if (idx < 0) return res.status(400).json({ error: 'Variant not found' });
        const v = variants[idx];
        if (!v.stockByBranch) v.stockByBranch = new Map();
        const cur = getBranchQty(v.stockByBranch, pr.branchId);
        setBranchQty(v.stockByBranch, pr.branchId, Math.max(0, cur + q));
        doc.variants[idx] = v;
        doc.markModified('variants');
      } else {
        if (!doc.stockByBranch) doc.stockByBranch = new Map();
        const cur = getBranchQty(doc.stockByBranch, pr.branchId);
        setBranchQty(doc.stockByBranch, pr.branchId, Math.max(0, cur + Number(q)));
        doc.markModified('stockByBranch');
      }
      const cpu = item.costPerUnit != null ? Number(item.costPerUnit) : null;
      if (cpu != null && Number.isFinite(cpu) && cpu >= 0) doc.costPrice = cpu;
      if (item.expiryDate) {
        const dt = new Date(item.expiryDate);
        if (!Number.isNaN(dt.getTime())) doc.expiryDate = dt;
      }
      await doc.save();
      lastProduct = doc;
    }
  } catch (e) {
    return res.status(500).json({ error: safeErrorMessage(e, 'Failed to receive stock') });
  }

  pr.status = 'approved';
  pr.managerApproverName = approverName || req.user?.name || 'unknown';
  pr.managerApproverRole = approverRole || req.user?.role || '';
  pr.managerApprovalRemark = String(remark || '').trim();
  pr.managerApproved_at = new Date();
  pr.approverName = approverName || req.user?.name || 'unknown';
  pr.approverRole = approverRole || req.user?.role || '';
  pr.approvalRemark = String(remark || '').trim();
  pr.items = nextItems;
  pr.approved_at = new Date();
  await pr.save();

  await Audit.create({
    actor: approverName || 'unknown',
    actionType: 'stock_receive',
    details: { product: lastProduct?.name || pr.productId, baseUnits: Number(pr.baseUnits), supplier: pr.supplier || '', cost: Number(pr.cost) || 0, costPerUnit: Number(pr.costPerUnit || 0), expiryDate: pr.expiryDate || null, branchId: pr.branchId, itemCount: nextItems.length, acceptedCount: nextItems.filter(item => item.status !== 'cancelled').length },
    remark: remark || pr.remark || '',
    branchId: pr.branchId
  });
  try {
    await ServerLog.create({
      level: 'info',
      actor: approverName || req.user?.name || 'unknown',
      route: '/api/purchases/approve',
      method: 'POST',
      status: 200,
      message: `Purchase approved (${nextItems.filter(item => item.status !== 'cancelled').length} item(s)) @ ${pr.branchId}`
    });
  } catch {}
  res.json(pr);
});

r.post('/reject', requireRoleOrPerm(['Admin','Manager','Director'], 'approve_purchases'), async (req, res) => {
  const { id, approverName, approverRole, remark } = req.body || {};
  if (!remark || !String(remark).trim()) return res.status(400).json({ error: 'Rejection remark required' });
  const key = String(id || '');
  const or = [];
  if (mongoose.isValidObjectId(key)) or.push({ _id: key });
  or.push({ clientId: key });
  const pr = await PurchaseRequest.findOne({ $or: or });
  if (!pr) return res.status(404).json({ error: 'Not found' });
  if (!['pending_approval', 'pending_director', 'pending_manager'].includes(String(pr.status || ''))) return res.json(pr);
  const role = String(req.user?.role || '').toLowerCase();
  const assigned = req.user?.assignedBranches ?? 'all';
  if (!(role === 'superadmin' || role === 'admin')) {
    if (assigned !== 'all') {
      const arr = Array.isArray(assigned) ? assigned : [assigned];
      if (!arr.includes(pr.branchId)) return res.status(403).json({ error: 'Forbidden for branch' });
    }
  }
  const currentStatus = String(pr.status || '');
  if ((currentStatus === 'pending_approval' || currentStatus === 'pending_director') && !canDirectorApproveRetail(req.user)) {
    return res.status(403).json({ error: 'Director approval required' });
  }
  if (currentStatus === 'pending_manager' && !canManagerApproveRetail(req.user)) {
    return res.status(403).json({ error: 'Manager approval required' });
  }
  pr.status = 'rejected';
  pr.approverName = approverName || 'unknown';
  pr.approverRole = approverRole || '';
  pr.rejectionRemark = String(remark || '').trim();
  pr.rejected_at = new Date();
  await pr.save();
  await Audit.create({
    actor: approverName || 'unknown',
    actionType: 'purchase_rejected',
    details: { productId: pr.productId, baseUnits: Number(pr.baseUnits || 0) },
    remark: pr.rejectionRemark || pr.remark || '',
    branchId: pr.branchId
  });
  res.json(pr);
});

export default r;
