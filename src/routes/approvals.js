import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import Approval from '../models/Approval.js';
import CashReconciliation from '../models/CashReconciliation.js';
import CreditRepayment from '../models/CreditRepayment.js';
import CreditSale from '../models/CreditSale.js';
import WholesaleOperation from '../models/WholesaleOperation.js';
import { requireAuth } from '../middleware/auth.js';
import { canApproveAreaDirector, canApproveAreaManager, canApproveDirector, canApproveManager, canApproveWholesaleOperationDirector, canApproveWholesaleOperationManager, executeApprovedReference, syncReferenceStatus } from '../utils/approvalWorkflow.js';
import { safeErrorMessage, safeErrorStatus } from '../utils/safeError.js';

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

async function resolveApprovalArea(approval) {
  if (approval?.referenceModel !== 'WholesaleOperation') return '';
  const operation = await WholesaleOperation.findById(approval.referenceId).lean().catch(() => null);
  if (String(operation?.operationType || '').toLowerCase() === 'transfer' && String(operation?.toInventoryType || '').toLowerCase() === 'retail') {
    return 'retail';
  }
  return String(operation?.operationArea || 'wholesale').toLowerCase() === 'warehouse' ? 'warehouse' : 'wholesale';
}

async function resolveApprovalOperation(approval) {
  if (approval?.referenceModel !== 'WholesaleOperation') return null;
  return WholesaleOperation.findById(approval.referenceId).lean().catch(() => null);
}

function normalizeBranchIds(value) {
  if (value === 'all') return 'all';
  return Array.from(new Set(
    (Array.isArray(value) ? value : [value])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function getAccessibleBranchIds(user = {}) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'superadmin' || role === 'admin') return 'all';
  const assigned = normalizeBranchIds(user?.assignedBranches);
  if (assigned === 'all') return 'all';
  return normalizeBranchIds([user?.branchId, ...(Array.isArray(assigned) ? assigned : [])]);
}

async function resolveApprovalBranchIds(approval) {
  const referenceModel = String(approval?.referenceModel || '').trim();
  const referenceId = String(approval?.referenceId || '').trim();
  if (!referenceModel || !referenceId) return [];
  if (referenceModel === 'CreditRepayment') {
    const repayment = await CreditRepayment.findById(referenceId).select('creditSaleId').lean().catch(() => null);
    if (!repayment?.creditSaleId) return [];
    const creditSale = await CreditSale.findById(String(repayment.creditSaleId)).select('branchId').lean().catch(() => null);
    return creditSale?.branchId ? [String(creditSale.branchId)] : [];
  }
  if (referenceModel === 'WholesaleOperation') {
    const operation = await WholesaleOperation.findById(referenceId)
      .select('branchId fromBranchId toBranchId')
      .lean()
      .catch(() => null);
    return Array.from(new Set([
      String(operation?.branchId || '').trim(),
      String(operation?.fromBranchId || '').trim(),
      String(operation?.toBranchId || '').trim()
    ].filter(Boolean)));
  }
  if (referenceModel === 'CashReconciliation') {
    const row = await CashReconciliation.findById(referenceId).select('branchId').lean().catch(() => null);
    return row?.branchId ? [String(row.branchId)] : [];
  }
  return [];
}

async function canAccessApprovalByBranch(user = {}, approval) {
  const accessibleBranchIds = getAccessibleBranchIds(user);
  if (accessibleBranchIds === 'all') return true;
  const approvalBranchIds = await resolveApprovalBranchIds(approval);
  if (approvalBranchIds.length === 0) return false;
  return approvalBranchIds.some((branchId) => accessibleBranchIds.includes(String(branchId)));
}

function normalizeWholesaleReviewItems(items = [], fallback = {}) {
  const fallbackItems = Array.isArray(fallback?.items) && fallback.items.length > 0
    ? fallback.items
    : [{
        lineId: '1',
        productId: fallback?.productId || '',
        variantId: fallback?.variantId || '',
        qty: Number(fallback?.qty || 0),
        unitIds: Array.isArray(fallback?.unitIds) ? fallback.unitIds : [],
        selectedUnits: Array.isArray(fallback?.selectedUnits) ? fallback.selectedUnits : [],
        serializedEntries: Array.isArray(fallback?.serializedEntries) ? fallback.serializedEntries : [],
        cost: Number(fallback?.cost || 0),
        requestedAmount: Number(fallback?.requestedAmount || 0),
        adjustmentType: String(fallback?.adjustmentType || 'increase'),
        supplier: String(fallback?.supplier || ''),
        transactionTitle: String(fallback?.transactionTitle || ''),
        reason: String(fallback?.reason || ''),
        remark: String(fallback?.remark || ''),
        status: String(fallback?.status || 'accepted')
      }];
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const fallbackItem = fallbackItems.find((entry) => String(entry?.lineId || '') === String(item?.lineId || ''))
        || fallbackItems[index]
        || {};
      const status = String(item?.status || 'accepted').toLowerCase() === 'cancelled' ? 'cancelled' : 'accepted';
      return {
        lineId: String(item?.lineId || `${index + 1}`),
        productId: String(item?.productId || fallbackItem?.productId || ''),
        variantId: String(item?.variantId || fallbackItem?.variantId || ''),
        qty: Math.max(0, Number(item?.qty || 0)),
        unitIds: Array.isArray(item?.unitIds) ? item.unitIds.map(String).filter(Boolean) : [],
        selectedUnits: Array.isArray(item?.selectedUnits)
          ? item.selectedUnits.map((unit) => ({
              unitId: String(unit?.unitId || ''),
              imei: String(unit?.imei || '').trim(),
              serialNumber: String(unit?.serialNumber || '').trim()
            }))
          : [],
        serializedEntries: Array.isArray(item?.serializedEntries)
          ? item.serializedEntries.map((entry) => ({
              imei: String(entry?.imei || '').trim(),
              serialNumber: String(entry?.serialNumber || '').trim()
            }))
          : [],
        cost: Number(item?.cost || 0),
        requestedAmount: Number(item?.requestedAmount || 0),
        adjustmentType: String(item?.adjustmentType || fallbackItem?.adjustmentType || fallback?.adjustmentType || 'increase') === 'decrease' ? 'decrease' : 'increase',
        supplier: String(item?.supplier || ''),
        transactionTitle: String(item?.transactionTitle || ''),
        reason: String(item?.reason || ''),
        remark: String(item?.remark || ''),
        status
      };
    })
    .filter((item) => item.productId && (item.qty > 0 || item.status === 'cancelled'));
}

