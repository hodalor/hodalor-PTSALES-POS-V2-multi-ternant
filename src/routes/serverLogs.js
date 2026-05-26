import { Router } from 'express';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import mongoose from 'mongoose';
import { archiveLiveDocument } from '../utils/superBin.js';

const r = Router();

r.use(requireAuth);

r.get('/', requireRole(['SuperAdmin']), async (req, res) => {
  const limit = Math.min(1000, Math.max(50, Number(req.query.limit) || 500));
  const rows = await ServerLog.find().sort({ ts: -1 }).limit(limit);
  res.set('Cache-Control', 'no-store');
  res.json(rows);
});

r.post('/bulk-delete', requireRole(['SuperAdmin']), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, count: 0 });
  const objectIds = ids.filter(id => mongoose.isValidObjectId(id));
  const rows = await ServerLog.find({ _id: { $in: objectIds } }).lean();
  for (const row of rows) {
    await archiveLiveDocument({
      req,
      tenantId: 'master',
      tenantName: 'Master',
      entityType: 'server_log',
      collectionName: 'serverlogs',
      doc: row
    });
  }
  const result = await ServerLog.deleteMany({ _id: { $in: objectIds } });
  res.json({ ok: true, count: Number(result?.deletedCount || 0) });
});

export default r;
