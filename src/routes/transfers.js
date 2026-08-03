import { Router } from 'express';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import TransferRequest from '../models/TransferRequest.js';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { normalizeTrackType, resolveInventoryTypeFromBranch, transferSerializedUnits } from '../utils/productUnits.js';
import { getStockTarget, getMapQty, markInventoryModified, setMapQty } from '../utils/inventory.js';
import { safeErrorMessage } from '../utils/safeError.js';

const r = Router();
r.use(requireAuth);

function reportRetailTransferApprovalDebug({ hypothesisId = 'A', location = '', msg = '', data = {}, runId = 'pre-fix' } = {}) {
  const envCandidates = [
    path.resolve(process.cwd(), '.dbg', 'retail-transfer-approval.env'),
    path.resolve(process.cwd(), '..', '.dbg', 'retail-transfer-approval.env')
  ];
  let url = 'http://127.0.0.1:7777/event';
  let sessionId = 'retail-transfer-approval';
  for (const candidate of envCandidates) {
    try {
      const envText = fs.readFileSync(candidate, 'utf8');
      url = envText.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
      sessionId = envText.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
      break;
    } catch {}
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

function canDirectorApproveRetail(user, approvalArea = 'retail') {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  if (['superadmin', 'admin', 'director'].includes(role)) return true;
  if (approvalArea === 'warehouse') return grants.includes('approve_warehouse_director') || grants.includes('approve_transfers');
  if (approvalArea === 'wholesale') return grants.includes('approve_distribution_director') || grants.includes('approve_transfers');
  return grants.includes('approve_retail_director') || grants.includes('approve_transfers');
}

function canManagerApproveRetail(user, approvalArea = 'retail') {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  if (['superadmin', 'admin', 'manager'].includes(role)) return true;
  if (approvalArea === 'warehouse') return grants.includes('approve_warehouse_manager') || grants.includes('approve_transfers');
  if (approvalArea === 'wholesale') return grants.includes('approve_distribution_manager') || grants.includes('approve_transfers');
  return grants.includes('approve_retail_manager') || grants.includes('approve_transfers');
}

async function resolveTransferApprovalArea(transfer) {
  const toInventoryType = await resolveInventoryTypeFromBranch(transfer?.to, 'retail');
  return toInventoryType === 'warehouse' ? 'warehouse' : toInventoryType === 'wholesale' ? 'wholesale' : 'retail';
}

function productLookupQuery(productId) {
  const pid = String(productId || '');
  const or = [{ id: pid }];
  if (mongoose.isValidObjectId(pid)) or.unshift({ _id: pid });
  return { $or: or };
}
function normalizeItems(payload = {}) {
  const raw = Array.isArray(payload.items) && payload.items.length > 0
    ? payload.items
    : [{
        lineId: payload.clientId || '',
        productId: payload.productId,
        variantId: payload.variantId || '',
        qty: payload.qty,
        remark: payload.remark || '',
        status: 'pending'
      }];
  return raw
    .map((item, index) => ({
      lineId: String(item.lineId || `${index + 1}`),
      productId: String(item.productId || ''),
      variantId: String(item.variantId || ''),
      qty: Number(item.qty || 0),
      unitIds: Array.isArray(item.unitIds) ? item.unitIds.map(String).filter(Boolean) : [],
      selectedUnits: Array.isArray(item.selectedUnits) ? item.selectedUnits.map(unit => ({ unitId: String(unit?.unitId || ''), imei: String(unit?.imei || '').trim(), serialNumber: String(unit?.serialNumber || '').trim() })) : [],
      remark: String(item.remark || ''),
      status: String(item.status || 'pending').toLowerCase() === 'cancelled' ? 'cancelled' : 'accepted'
    }))
    .filter(item => item.productId && item.qty > 0);
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
    q.$or = [
      { to: { $in: arr } },
      { from: { $in: arr } }
    ];
  }
  const limit = Math.min(1000, Math.max(20, Number(req.query?.limit || 200)));
  const rows = await TransferRequest.find(q).sort({ createdAt: -1 }).limit(limit).lean();
  res.json(rows);
});