r.get('/', async (req, res) => {
  const query = {};
  if (req.query.status) query.status = String(req.query.status);
  if (req.query.actionType) query.actionType = String(req.query.actionType);
  if (req.query.referenceModel) query.referenceModel = String(req.query.referenceModel);
  if (req.query.referenceId) query.referenceId = String(req.query.referenceId);
  const rows = await Approval.find(query).sort({ createdAt: -1 }).limit(500).lean();
  const wholesaleReferenceIds = rows
    .filter((row) => String(row?.referenceModel || '') === 'WholesaleOperation')
    .map((row) => String(row.referenceId || '').trim())
    .filter(Boolean);
  const wholesaleOperations = wholesaleReferenceIds.length > 0
    ? await WholesaleOperation.find({ _id: { $in: wholesaleReferenceIds } })
      .select('operationType operationArea transactionTitle productId variantId items qty cost requestedAmount branchId fromBranchId toBranchId fromInventoryType toInventoryType reason remark initiatedByName initiatedByRole createdAt updatedAt')
      .lean()
      .catch(() => [])
    : [];
  const wholesaleById = new Map(
    (Array.isArray(wholesaleOperations) ? wholesaleOperations : []).map((row) => [String(row._id), row])
  );
  const filteredRows = [];
  for (const row of rows) {
    if (!(await canAccessApprovalByBranch(req.user, row))) continue;
    const wholesaleOperation = String(row?.referenceModel || '') === 'WholesaleOperation'
      ? wholesaleById.get(String(row.referenceId || ''))
      : null;
    if (wholesaleOperation) {
      filteredRows.push({
        ...row,
        operationType: wholesaleOperation.operationType || '',
        operationArea: wholesaleOperation.operationArea || '',
        transactionTitle: wholesaleOperation.transactionTitle || '',
        productId: wholesaleOperation.productId || '',
        variantId: wholesaleOperation.variantId || '',
        items: Array.isArray(wholesaleOperation.items) ? wholesaleOperation.items : [],
        qty: Number(wholesaleOperation.qty || 0),
        cost: Number(wholesaleOperation.cost || 0),
        requestedAmount: Number(wholesaleOperation.requestedAmount || 0),
        branchId: wholesaleOperation.branchId || '',
        fromBranchId: wholesaleOperation.fromBranchId || '',
        toBranchId: wholesaleOperation.toBranchId || '',
        fromInventoryType: wholesaleOperation.fromInventoryType || '',
        toInventoryType: wholesaleOperation.toInventoryType || '',
        reason: wholesaleOperation.reason || '',
        remark: wholesaleOperation.remark || '',
        initiatedByName: wholesaleOperation.initiatedByName || row.initiatedByName || '',
        initiatedByRole: wholesaleOperation.initiatedByRole || row.initiatedByRole || '',
        referenceCreatedAt: wholesaleOperation.createdAt || null,
        referenceUpdatedAt: wholesaleOperation.updatedAt || null
      });
      continue;
    }
    filteredRows.push(row);
  }
  // #region debug-point B:approvals-list
  reportTransferVisibilityDebug({
    hypothesisId: 'B',
    location: 'approvals.js:get:list',
    msg: '[DEBUG] Approvals list resolved transfer references',
    data: {
      status: String(req.query.status || ''),
      totalRows: rows.length,
      visibleRows: filteredRows.length,
      transferRows: filteredRows.filter((row) => String(row?.referenceModel || '') === 'WholesaleOperation' && String(row?.operationType || row?.actionType || '').toLowerCase().includes('transfer')).map((row) => ({
        approvalId: String(row?._id || ''),
        referenceId: String(row?.referenceId || ''),
        status: String(row?.status || ''),
        actionType: String(row?.actionType || ''),
        hasOperationItems: Array.isArray(row?.items) && row.items.length > 0,
        operationArea: String(row?.operationArea || ''),
        fromBranchId: String(row?.fromBranchId || ''),
        toBranchId: String(row?.toBranchId || '')
      })).slice(0, 20)
    }
  });
  // #endregion
  res.json(filteredRows);
});

