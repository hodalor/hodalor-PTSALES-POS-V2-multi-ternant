import { Router } from 'express';
import mongoose from 'mongoose';
import Branch from '../models/Branch.js';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAdmin } from '../middleware/auth.js';
import { getMasterConnection } from '../config/tenancy.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';
import { modelFor as SuperBinModelFor } from '../models/SuperBin.js';
import { getEffectiveTenantLimits, getTenantLimitDefaults, getTenantUsageSummary } from '../utils/tenantLimits.js';
import { getPaymentManagementConfig } from '../utils/paymentManagement.js';
import { getMobileMoneyNetworks, getTenantLimitUpgradeInfo } from '../utils/subscriptionPayments.js';
import { archiveLiveDocument } from '../utils/superBin.js';

const r = Router();

function inventoryFieldForBranchType(branchType = 'retail') {
  const kind = String(branchType || 'retail').toLowerCase();
  if (kind === 'warehouse') return 'warehouseStockByBranch';
  if (kind === 'wholesale') return 'wholesaleStockByBranch';
  return 'stockByBranch';
}

async function provisionBranchProducts(branch) {
  if (!branch?.id) return;
  const field = inventoryFieldForBranchType(branch.branchType);
  await Product.updateMany(
    {},
    {
      $set: {
        [`${field}.${branch.id}`]: 0,
        [`variants.$[].${field}.${branch.id}`]: 0
      }
    }
  );
}

r.get('/', async (req, res) => {
  const items = await Branch.find().sort({ name: 1 });
  res.json(items);
});

r.post('/resolve', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  const uniq = Array.from(new Set(ids)).slice(0, 300);
  if (uniq.length === 0) return res.json({ items: [] });
  const branches = await Branch.find({ id: { $in: uniq } }).select('id name code branchType').lean();
  const byId = new Map(branches.map((b) => [String(b.id), String(b.name || b.code || b.id)]));
  const missing = uniq.filter((id) => !byId.has(String(id)));
  const fallbackById = new Map();
  if (missing.length > 0) {
    const audits = await Audit.find({
      actionType: { $in: ['branch_delete', 'branch_update', 'branch_create'] },
      'details.id': { $in: missing }
    })
      .sort({ ts: -1, createdAt: -1 })
      .limit(5000)
      .lean();
    for (const row of audits) {
      const bid = String(row?.details?.id || '').trim();
      if (!bid || fallbackById.has(bid)) continue;
      const directName = String(row?.details?.name || '').trim();
      const afterName = String(row?.details?.after?.name || '').trim();
      const beforeName = String(row?.details?.before?.name || '').trim();
      const name = directName || afterName || beforeName;
      if (name) fallbackById.set(bid, name);
    }
  }
  const tenantId = String(req.user?.tenantId || req.tenantId || '').trim();
  const missingAfterAudit = missing.filter((id) => !fallbackById.has(String(id)));
  if (tenantId && missingAfterAudit.length > 0) {
    const master = await getMasterConnection();
    const SuperBin = await SuperBinModelFor(master);
    const rows = await SuperBin.find({
      tenantId,
      entityType: 'branch',
      sourceId: { $in: missingAfterAudit }
    })
      .sort({ deletedAt: -1 })
      .limit(1000)
      .lean();
    for (const row of rows) {
      const bid = String(row?.sourceId || '').trim();
      if (!bid || fallbackById.has(bid)) continue;
      const displayName = String(row?.displayName || '').trim();
      const summaryName = String(row?.summary?.name || '').trim();
      const payloadName = String(row?.payload?.name || '').trim();
      const name = displayName || summaryName || payloadName;
      if (name) fallbackById.set(bid, name);
    }
  }
  const items = uniq.map((id) => {
    const key = String(id);
    const name = byId.get(key) || fallbackById.get(key) || '';
    return { id: key, name, deleted: !byId.has(key) };
  });
  res.json({ items });
});

