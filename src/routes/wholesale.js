import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import WholesaleOperation from '../models/WholesaleOperation.js';
import Approval from '../models/Approval.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { createApprovalForReference } from '../utils/approvalWorkflow.js';
import mongoose from 'mongoose';
import { archiveLiveDocument } from '../utils/superBin.js';

const r = Router();

r.use(requireAuth);

function reportTransferVisibilityDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  const envCandidates = [
    path.resolve(process.cwd(), '.dbg', 'transfer-visibility-value.env'),
    path.resolve(process.cwd(), '..', '.dbg', 'transfer-visibility-value.env')
  ];
  let url = 'http://127.0.0.1:7777/event';
  let sessionId = 'transfer-visibility-value';
  for (const candidate of envCandidates) {
    try {
      const text = fs.readFileSync(candidate, 'utf8');
      url = text.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
      sessionId = text.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
      break;
    } catch {}
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, runId: 'pre-fix', hypothesisId, location, msg, data, ts: Date.now() })
  }).catch(() => {});
}

function permissionForOperation(type = '', area = '') {
  const key = String(type || '').toLowerCase();
  const scope = String(area || '').toLowerCase() === 'warehouse' ? 'warehouse' : 'wholesale';
  if (key === 'purchase') return scope === 'warehouse' ? 'add_warehouse_purchases' : 'add_wholesale_purchases';
  if (key === 'transfer') return scope === 'warehouse' ? 'add_warehouse_transfers' : 'add_wholesale_transfers';
  if (key === 'adjustment') return scope === 'warehouse' ? 'add_warehouse_adjustments' : 'add_wholesale_adjustments';
  if (key === 'refund') return 'add_distribution_refunds';
  return '';
}

r.get('/operations', async (req, res) => {
  const query = {};
  if (req.query.status) query.status = String(req.query.status);
  if (req.query.operationType) query.operationType = String(req.query.operationType);
  if (req.query.operationArea) query.operationArea = String(req.query.operationArea);
  const paged = String(req.query.paged || '') === '1';
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 50) || 50));
  const role = String(req.user?.role || '').toLowerCase();
  const assigned = req.user?.assignedBranches ?? 'all';
  if (!(role === 'superadmin' || role === 'admin') && assigned !== 'all') {
    const arr = Array.from(new Set(
      [req.user?.branchId, ...(Array.isArray(assigned) ? assigned : [assigned])]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ));
    if (String(req.query.operationType || '').toLowerCase() === 'transfer') {
      query.$or = [
        { fromBranchId: { $in: arr } },
        { toBranchId: { $in: arr } },
        { branchId: { $in: arr } }
      ];
    } else {
      query.branchId = { $in: arr };
    }
  }
  const total = paged ? await WholesaleOperation.countDocuments(query) : null;
  const rows = await WholesaleOperation.find(query)
    .sort({ createdAt: -1 })
    .skip(paged ? (page - 1) * pageSize : 0)
    .limit(paged ? pageSize : 500)
    .lean();
  const referenceIds = rows.map(row => String(row._id)).filter(Boolean);
  const approvals = referenceIds.length > 0
    ? await Approval.find({ referenceModel: 'WholesaleOperation', referenceId: { $in: referenceIds } }).lean()
    : [];
  const approvalByReferenceId = new Map(approvals.map(row => [String(row.referenceId), row]));
  const normalized = rows.map(row => {
    const approval = approvalByReferenceId.get(String(row._id));
    if (!approval) return row;
    return {
      ...row,
      approvalId: row.approvalId || String(approval._id),
      directorApprovedAt: approval.directorApprovedAt || null,
      directorApproved_at: approval.directorApprovedAt || null,
      directorApprovedByName: approval.directorApprovedByName || '',
      directorApprovedByRole: approval.directorApprovedByRole || '',
      directorApprovalRemark: approval.directorRemark || '',
      managerApprovedAt: approval.managerApprovedAt || null,
      managerApproved_at: approval.managerApprovedAt || null,
      managerApprovedByName: approval.managerApprovedByName || '',
      managerApprovedByRole: approval.managerApprovedByRole || '',
      managerApprovalRemark: approval.managerRemark || '',
      approvedAt: approval.status === 'approved' ? (approval.managerApprovedAt || approval.executedAt || approval.updatedAt || null) : null,
      approved_at: approval.status === 'approved' ? (approval.managerApprovedAt || approval.executedAt || approval.updatedAt || null) : null,
      rejectedAt: approval.status === 'rejected' ? (approval.rejectedAt || approval.updatedAt || null) : null,
      rejected_at: approval.status === 'rejected' ? (approval.rejectedAt || approval.updatedAt || null) : null,
      rejectionRemark: approval.status === 'rejected' ? (approval.managerRemark || approval.directorRemark || '') : '',
      status: ['pending_director', 'pending_manager', 'approved', 'rejected'].includes(String(approval.status || ''))
        ? String(approval.status)
        : row.status
    };
  });
  // #region debug-point A:operations-list
  reportTransferVisibilityDebug({
    hypothesisId: 'A',
    location: 'wholesale.js:get:operations',
    msg: '[DEBUG] Wholesale operations list resolved transfer rows',
    data: {
      status: String(req.query.status || ''),
      operationType: String(req.query.operationType || ''),
      operationArea: String(req.query.operationArea || ''),
      assignedBranches: req.user?.assignedBranches ?? 'all',
      query,
      rawRows: rows.filter((row) => String(row?.operationType || '').toLowerCase() === 'transfer').map((row) => ({
        id: String(row?._id || ''),
        status: String(row?.status || ''),
        operationArea: String(row?.operationArea || ''),
        fromBranchId: String(row?.fromBranchId || ''),
        toBranchId: String(row?.toBranchId || ''),
        qty: Number(row?.qty || 0),
        cost: Number(row?.cost || 0),
        itemCount: Array.isArray(row?.items) ? row.items.length : 0
      })).slice(0, 20),
      normalizedRows: normalized.filter((row) => String(row?.operationType || '').toLowerCase() === 'transfer').map((row) => ({
        id: String(row?._id || ''),
        status: String(row?.status || ''),
        operationArea: String(row?.operationArea || ''),
        fromBranchId: String(row?.fromBranchId || ''),
        toBranchId: String(row?.toBranchId || ''),
        qty: Number(row?.qty || 0),
        cost: Number(row?.cost || 0),
        itemCount: Array.isArray(row?.items) ? row.items.length : 0,
        approvalId: String(row?.approvalId || '')
      })).slice(0, 20)
    }
  });
  // #endregion
  if (paged) return res.json({ rows: normalized, total, page, pageSize });
  res.json(normalized);
});

