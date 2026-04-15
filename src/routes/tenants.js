import { Router } from 'express';
import Tenant, { modelFor as TenantModelFor } from '../models/Tenant.js';
import { modelFor as UserModelFor } from '../models/User.js';
import { modelFor as BranchModelFor } from '../models/Branch.js';
import { modelFor as SettingsModelFor } from '../models/Settings.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { getMasterConnection, getTenantConnection, getTenantDbName, normalizeTenantId } from '../config/tenancy.js';
import { hashPin } from '../utils/pin.js';
import { ALL_FEATURES, normalizePlan, normalizeFeatureList, featureFlagsFromEnabled } from '../config/tenantAccess.js';

const r = Router();
r.use(requireAuth);

async function ensureTenantBootstrap(tenantId, payload = {}) {
  const conn = await getTenantConnection(tenantId);
  const Branch = BranchModelFor(conn);
  const User = UserModelFor(conn);
  const Settings = SettingsModelFor(conn);
  await Branch.updateOne(
    { id: 'main' },
    { $setOnInsert: { id: 'main', name: 'Main Branch', code: 'MAIN', branchType: 'retail' } },
    { upsert: true }
  );
  const current = await Settings.findOne({ key: 'default' });
  const nextData = {
    ...(current?.data || {}),
    clientAppName: payload.clientAppName || payload.name || current?.data?.clientAppName || '',
    clientLogoUrl: payload.logo || current?.data?.clientLogoUrl || '',
    themeColor: payload.themeColor || current?.data?.themeColor || '',
    featureFlags: featureFlagsFromEnabled(payload.features || []),
    subscriptionPlan: payload.subscriptionPlan || current?.data?.subscriptionPlan || 'basic',
    subscriptionExpiresAt: payload.subscriptionExpiresAt || current?.data?.subscriptionExpiresAt || null
  };
  await Settings.findOneAndUpdate(
    { key: 'default' },
    { key: 'default', data: nextData },
    { upsert: true, new: true }
  );
  if (payload.adminName && payload.adminPin) {
    const pinHash = await hashPin(String(payload.adminPin));
    const existing = await User.findOne({ name: String(payload.adminName) });
    if (existing) {
      existing.role = 'Admin';
      existing.pinHash = pinHash;
      existing.branchId = existing.branchId || 'main';
      existing.assignedBranches = 'all';
      existing.active = true;
      await existing.save();
    } else {
      await User.create({
        name: String(payload.adminName),
        role: 'Admin',
        pinHash,
        branchId: 'main',
        assignedBranches: 'all',
        active: true
      });
    }
  }
}

async function wipeTenantDb(tenantId) {
  const conn = await getTenantConnection(tenantId);
  const db = conn?.db;
  if (!db) return;
  const collections = await db.listCollections().toArray();
  for (const item of collections) {
    const name = String(item?.name || '');
    if (!name || name.startsWith('system.')) continue;
    await db.collection(name).deleteMany({});
  }
}

r.get('/me', async (req, res) => {
  const tid = String(req.user?.tenantId || req.tenantId || 'master');
  if (!tid || tid.toLowerCase() === 'master') return res.json({});
  const meta = await Tenant.findOne({ tenantId: tid });
  if (!meta) return res.json({});
  res.json(meta);
});

r.get('/', requireSuperAdmin, async (_req, res) => {
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const rows = await TenantModel.find().sort({ createdAt: -1 }).lean();
  res.json(rows);
});

