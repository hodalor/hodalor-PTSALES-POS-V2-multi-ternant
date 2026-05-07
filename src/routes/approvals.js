import { Router } from 'express';
import Approval from '../models/Approval.js';
import WholesaleOperation from '../models/WholesaleOperation.js';
import { requireAuth } from '../middleware/auth.js';
import { canApproveDirector, canApproveManager, executeApprovedReference, syncReferenceStatus } from '../utils/approvalWorkflow.js';
import { safeErrorMessage, safeErrorStatus } from '../utils/safeError.js';

const r = Router();

r.use(requireAuth);

function normalizeWholesaleReviewItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const status = String(item?.status || 'accepted').toLowerCase() === 'cancelled' ? 'cancelled' : 'accepted';
      return {
        lineId: String(item?.lineId || `${index + 1}`),
        productId: String(item?.productId || ''),
        variantId: String(item?.variantId || ''),
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
        adjustmentType: String(item?.adjustmentType || 'increase') === 'decrease' ? 'decrease' : 'increase',
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
  res.json(rows);
});

r.post('/:id/approve', async (req, res) => {
  const approval = await Approval.findById(req.params.id);
  if (!approval) return res.status(404).json({ error: 'Approval not found' });
  const remark = String(req.body?.remark || '').trim();
  if (approval.status === 'pending_director') {
    if (!canApproveDirector(req.user)) return res.status(403).json({ error: 'Director approval required' });
    approval.directorApprovedByName = req.user?.name || 'unknown';
    approval.directorApprovedByRole = req.user?.role || '';
    approval.directorRemark = remark;
    approval.directorApprovedAt = new Date();
    approval.status = 'pending_manager';
    await approval.save();
    await syncReferenceStatus(approval.referenceModel, approval.referenceId, 'pending_manager');
    return res.json(approval);
  }
  if (approval.status === 'pending_manager') {
    if (!canApproveManager(req.user)) return res.status(403).json({ error: 'Manager approval required' });
    if (req.body?.resubmitToDirector) {
      if (approval.referenceModel !== 'WholesaleOperation') {
        return res.status(400).json({ error: 'Resubmission is only supported for wholesale operations' });
      }
      const operation = await WholesaleOperation.findById(approval.referenceId);
      if (!operation) return res.status(404).json({ error: 'Wholesale operation not found' });
      if (String(operation.operationType || '').toLowerCase() !== 'transfer') {
        return res.status(400).json({ error: 'Only transfer requests can be resubmitted to director approval' });
      }
      const reviewedItems = normalizeWholesaleReviewItems(req.body?.items);
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
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Reason is required' });
  const canReject = approval.status === 'pending_director'
    ? canApproveDirector(req.user)
    : canApproveManager(req.user);
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