r.post('/:id/approve', async (req, res) => {
  const approval = await Approval.findById(req.params.id);
  if (!approval) return res.status(404).json({ error: 'Approval not found' });
  const hasBranchAccess = await canAccessApprovalByBranch(req.user, approval);
  if (!hasBranchAccess) return res.status(403).json({ error: 'Forbidden' });
  const remark = String(req.body?.remark || '').trim();
  if (approval.status === 'pending_director') {
    const approvalArea = await resolveApprovalArea(approval);
    const operation = await resolveApprovalOperation(approval);
    const canApprove = operation
      ? canApproveWholesaleOperationDirector(req.user, operation)
      : (approvalArea ? canApproveAreaDirector(req.user, approvalArea) : canApproveDirector(req.user));
    if (!canApprove) return res.status(403).json({ error: 'Director approval required' });
    if (approval.referenceModel === 'WholesaleOperation' && Array.isArray(req.body?.items)) {
      const operation = await WholesaleOperation.findById(approval.referenceId);
      if (!operation) return res.status(404).json({ error: 'Wholesale operation not found' });
      const reviewedItems = normalizeWholesaleReviewItems(req.body?.items, operation);
      const acceptedQty = reviewedItems
        .filter((item) => String(item.status || 'accepted').toLowerCase() !== 'cancelled')
        .reduce((sum, item) => sum + Math.max(0, Number(item.qty || 0)), 0);
      if (reviewedItems.length === 0 || acceptedQty <= 0) {
        return res.status(400).json({ error: 'Director approval requires at least one accepted item with quantity greater than zero' });
      }
      operation.items = reviewedItems;
      operation.qty = acceptedQty;
      operation.status = 'pending_manager';
      await operation.save();
      await syncReferenceStatus(approval.referenceModel, approval.referenceId, 'pending_manager', {
        items: reviewedItems,
        qty: acceptedQty
      });
    } else {
      await syncReferenceStatus(approval.referenceModel, approval.referenceId, 'pending_manager');
    }
    approval.directorApprovedByName = req.user?.name || 'unknown';
    approval.directorApprovedByRole = req.user?.role || '';
    approval.directorRemark = remark;
    approval.directorApprovedAt = new Date();
    approval.status = 'pending_manager';
    await approval.save();
    return res.json(approval);
  }
  if (approval.status === 'pending_manager') {
    const approvalArea = await resolveApprovalArea(approval);
    const operation = await resolveApprovalOperation(approval);
    const canApprove = operation
      ? canApproveWholesaleOperationManager(req.user, operation)
      : (approvalArea ? canApproveAreaManager(req.user, approvalArea) : canApproveManager(req.user));
    if (!canApprove) return res.status(403).json({ error: 'Manager approval required' });
    if (req.body?.resubmitToDirector) {
      if (approval.referenceModel !== 'WholesaleOperation') {
        return res.status(400).json({ error: 'Resubmission is only supported for wholesale operations' });
      }
      const operation = await WholesaleOperation.findById(approval.referenceId);
      if (!operation) return res.status(404).json({ error: 'Wholesale operation not found' });
      if (String(operation.operationType || '').toLowerCase() !== 'transfer') {
        return res.status(400).json({ error: 'Only transfer requests can be resubmitted to director approval' });
      }
      const reviewedItems = normalizeWholesaleReviewItems(req.body?.items, operation);
      const acceptedQty = reviewedItems
        .filter((item) => String(item.status || 'accepted').toLowerCase() !== 'cancelled')
        .reduce((sum, item) => sum + Math.max(0, Number(item.qty || 0)), 0);
      if (reviewedItems.length === 0 || acceptedQty <= 0) {
        return res.status(400).json({ error: 'Resubmission requires at least one accepted item with quantity greater than zero' });
      }
      operation.items = reviewedItems;
      operation.qty = acceptedQty;
      operation.status = 'pending_director';
      await operation.save();
      approval.status = 'pending_director';
      approval.directorApprovedByName = '';
      approval.directorApprovedByRole = '';
      approval.directorRemark = '';
      approval.directorApprovedAt = null;
      approval.managerApprovedByName = '';
      approval.managerApprovedByRole = '';
      approval.managerRemark = remark;
      approval.managerApprovedAt = null;
      await approval.save();
      await syncReferenceStatus(approval.referenceModel, approval.referenceId, 'pending_director', {
        items: reviewedItems,
        qty: acceptedQty
      });
      return res.json(approval);
    }
    approval.managerApprovedByName = req.user?.name || 'unknown';
    approval.managerApprovedByRole = req.user?.role || '';
    approval.managerRemark = remark;
    approval.managerApprovedAt = new Date();
    await approval.save();
    try {
      await executeApprovedReference(approval, { name: req.user?.name || 'unknown', role: req.user?.role || '' });
      const fresh = await Approval.findById(approval._id);
      return res.json(fresh);
    } catch (e) {
      return res.status(safeErrorStatus(e, 400)).json({ error: safeErrorMessage(e, 'Failed to execute approval') });
    }
  }
  return res.status(400).json({ error: `Cannot approve item in status ${approval.status}` });
});