r.post('/requests', requireRoleOrPerm(['Admin','Manager','Inventory Staff'], 'add_transfers'), async (req, res) => {
  const payload = req.body || {};
  const clientId = String(payload.clientId || '').trim();
  const role = String(req.user?.role || '').toLowerCase();
  const assigned = req.user?.assignedBranches ?? 'all';
  const fromBranch = String(payload.from || '').trim();
  const toBranch = String(payload.to || '').trim();
  if (!(role === 'superadmin' || role === 'admin') && assigned !== 'all') {
    const arr = (Array.isArray(assigned) ? assigned : [assigned]).map(String).filter(Boolean);
    if (!arr.includes(fromBranch)) {
      return res.status(403).json({ error: 'Forbidden for source branch' });
    }
  }
  if (!fromBranch || !toBranch) {
    return res.status(400).json({ error: 'Missing from or to branch' });
  }
  if (clientId) {
    const existing = await TransferRequest.findOne({ clientId });
    if (existing) return res.json(existing);
  }
  const doc = await TransferRequest.create({
    clientId: clientId || undefined,
    productId: payload.productId,
    variantId: payload.variantId || undefined,
    from: fromBranch,
    to: toBranch,
    qty: Number(payload.qty),
    transactionTitle: String(payload.transactionTitle || '').trim(),
    remark: payload.remark || '',
    items: normalizeItems(payload),
    status: 'pending_director',
    initiatorName: payload.initiatorName || req.user?.name || 'unknown',
    initiatorRole: payload.initiatorRole || req.user?.role || ''
  });
  await Audit.create({
    actor: doc.initiatorName || 'unknown',
    actionType: 'transfer_initiated',
    details: { productId: doc.productId, from: doc.from, to: doc.to, qty: Number(doc.qty || 0), transactionTitle: doc.transactionTitle || '', itemCount: Array.isArray(doc.items) ? doc.items.length : 0 },
    remark: doc.remark || '',
    branchId: doc.from
  });
  res.json(doc);
});

