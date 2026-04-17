import { Router } from 'express';
import Audit from '../models/Audit.js';
import { requireAuth, requireAdmin, requireFeature, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';
import { getMasterConnection, getTenantConnection, resolveStoredTenantId } from '../config/tenancy.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';

const r = Router();
r.use(requireAuth);

r.get('/', requireFeature('admin.audit'), requireRoleOrPerm(['SuperAdmin', 'Admin'], 'view_audit'), async (req, res) => {
  const limit = Math.min(1000, Math.max(50, Number(req.query.limit) || 500));
  const role = String(req.user?.role || '').toLowerCase();
  const currentTenantId = String(req.user?.tenantId || req.tenantId || 'master');
  const severity = String(req.query.severity || '').trim().toLowerCase();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const tenantFilter = String(req.query.tenantId || '').trim();
  const match = {};
  if (severity) match.severity = severity;
  if (from || to) {
    match.ts = {};
    if (from) match.ts.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      match.ts.$lte = end;
    }
  }
  let rows = [];
  const isMasterSuper = role === 'superadmin' && currentTenantId.toLowerCase() === 'master';
  if (!isMasterSuper) {
    rows = await Audit.find(match).sort({ ts: -1 }).limit(limit).lean();
  } else {
    const master = await getMasterConnection();
    const TenantModel = TenantModelFor(master);
    const tenants = await TenantModel.find(tenantFilter ? { tenantId: await resolveStoredTenantId(tenantFilter) } : {}, { tenantId: 1, name: 1 }).lean();
    const grouped = await Promise.all(tenants.map(async (tenant) => {
      try {
        const conn = await getTenantConnection(tenant.tenantId);
        const AuditModel = conn.models.Audit || conn.model('Audit', Audit.schema);
        const found = await AuditModel.find(match).sort({ ts: -1 }).limit(limit).lean();
        return found.map((row) => ({
          ...row,
          tenantId: row.tenantId || tenant.tenantId,
          tenantName: row.tenantName || tenant.name || tenant.tenantId
        }));
      } catch {
        return [];
      }
    }));
    rows = grouped.flat().sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, limit);
  }
  res.set('Cache-Control', 'no-store');
  res.json(rows);
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  const currentTenantId = String(req.user?.tenantId || req.tenantId || '').toLowerCase();
  if (role !== 'superadmin' || currentTenantId !== 'master') return res.status(403).json({ error: 'Forbidden' });
  const rawId = String(req.params.id || '');
  const query = mongoose.isValidObjectId(rawId) ? { _id: rawId } : { id: rawId };
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const tenants = await TenantModel.find({}, { tenantId: 1 }).lean();
  let removed = null;
  for (const tenant of tenants) {
    const conn = await getTenantConnection(tenant.tenantId);
    const AuditModel = conn.models.Audit || conn.model('Audit', Audit.schema);
    removed = await AuditModel.findOneAndDelete(query);
    if (removed) break;
  }
  if (!removed) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

r.post('/bulk-delete', requireAdmin, async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  const currentTenantId = String(req.user?.tenantId || req.tenantId || '').toLowerCase();
  if (role !== 'superadmin' || currentTenantId !== 'master') return res.status(403).json({ error: 'Forbidden' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, count: 0 });
  const objectIds = ids.filter(id => mongoose.isValidObjectId(id));
  const query = {
    $or: [
      { id: { $in: ids } },
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : [])
    ]
  };
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const tenants = await TenantModel.find({}, { tenantId: 1 }).lean();
  let count = 0;
  for (const tenant of tenants) {
    const conn = await getTenantConnection(tenant.tenantId);
    const AuditModel = conn.models.Audit || conn.model('Audit', Audit.schema);
    const result = await AuditModel.deleteMany(query);
    count += Number(result?.deletedCount || 0);
  }
  res.json({ ok: true, count });
});

export default r;
