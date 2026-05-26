import { Router } from 'express';
import { requireAuth, requireFeature, requireRoleOrPerm } from '../middleware/auth.js';
import { getMasterConnection } from '../config/tenancy.js';
import { modelFor as SuperBinModelFor } from '../models/SuperBin.js';
import { deleteForeverSuperBinEntry, isMasterSuperAdmin, restoreSuperBinEntry, superBinTenantScope } from '../utils/superBin.js';

const r = Router();

r.use(requireAuth);

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadEntriesByIds(ids = [], req) {
  const master = await getMasterConnection();
  const SuperBin = await SuperBinModelFor(master);
  const tenantScope = superBinTenantScope(req, req.body?.tenantId || req.query?.tenantId || '');
  const query = {
    _id: { $in: ids }
  };
  if (tenantScope) query.tenantId = tenantScope;
  return SuperBin.find(query).sort({ deletedAt: -1 });
}

r.get('/', requireFeature('admin.superBin'), requireRoleOrPerm(['Admin'], 'view_super_bin'), async (req, res) => {
  const master = await getMasterConnection();
  const SuperBin = await SuperBinModelFor(master);
  const tenantScope = superBinTenantScope(req, req.query?.tenantId || '');
  const entityType = String(req.query?.entityType || '').trim().toLowerCase();
  const q = String(req.query?.q || '').trim();
  const limit = Math.max(1, Math.min(1000, Number(req.query?.limit || 200)));
  const query = {};
  if (tenantScope) query.tenantId = tenantScope;
  if (entityType) query.entityType = entityType;
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    query.$or = [
      { displayName: re },
      { secondaryText: re },
      { tenantId: re },
      { tenantName: re },
      { sourceId: re }
    ];
  }
  const rows = await SuperBin.find(query)
    .sort({ deletedAt: -1 })
    .limit(limit)
    .lean();
  res.json(rows.map((row) => ({
    id: String(row._id),
    tenantId: String(row.tenantId || ''),
    tenantName: String(row.tenantName || ''),
    entityType: String(row.entityType || ''),
    collectionName: String(row.collectionName || ''),
    sourceId: String(row.sourceId || ''),
    displayName: String(row.displayName || ''),
    secondaryText: String(row.secondaryText || ''),
    summary: row.summary || {},
    remark: String(row.remark || ''),
    meta: row.meta || {},
    deletedByName: String(row.deletedByName || ''),
    deletedByRole: String(row.deletedByRole || ''),
    deletedByTenantId: String(row.deletedByTenantId || ''),
    deletedAt: row.deletedAt || row.createdAt || null
  })));
});

r.post('/restore', requireFeature('admin.superBin'), requireRoleOrPerm(['Admin'], 'view_super_bin'), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, restoredCount: 0, failed: [] });
  const rows = await loadEntriesByIds(ids, req);
  const failed = [];
  let restoredCount = 0;
  for (const row of rows) {
    try {
      if (String(row.entityType || '').toLowerCase() === 'tenant' && !isMasterSuperAdmin(req)) {
        throw new Error('Only superadmin can restore tenant archives');
      }
      await restoreSuperBinEntry(row);
      await row.deleteOne();
      restoredCount += 1;
    } catch (err) {
      failed.push({
        id: String(row._id),
        entityType: String(row.entityType || ''),
        displayName: String(row.displayName || ''),
        error: String(err?.message || 'Restore failed')
      });
    }
  }
  res.json({
    ok: failed.length === 0,
    restoredCount,
    failed
  });
});

r.post('/delete-forever', requireFeature('admin.superBin'), requireRoleOrPerm(['Admin'], 'view_super_bin'), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, deletedCount: 0, failed: [] });
  const rows = await loadEntriesByIds(ids, req);
  const failed = [];
  let deletedCount = 0;
  for (const row of rows) {
    try {
      if (String(row.entityType || '').toLowerCase() === 'tenant' && !isMasterSuperAdmin(req)) {
        throw new Error('Only superadmin can permanently delete tenant archives');
      }
      await deleteForeverSuperBinEntry(row);
      await row.deleteOne();
      deletedCount += 1;
    } catch (err) {
      failed.push({
        id: String(row._id),
        entityType: String(row.entityType || ''),
        displayName: String(row.displayName || ''),
        error: String(err?.message || 'Delete forever failed')
      });
    }
  }
  res.json({
    ok: failed.length === 0,
    deletedCount,
    failed
  });
});

export default r;
