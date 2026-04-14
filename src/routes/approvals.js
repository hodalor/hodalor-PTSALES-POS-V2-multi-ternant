import { Router } from 'express';
import Approval from '../models/Approval.js';
import { requireAuth } from '../middleware/auth.js';
import { canApproveDirector, canApproveManager, executeApprovedReference, syncReferenceStatus } from '../utils/approvalWorkflow.js';

const r = Router();

r.use(requireAuth);

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
      return res.status(e?.status || 400).json({ error: e?.message || 'Failed to execute approval' });
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
