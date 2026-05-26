import { Router } from 'express';
import Audit from '../models/Audit.js';
import Branch from '../models/Branch.js';
import { requireAuth, requireAdmin, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';
import { getMasterConnection, getTenantConnection, resolveStoredTenantId } from '../config/tenancy.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';
import { archiveLiveDocument } from '../utils/superBin.js';

const r = Router();
r.use(requireAuth);

function buildBranchLookupMap(branches = []) {
  const map = new Map();
  (Array.isArray(branches) ? branches : []).forEach((branch) => {
    const label = String(branch?.name || branch?.code || branch?.id || branch?._id || '').trim();
    const id = String(branch?.id || '').trim();
    const objectId = String(branch?._id || '').trim();
    if (id) map.set(id, label || id);
    if (objectId) map.set(objectId, label || objectId);
  });
  return map;
}

function enrichAuditBranchNames(row, branchLookup) {
  if (!row || typeof row !== 'object') return row;
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  const branchId = String(row.branchId || details.branchId || '').trim();
  const fromBranchId = String(details.from || '').trim();
  const toBranchId = String(details.to || '').trim();
  const branchName = branchId ? (branchLookup.get(branchId) || details.branchName || branchId) : '';
  const fromBranchName = fromBranchId ? (branchLookup.get(fromBranchId) || details.fromBranchName || fromBranchId) : '';
  const toBranchName = toBranchId ? (branchLookup.get(toBranchId) || details.toBranchName || toBranchId) : '';
  return {
    ...row,
    branchName,
    details: {
      ...details,
      ...(branchName ? { branchName } : {}),
      ...(fromBranchName ? { fromBranchName } : {}),
      ...(toBranchName ? { toBranchName } : {})
    }
  };
}

r.get('/', requireRoleOrPerm(['SuperAdmin', 'Admin'], ['view_audit', 'see_audit', 'view_stock_records', 'see_stock_records']), async (req, res) => {
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
    const branches = await Branch.find({}, { id: 1, name: 1, code: 1 }).lean();
    const branchLookup = buildBranchLookupMap(branches);
    rows = rows.map((row) => enrichAuditBranchNames(row, branchLookup));
  } else {
    const master = await getMasterConnection();
    const TenantModel = TenantModelFor(master);
    const tenants = await TenantModel.find(tenantFilter ? { tenantId: await resolveStoredTenantId(tenantFilter) } : {}, { tenantId: 1, name: 1 }).lean();
    const grouped = await Promise.all(tenants.map(async (tenant) => {
      try {
        const conn = await getTenantConnection(tenant.tenantId);
        const AuditModel = conn.models.Audit || conn.model('Audit', Audit.schema);
        const BranchModel = conn.models.Branch || conn.model('Branch', Branch.schema);
        const found = await AuditModel.find(match).sort({ ts: -1 }).limit(limit).lean();
        const branches = await BranchModel.find({}, { id: 1, name: 1, code: 1 }).lean();
        const branchLookup = buildBranchLookupMap(branches);
        return found.map((row) => ({
          ...enrichAuditBranchNames(row, branchLookup),
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
  const tenants = await TenantModel.find({}, { tenantId: 1, name: 1 }).lean();
  let removed = null;
  for (const tenant of tenants) {
    const conn = await getTenantConnection(tenant.tenantId);
    const AuditModel = conn.models.Audit || conn.model('Audit', Audit.schema);
    removed = await AuditModel.findOne(query);
    if (!removed) continue;
    await archiveLiveDocument({
      req,
      tenantId: tenant.tenantId,
      tenantName: String(tenant.name || tenant.tenantId || '').trim(),
      entityType: 'audit',
      collectionName: 'audits',
      doc: removed
    });
    await AuditModel.deleteOne({ _id: removed._id });
    break;
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
  const tenants = await TenantModel.find({}, { tenantId: 1, name: 1 }).lean();
  let count = 0;
  for (const tenant of tenants) {
    const conn = await getTenantConnection(tenant.tenantId);
    const AuditModel = conn.models.Audit || conn.model('Audit', Audit.schema);
    const rows = await AuditModel.find(query).lean();
    for (const row of rows) {
      await archiveLiveDocument({
        req,
        tenantId: tenant.tenantId,
        tenantName: String(tenant.name || tenant.tenantId || '').trim(),
        entityType: 'audit',
        collectionName: 'audits',
        doc: row
      });
    }
    const result = await AuditModel.deleteMany(query);
    count += Number(result?.deletedCount || 0);
  }
  res.json({ ok: true, count });
});

export default r;