r.post('/operations', requireRoleOrPerm(['Admin', 'Manager', 'Inventory Staff', 'Cashier'], ['add_purchases', 'add_wholesale_purchases', 'add_warehouse_purchases', 'add_transfers', 'add_wholesale_transfers', 'add_warehouse_transfers', 'add_adjustments', 'add_wholesale_adjustments', 'add_warehouse_adjustments', 'add_distribution_refunds']), async (req, res) => {
  const body = req.body || {};
  const operationArea = String(body.operationArea || 'wholesale').toLowerCase() === 'warehouse' ? 'warehouse' : 'wholesale';
  const operationType = String(body.operationType || '').toLowerCase();
  if (!['purchase', 'transfer', 'adjustment', 'refund'].includes(operationType)) {
    return res.status(400).json({ error: 'Invalid operationType' });
  }
  const specificPerm = permissionForOperation(operationType, operationArea);
  const role = String(req.user?.role || '').toLowerCase();
  const grants = Array.isArray(req.user?.grants) ? req.user.grants : [];
  if (!['admin', 'superadmin'].includes(role) && specificPerm && !grants.includes(specificPerm)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const qty = Math.max(0, Number(body.qty || 0));
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 && qty <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero' });
  if (items.length === 0 && !body.productId) return res.status(400).json({ error: 'Missing productId' });
  if (operationType === 'transfer' && (!body.fromBranchId || !body.toBranchId)) {
    return res.status(400).json({ error: 'Transfer requires fromBranchId and toBranchId' });
  }
  if (operationType !== 'transfer' && !body.branchId) {
    return res.status(400).json({ error: 'Branch is required' });
  }
  const op = await WholesaleOperation.create({
    clientId: body.clientId || undefined,
    operationArea,
    operationType,
    productId: String(body.productId),
    variantId: String(body.variantId || ''),
    branchId: String(body.branchId || ''),
    fromBranchId: String(body.fromBranchId || ''),
    toBranchId: String(body.toBranchId || ''),
    fromInventoryType: String(body.fromInventoryType || operationArea),
    toInventoryType: String(body.toInventoryType || (operationType === 'transfer' ? operationArea : operationArea)),
    qty,
    cost: Number(body.cost || 0),
    requestedAmount: Number(body.requestedAmount || 0),
    adjustmentType: String(body.adjustmentType || 'increase'),
    supplier: String(body.supplier || ''),
    transactionTitle: String(body.transactionTitle || '').trim(),
    reason: String(body.reason || ''),
    remark: String(body.remark || ''),
    items,
    initiatedByName: req.user?.name || 'unknown',
    initiatedByRole: req.user?.role || '',
    status: 'pending_director'
  });
  const approval = await createApprovalForReference({
    actionType: `${operationArea}_${operationType}`,
    referenceModel: 'WholesaleOperation',
    referenceId: String(op._id),
    initiatedByName: req.user?.name || 'unknown',
    initiatedByRole: req.user?.role || ''
  });
  res.json({
    operation: {
      ...(op.toObject ? op.toObject() : op),
      approvalId: String(approval._id),
      approvalMode: 'workflow',
      status: 'pending_director'
    },
    approval
  });
});

r.delete('/operations/:id', async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const rawId = String(req.params.id || '');
  const lookup = [{ clientId: rawId }];
  if (mongoose.isValidObjectId(rawId)) lookup.unshift({ _id: rawId });
  const row = await WholesaleOperation.findOne({ $or: lookup });
  const approval = await Approval.findOne({ referenceModel: 'WholesaleOperation', referenceId: rawId })
    || (row ? await Approval.findOne({ referenceModel: 'WholesaleOperation', referenceId: String(row._id) }) : null);
  if (!row && !approval) return res.status(404).json({ error: 'Not found' });
  const effectiveStatus = String(approval?.status || row?.status || '').toLowerCase();
  if (effectiveStatus === 'approved') {
    return res.status(400).json({ error: 'Approved requests cannot be deleted' });
  }
  if (row) {
    const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
    await archiveLiveDocument({
      req,
      tenantId,
      entityType: 'wholesale_operation',
      collectionName: 'wholesaleoperations',
      doc: row,
      meta: {
        relatedApprovals: approval ? [approval.toObject ? approval.toObject() : approval] : []
      }
    });
    await row.deleteOne();
  }
  if (approval) await Approval.deleteMany({ referenceModel: 'WholesaleOperation', referenceId: String(approval.referenceId || row?._id || rawId) });
  res.json({ ok: true });
});

export default r;