r.post('/:id/reject', async (req, res) => {
  const approval = await Approval.findById(req.params.id);
  if (!approval) return res.status(404).json({ error: 'Approval not found' });
  if (!await canAccessApprovalByBranch(req.user, approval)) return res.status(403).json({ error: 'Forbidden' });
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Reason is required' });
  const approvalArea = await resolveApprovalArea(approval);
  const operation = await resolveApprovalOperation(approval);
  const canReject = approval.status === 'pending_director'
    ? (operation ? canApproveWholesaleOperationDirector(req.user, operation) : (approvalArea ? canApproveAreaDirector(req.user, approvalArea) : canApproveDirector(req.user)))
    : (operation ? canApproveWholesaleOperationManager(req.user, operation) : (approvalArea ? canApproveAreaManager(req.user, approvalArea) : canApproveManager(req.user)));
  if (!canReject) return res.status(403).json({ error: 'Not allowed to reject this approval' });
  approval.status = 'rejected';
  approval.rejectedByName = req.user?.name || 'unknown';
  approval.rejectedByRole = req.user?.role || '';
  approval.rejectionReason = reason;
  approval.rejectedAt = new Date();
  await approval.save();
  await syncReferenceStatus(approval.referenceModel, approval.referenceId, 'rejected', { rejectedAt: new Date() });
  res.json(approval);
});

export default r;