r.post('/', requireAdmin, async (req, res) => {
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master');
  if (tenantId.toLowerCase() !== 'master') {
    const master = await getMasterConnection();
    const TenantModel = TenantModelFor(master);
    const tenant = await TenantModel.findOne({ tenantId }).lean();
    const defaults = await getTenantLimitDefaults(master);
    const limits = getEffectiveTenantLimits(tenant, defaults);
    if (limits.maxBranches) {
      const usageSummary = await getTenantUsageSummary(master, req.db, tenant, defaults);
      if ((usageSummary?.usage?.totalBranches || 0) >= limits.maxBranches) {
        const paymentConfig = await getPaymentManagementConfig(master);
        tenant._masterConn = master;
        const upgradeInfo = await getTenantLimitUpgradeInfo(req.db, tenant, usageSummary);
        return res.status(403).json({
          error: 'Branch creation limit reached. Contact admin or pay for additional branch slots.',
          code: 'TENANT_BRANCH_LIMIT_REACHED',
          resourceType: 'branch',
          limits: usageSummary.limits,
          usage: usageSummary.usage,
          addOnPricing: upgradeInfo.addOnPricing,
          currencyCode: upgradeInfo.currencyCode,
          currencySymbol: upgradeInfo.currencySymbol,
          currencyPosition: upgradeInfo.currencyPosition,
          billingEmail: upgradeInfo.billingEmail,
          billingPhone: upgradeInfo.billingPhone,
          billingAddress: upgradeInfo.billingAddress,
          mobileMoneyNetworks: getMobileMoneyNetworks(upgradeInfo.billingCountry),
          enabledGateways: paymentConfig.enabledGateways
        });
      }
    }
  }
  const b = await Branch.create(req.body);
  res.json(b);
  void provisionBranchProducts(b).catch(() => {});
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'branch_create',
    details: { id: b.id || String(b._id), name: b.name, code: b.code },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'POST',
    status: 200,
    message: `Branch created: ${b.name} (${b.code || ''})`
  }).catch(() => {});
});

r.put('/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const query = { $or: [{ id }] };
  if (mongoose.isValidObjectId(id)) query.$or.unshift({ _id: id });
  const before = await Branch.findOne(query);
  if (!before) return res.status(404).json({ error: 'Branch not found' });
  const payload = {};
  if (typeof req.body?.name === 'string') payload.name = req.body.name.trim();
  if (typeof req.body?.code === 'string') payload.code = req.body.code.trim();
  const requestedType = typeof req.body?.branchType === 'string' ? req.body.branchType.trim().toLowerCase() : '';
  if (requestedType && requestedType !== String(before.branchType || 'retail').toLowerCase()) {
    return res.status(400).json({ error: 'Branch type changes are blocked here for safety. Rename the branch only so stock remains untouched.' });
  }
  if (!payload.name) payload.name = before.name;
  if (!Object.prototype.hasOwnProperty.call(payload, 'code')) payload.code = before.code || '';
  const b = await Branch.findOneAndUpdate(query, payload, { new: true });
  const changed = {};
  if (before.name !== b?.name) changed.name = { from: before.name, to: b?.name || '' };
  if (String(before.code || '') !== String(b?.code || '')) changed.code = { from: before.code || '', to: b?.code || '' };
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'branch_update',
    details: { id, before: { name: before.name, code: before.code }, after: b ? { name: b.name, code: b.code } : null, changed },
    branchId: req.user?.branchId || ''
  });
  await ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'PUT',
    status: 200,
    message: `Branch updated: ${b ? b.name : id}`
  });
  res.json(b);
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const query = { $or: [{ id }] };
  if (mongoose.isValidObjectId(id)) query.$or.unshift({ _id: id });
  const b = await Branch.findOne(query);
  if (!b) return res.status(404).json({ error: 'Branch not found' });
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
  await archiveLiveDocument({
    req,
    tenantId,
    entityType: 'branch',
    collectionName: 'branches',
    doc: b,
    meta: {
      stockMapsPreserved: true
    }
  });
  await Branch.deleteOne({ _id: b._id });
  res.json({ ok: true });
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'branch_delete',
    details: b ? { id, name: b.name, code: b.code } : { id },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'DELETE',
    status: 200,
    message: `Branch deleted: ${b ? b.name : id}`
  }).catch(() => {});
});

export default r;
