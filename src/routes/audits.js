import { Router } from 'express';
import Audit from '../models/Audit.js';
import { requireAuth, requireAdmin, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';

const r = Router();
r.use(requireAuth);

r.get('/', requireRoleOrPerm(['SuperAdmin'], 'view_audit'), async (req, res) => {
  const limit = Math.min(1000, Math.max(50, Number(req.query.limit) || 500));
  const rows = await Audit.find().sort({ ts: -1 }).limit(limit).lean();
  res.set('Cache-Control', 'no-store');
  res.json(rows);
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const rawId = String(req.params.id || '');
  const query = mongoose.isValidObjectId(rawId) ? { _id: rawId } : { id: rawId };
  const removed = await Audit.findOneAndDelete(query);
  if (!removed) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

r.post('/bulk-delete', requireAdmin, async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, count: 0 });
  const objectIds = ids.filter(id => mongoose.isValidObjectId(id));
  const query = {
    $or: [
      { id: { $in: ids } },
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : [])
    ]
  };
  const result = await Audit.deleteMany(query);
  res.json({ ok: true, count: Number(result?.deletedCount || 0) });
});

export default r;