r.post('/approve', requireRoleOrPerm(['Admin','Manager','Director'], ['approve_transfers', 'approve_retail_director', 'approve_retail_manager']), async (req, res) => {
  const { id, approverName, approverRole, remark, items: reviewedItems } = req.body || {};
  // #region debug-point A:approve-entry
  reportRetailTransferApprovalDebug({
    hypothesisId: 'A',
    location: 'transfers.js:approve:entry',
    msg: '[DEBUG] Retail transfer approval request received',
    data: {
      transferId: String(id || ''),
      actorName: String(req.user?.name || ''),
      actorRole: String(req.user?.role || ''),
      grants: Array.isArray(req.user?.grants) ? req.user.grants : [],
      assignedBranches: req.user?.assignedBranches ?? 'all',
      hasRemark: !!String(remark || '').trim()
    }
  });
  // #endregion
  if (!remark || !String(remark).trim()) return res.status(400).json({ error: 'Approval remark required' });
  const key = String(id || '');
  const or = [];
  if (mongoose.isValidObjectId(key)) or.push({ _id: key });
  or.push({ clientId: key });
  const tr = await TransferRequest.findOne({ $or: or });
  // #region debug-point A:approve-transfer-loaded
  reportRetailTransferApprovalDebug({
    hypothesisId: 'A',
    location: 'transfers.js:approve:transfer-loaded',
    msg: '[DEBUG] Retail transfer approval loaded transfer record',
    data: {
      transferId: String(tr?._id || tr?.clientId || key),
      found: !!tr,
      status: String(tr?.status || ''),
      fromBranchId: String(tr?.from || ''),
      toBranchId: String(tr?.to || ''),
      itemCount: Array.isArray(tr?.items) ? tr.items.length : 0
    }
  });
  // #endregion
  if (!tr) return res.status(404).json({ error: 'Not found' });
  if (!['pending_approval', 'pending_director', 'pending_manager'].includes(String(tr.status || ''))) return res.json(tr);
  const approvalArea = await resolveTransferApprovalArea(tr);
  // #region debug-point A:approve-area
  reportRetailTransferApprovalDebug({
    hypothesisId: 'A',
    location: 'transfers.js:approve:approval-area',
    msg: '[DEBUG] Retail transfer approval area resolved',
    data: {
      transferId: String(tr?._id || tr?.clientId || ''),
      status: String(tr?.status || ''),
      approvalArea,
      fromBranchId: String(tr?.from || ''),
      toBranchId: String(tr?.to || '')
    }
  });
  // #endregion
  const role = String(req.user?.role || '').toLowerCase();
  const assigned = req.user?.assignedBranches ?? 'all';
  if (!(role === 'superadmin' || role === 'admin')) {
    if (assigned !== 'all') {
      const arr = Array.isArray(assigned) ? assigned : [assigned];
      const currentStatus = String(tr.status || '');
      const canAccessDirectorStage = arr.includes(tr.from) || arr.includes(tr.to);
      const canAccessManagerStage = arr.includes(tr.to);
      // #region debug-point D:approve-branch-access
      reportRetailTransferApprovalDebug({
        hypothesisId: 'D',
        location: 'transfers.js:approve:branch-access',
        msg: '[DEBUG] Retail transfer branch access evaluated',
        data: {
          transferId: String(tr?._id || tr?.clientId || ''),
          currentStatus,
          assignedBranches: arr,
          canAccessDirectorStage,
          canAccessManagerStage,
          fromBranchId: String(tr?.from || ''),
          toBranchId: String(tr?.to || '')
        }
      });
      // #endregion
      if ((currentStatus === 'pending_approval' || currentStatus === 'pending_director') && !canAccessDirectorStage) {
        return res.status(403).json({ error: 'Forbidden for branch' });
      }
      if (currentStatus === 'pending_manager' && !canAccessManagerStage) {
        return res.status(403).json({ error: 'Forbidden for destination branch' });
      }
    }
  }
  const nextItems = normalizeItems({ items: reviewedItems && reviewedItems.length ? reviewedItems : (tr.items || []) });
  if (String(tr.status || '') === 'pending_approval' || String(tr.status || '') === 'pending_director') {
    const canDirectorApprove = canDirectorApproveRetail(req.user, approvalArea);
    // #region debug-point C:director-gate
    reportRetailTransferApprovalDebug({
      hypothesisId: 'C',
      location: 'transfers.js:approve:director-gate',
      msg: '[DEBUG] Retail transfer director gate evaluated',
      data: {
        transferId: String(tr?._id || tr?.clientId || ''),
        status: String(tr?.status || ''),
        approvalArea,
        canDirectorApprove,
        actorRole: String(req.user?.role || ''),
        grants: Array.isArray(req.user?.grants) ? req.user.grants : []
      }
    });
    // #endregion
    if (!canDirectorApprove) return res.status(403).json({ error: 'Director approval required' });
    tr.status = 'pending_manager';
    tr.items = nextItems;
    tr.directorApproverName = approverName || req.user?.name || 'unknown';
    tr.directorApproverRole = approverRole || req.user?.role || '';
    tr.directorApprovalRemark = String(remark || '').trim();
    tr.directorApproved_at = new Date();
    await tr.save();
    return res.json(tr);
  }
  const canManagerApprove = canManagerApproveRetail(req.user, approvalArea);
  // #region debug-point C:manager-gate
  reportRetailTransferApprovalDebug({
    hypothesisId: 'C',
    location: 'transfers.js:approve:manager-gate',
    msg: '[DEBUG] Retail transfer manager gate evaluated',
    data: {
      transferId: String(tr?._id || tr?.clientId || ''),
      status: String(tr?.status || ''),
      approvalArea,
      canManagerApprove,
      actorRole: String(req.user?.role || ''),
      grants: Array.isArray(req.user?.grants) ? req.user.grants : []
    }
  });
  // #endregion
  if (!canManagerApprove) return res.status(403).json({ error: 'Manager approval required' });
  let lastProduct = null;
  const fromInventoryType = await resolveInventoryTypeFromBranch(tr.from, 'retail');
  const toInventoryType = await resolveInventoryTypeFromBranch(tr.to, 'retail');
  try {
    for (const item of nextItems) {
      if (item.status === 'cancelled') continue;
      const q = Math.abs(Number(item.qty));
      if (!Number.isFinite(q) || q <= 0) continue;
      const p = await Product.findOne(productLookupQuery(item.productId));
      if (!p) return res.status(404).json({ error: 'Product not found' });
      if (normalizeTrackType(p.trackType) === 'serialized') {
        if (!Array.isArray(item.unitIds) || item.unitIds.length !== q) {
          return res.status(400).json({ error: `Serialized transfer for ${p.name} requires exactly ${q} selected unit(s)` });
        }
        // #region debug-point C:legacy-transfer-serialized
        import('node:fs').then(({ default: fs }) => { let u = 'http://127.0.0.1:7777/event'; let s = 'warehouse-transfer-source-stock'; try { const e = fs.readFileSync('.dbg/warehouse-transfer-source-stock.env', 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s; } catch {} return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre-fix', hypothesisId: 'C', location: 'transfers.js:legacy-transfer-serialized', msg: '[DEBUG] Legacy transfer serialized approval executing', data: { transferId: String(tr?._id || tr?.clientId || ''), fromBranchId: String(tr?.from || ''), toBranchId: String(tr?.to || ''), fromInventoryType, toInventoryType, productId: String(item?.productId || ''), variantId: String(item?.variantId || ''), qty: q, unitCount: Array.isArray(item?.unitIds) ? item.unitIds.length : 0 }, ts: Date.now() }) }).catch(() => {}); }).catch(() => {});
        // #endregion
        await transferSerializedUnits({
          productId: item.productId,
          variantId: item.variantId || '',
          fromBranchId: tr.from,
          toBranchId: tr.to,
          fromInventoryType,
          toInventoryType,
          unitIds: item.unitIds
        });
        lastProduct = p;
        continue;
      }
      const fromTarget = getStockTarget(p, item.variantId || '', fromInventoryType);
      const toTarget = getStockTarget(p, item.variantId || '', toInventoryType);
      if (!fromTarget || !toTarget) return res.status(400).json({ error: 'Variant not found' });
      const curFrom = getMapQty(fromTarget.container, tr.from);
      if (curFrom < q) return res.status(400).json({ error: 'Insufficient stock for transfer' });
      const curTo = getMapQty(toTarget.container, tr.to);
      // #region debug-point D:legacy-transfer-before
      import('node:fs').then(({ default: fs }) => { let u = 'http://127.0.0.1:7777/event'; let s = 'warehouse-transfer-source-stock'; try { const e = fs.readFileSync('.dbg/warehouse-transfer-source-stock.env', 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s; } catch {} return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre-fix', hypothesisId: 'D', location: 'transfers.js:legacy-transfer-before', msg: '[DEBUG] Legacy transfer before stock mutation', data: { transferId: String(tr?._id || tr?.clientId || ''), fromBranchId: String(tr?.from || ''), toBranchId: String(tr?.to || ''), fromInventoryType, toInventoryType, productId: String(item?.productId || ''), variantId: String(item?.variantId || ''), qty: q, fromCurrent: curFrom, toCurrent: curTo }, ts: Date.now() }) }).catch(() => {}); }).catch(() => {});
      // #endregion
      setMapQty(fromTarget.container, tr.from, curFrom - q);
      setMapQty(toTarget.container, tr.to, curTo + q);
      // #region debug-point D:legacy-transfer-after
      import('node:fs').then(({ default: fs }) => { let u = 'http://127.0.0.1:7777/event'; let s = 'warehouse-transfer-source-stock'; try { const e = fs.readFileSync('.dbg/warehouse-transfer-source-stock.env', 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s; } catch {} return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre-fix', hypothesisId: 'D', location: 'transfers.js:legacy-transfer-after', msg: '[DEBUG] Legacy transfer after stock mutation', data: { transferId: String(tr?._id || tr?.clientId || ''), fromBranchId: String(tr?.from || ''), toBranchId: String(tr?.to || ''), fromInventoryType, toInventoryType, productId: String(item?.productId || ''), variantId: String(item?.variantId || ''), qty: q, fromNext: getMapQty(fromTarget.container, tr.from), toNext: getMapQty(toTarget.container, tr.to) }, ts: Date.now() }) }).catch(() => {}); }).catch(() => {});
      // #endregion
      markInventoryModified(fromTarget);
      markInventoryModified(toTarget);
      await p.save();
      lastProduct = p;
    }
  } catch (e) {
    return res.status(500).json({ error: safeErrorMessage(e, 'Failed to transfer stock') });
  }
  tr.status = 'approved';
  tr.managerApproverName = approverName || req.user?.name || 'unknown';
  tr.managerApproverRole = approverRole || req.user?.role || '';
  tr.managerApprovalRemark = String(remark || '').trim();
  tr.managerApproved_at = new Date();
  tr.approverName = approverName || req.user?.name || 'unknown';
  tr.approverRole = approverRole || req.user?.role || '';
  tr.approvalRemark = String(remark || '').trim();
  tr.items = nextItems;
  tr.approved_at = new Date();
  await tr.save();
  await Audit.create({
    actor: approverName || 'unknown',
    actionType: 'stock_transfer',
    details: { product: lastProduct?.name || tr.productId, from: tr.from, to: tr.to, fromInventoryType, toInventoryType, qty: Math.abs(Number(tr.qty || 0)), itemCount: nextItems.length, acceptedCount: nextItems.filter(item => item.status !== 'cancelled').length },
    remark: tr.approvalRemark || tr.remark || '',
    branchId: tr.from
  });
  await ServerLog.create({
    level: 'info',
    actor: approverName || req.user?.name || 'unknown',
    route: '/api/transfers/approve',
    method: 'POST',
    status: 200,
      message: `Stock transfer approved (${nextItems.filter(item => item.status !== 'cancelled').length} item(s)) ${tr.from} -> ${tr.to}`
  });
  res.json(tr);
});

r.post('/reject', requireRoleOrPerm(['Admin','Manager','Director'], ['approve_transfers', 'approve_retail_director', 'approve_retail_manager']), async (req, res) => {
  const { id, approverName, approverRole, remark } = req.body || {};
  if (!remark || !String(remark).trim()) return res.status(400).json({ error: 'Rejection remark required' });
  const key = String(id || '');
  const or = [];
  if (mongoose.isValidObjectId(key)) or.push({ _id: key });
  or.push({ clientId: key });
  const tr = await TransferRequest.findOne({ $or: or });
  if (!tr) return res.status(404).json({ error: 'Not found' });
  if (!['pending_approval', 'pending_director', 'pending_manager'].includes(String(tr.status || ''))) return res.json(tr);
  const approvalArea = await resolveTransferApprovalArea(tr);
  const currentStatus = String(tr.status || '');
  if ((currentStatus === 'pending_approval' || currentStatus === 'pending_director') && !canDirectorApproveRetail(req.user, approvalArea)) {
    return res.status(403).json({ error: 'Director approval required' });
  }
  if (currentStatus === 'pending_manager' && !canManagerApproveRetail(req.user, approvalArea)) {
    return res.status(403).json({ error: 'Manager approval required' });
  }
  const role = String(req.user?.role || '').toLowerCase();
  const assigned = req.user?.assignedBranches ?? 'all';
  if (!(role === 'superadmin' || role === 'admin')) {
    if (assigned !== 'all') {
      const arr = Array.isArray(assigned) ? assigned : [assigned];
      const canAccessDirectorStage = arr.includes(tr.from) || arr.includes(tr.to);
      const canAccessManagerStage = arr.includes(tr.to);
      if ((currentStatus === 'pending_approval' || currentStatus === 'pending_director') && !canAccessDirectorStage) {
        return res.status(403).json({ error: 'Forbidden for branch' });
      }
      if (currentStatus === 'pending_manager' && !canAccessManagerStage) {
        return res.status(403).json({ error: 'Forbidden for destination branch' });
      }
    }
  }
  tr.status = 'rejected';
  tr.approverName = approverName || 'unknown';
  tr.approverRole = approverRole || '';
  tr.rejectionRemark = String(remark || '').trim();
  tr.rejected_at = new Date();
  await tr.save();
  await Audit.create({
    actor: approverName || 'unknown',
    actionType: 'transfer_rejected',
    details: { productId: tr.productId, from: tr.from, to: tr.to, qty: Number(tr.qty || 0), itemCount: Array.isArray(tr.items) ? tr.items.length : 0 },
    remark: tr.rejectionRemark || tr.remark || '',
    branchId: tr.from
  });
  res.json(tr);
});

export default r;