r.post('/', requireSuperAdmin, async (req, res) => {
  const { tenantId, name, subscriptionPlan, features, adminName, adminPin, clientAppName, logo, themeColor, subscriptionExpiresAt } = req.body || {};
  const tid = normalizeTenantId(tenantId);
  if (!tenantId || tid.toLowerCase() === 'master') return res.status(400).json({ error: 'Invalid tenantId' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Tenant name is required' });
  if (!adminName || !adminPin || !/^\d{4,6}$/.test(String(adminPin))) return res.status(400).json({ error: 'Default admin username and 4-6 digit PIN are required' });
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const exists = await TenantModel.findOne({ tenantId: tid });
  if (exists) return res.status(409).json({ error: 'Tenant already exists' });
  const plan = normalizePlan(subscriptionPlan);
  const enabledFeatures = normalizeFeatureList(plan, features);
  await wipeTenantDb(tid);
  const doc = await TenantModel.create({
    tenantId: tid,
    name: String(name).trim(),
    dbName: getTenantDbName(tid),
    subscriptionPlan: plan,
    features: enabledFeatures,
    clientAppName: String(clientAppName || name).trim(),
    logo: String(logo || ''),
    themeColor: String(themeColor || ''),
    subscriptionExpiresAt: subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null
  });
  await ensureTenantBootstrap(tid, {
    name: String(name).trim(),
    subscriptionPlan: plan,
    features: enabledFeatures,
    adminName: String(adminName).trim(),
    adminPin: String(adminPin),
    clientAppName: String(clientAppName || name).trim(),
    logo: String(logo || ''),
    themeColor: String(themeColor || ''),
    subscriptionExpiresAt: subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null
  });
  res.json(doc);
});

r.patch('/:tenantId', requireSuperAdmin, async (req, res) => {
  const tid = normalizeTenantId(req.params.tenantId);
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const before = await TenantModel.findOne({ tenantId: tid });
  if (!before) return res.status(404).json({ error: 'Tenant not found' });
  const patch = req.body || {};
  const plan = normalizePlan(patch.subscriptionPlan || before.subscriptionPlan);
  const enabledFeatures = normalizeFeatureList(plan, patch.features || before.features);
  const updated = await TenantModel.findOneAndUpdate(
    { tenantId: tid },
    {
      $set: {
        name: patch.name != null ? String(patch.name || '').trim() : before.name,
        subscriptionPlan: plan,
        features: enabledFeatures,
        disabled: typeof patch.disabled === 'boolean' ? patch.disabled : before.disabled,
        clientAppName: patch.clientAppName != null ? String(patch.clientAppName || '') : before.clientAppName,
        logo: patch.logo != null ? String(patch.logo || '') : before.logo,
        themeColor: patch.themeColor != null ? String(patch.themeColor || '') : before.themeColor,
        subscriptionExpiresAt: Object.prototype.hasOwnProperty.call(patch, 'subscriptionExpiresAt')
          ? (patch.subscriptionExpiresAt ? new Date(patch.subscriptionExpiresAt) : null)
          : before.subscriptionExpiresAt
      }
    },
    { new: true }
  );
  await ensureTenantBootstrap(tid, {
    name: updated.name,
    subscriptionPlan: updated.subscriptionPlan,
    features: updated.features,
    clientAppName: updated.clientAppName,
    logo: updated.logo,
    themeColor: updated.themeColor,
    subscriptionExpiresAt: updated.subscriptionExpiresAt
  });
  res.json(updated);
});

r.delete('/:tenantId', requireSuperAdmin, async (req, res) => {
  const tid = normalizeTenantId(req.params.tenantId);
  if (!tid || tid.toLowerCase() === 'master') return res.status(400).json({ error: 'Cannot delete master tenant' });
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const before = await TenantModel.findOne({ tenantId: tid });
  if (!before) return res.status(404).json({ error: 'Tenant not found' });
  try {
    const conn = await getTenantConnection(tid);
    if (conn?.db) await conn.dropDatabase();
  } catch {}
  await TenantModel.deleteOne({ tenantId: tid });
  res.json({ ok: true });
});

r.post('/:tenantId/admin', requireSuperAdmin, async (req, res) => {
  const tid = normalizeTenantId(req.params.tenantId);
  const { adminName, adminPin } = req.body || {};
  if (!adminName || !adminPin || !/^\d{4,6}$/.test(String(adminPin))) {
    return res.status(400).json({ error: 'Admin username and 4-6 digit PIN are required' });
  }
  await ensureTenantBootstrap(tid, {
    adminName: String(adminName).trim(),
    adminPin: String(adminPin)
  });
  res.json({ ok: true });
});

export default r;
