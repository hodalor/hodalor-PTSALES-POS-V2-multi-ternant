import { Router } from 'express';
import Tenant, { modelFor as TenantModelFor } from '../models/Tenant.js';
import { modelFor as UserModelFor } from '../models/User.js';
import { modelFor as BranchModelFor } from '../models/Branch.js';
import { modelFor as SettingsModelFor } from '../models/Settings.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { getMasterConnection, getTenantConnection, getTenantDbName, normalizeTenantId } from '../config/tenancy.js';
import { hashPin } from '../utils/pin.js';

const r = Router();
r.use(requireAuth);

const ALL_FEATURES = [
  'modules.dashboard', 'modules.pos', 'modules.wholesalePos', 'modules.invoices', 'modules.sales',
  'modules.products', 'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.expenses',
  'modules.transfers', 'modules.adjustments', 'modules.suppliers', 'modules.customers',
  'modules.creditControl', 'modules.approvalsCenter', 'modules.refunds', 'modules.refundApprovals',
  'modules.expenseApprovals', 'modules.reports', 'modules.backup',
  'admin.users', 'admin.manual', 'admin.audit', 'admin.serverLogs', 'admin.stockRecords',
  'admin.cashDrawer', 'admin.config', 'admin.godhand', 'admin.docs',
  'features.offlineBackup',
  'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords'
];

const PLAN_FEATURES = {
  basic: [
    'modules.dashboard', 'modules.pos', 'modules.invoices', 'modules.sales', 'modules.products',
    'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.suppliers',
    'modules.customers', 'modules.backup', 'admin.users', 'admin.audit',
    'admin.cashDrawer', 'admin.config', 'features.offlineBackup',
    'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords'
  ],
  pro: [
    'modules.dashboard', 'modules.pos', 'modules.invoices', 'modules.sales', 'modules.products',
    'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.expenses',
    'modules.transfers', 'modules.adjustments', 'modules.suppliers', 'modules.customers',
    'modules.approvalsCenter', 'modules.refunds', 'modules.refundApprovals', 'modules.expenseApprovals',
    'modules.reports', 'modules.backup', 'admin.users', 'admin.manual', 'admin.audit',
    'admin.serverLogs', 'admin.stockRecords', 'admin.cashDrawer', 'admin.config',
    'features.offlineBackup', 'tabs.customerPurchaseHistory', 'tabs.posHeldSales',
    'tabs.invoiceNew', 'tabs.invoiceRecords'
  ],
  enterprise: ALL_FEATURES.slice()
};

function normalizePlan(plan) {
  const value = String(plan || 'basic').trim().toLowerCase();
  return ['basic', 'pro', 'enterprise'].includes(value) ? value : 'basic';
}

function normalizeFeatureList(plan, features) {
  const base = new Set(PLAN_FEATURES[normalizePlan(plan)] || PLAN_FEATURES.basic);
  const extras = Array.isArray(features) ? features : [];
  extras.forEach((key) => {
    const value = String(key || '').trim();
    if (ALL_FEATURES.includes(value)) base.add(value);
  });
  return ALL_FEATURES.filter((key) => base.has(key));
}

function featureFlagsFromEnabled(enabledList) {
  const enabled = new Set((enabledList || []).map((x) => String(x)));
  const flags = {};
  ALL_FEATURES.forEach((key) => {
    if (!enabled.has(key)) flags[key] = false;
  });
  return flags;
}

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
