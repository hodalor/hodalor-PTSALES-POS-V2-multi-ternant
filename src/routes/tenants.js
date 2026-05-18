import { Router } from 'express';
import Tenant, { modelFor as TenantModelFor } from '../models/Tenant.js';
import { modelFor as UserModelFor } from '../models/User.js';
import { modelFor as BranchModelFor } from '../models/Branch.js';
import { modelFor as SettingsModelFor } from '../models/Settings.js';
import { requireAuth, requireFeature, requireRoleOrPerm, requireSuperAdmin } from '../middleware/auth.js';
import { getMasterConnection, getTenantConnection, getTenantDbName, normalizeTenantId } from '../config/tenancy.js';
import { hashPin } from '../utils/pin.js';
import { ALL_FEATURES, featureFlagsFromEnabled, normalizeFeatureList } from '../config/tenantAccess.js';
import { getEffectiveTenantLimits, getTenantLimitDefaults, getTenantUsageSummary, normalizeLimitDefaults, normalizeLimitValue, saveTenantLimitDefaults } from '../utils/tenantLimits.js';
import { buildRenewalHistoryEntry, ensureTenantActivationCode, normalizeSubscriptionAmount, refreshTenantActivationCode, syncTenantSubscriptionSnapshot } from '../utils/tenantActivation.js';
import { getPaymentManagementDashboard, savePaymentManagementConfig } from '../utils/paymentManagement.js';
import { getSubscriptionManagementConfig, resolveSubscriptionPlan, saveSubscriptionManagementConfig } from '../utils/subscriptionManagement.js';
import { exportTenantData, importTenantData } from '../utils/tenantDataTransfer.js';
import { createDpoLimitUpgradePayment, createPayPalLimitUpgradePayment, createPaystackLimitUpgradePayment, getMobileMoneyNetworks, getTenantLimitUpgradeInfo, verifyDpoLimitUpgradePayment, verifyPayPalLimitUpgradePayment, verifyPaystackLimitUpgradePayment } from '../utils/subscriptionPayments.js';

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
    subscriptionExpiresAt: payload.subscriptionPermanent ? null : (payload.subscriptionExpiresAt || current?.data?.subscriptionExpiresAt || null),
    subscriptionPermanent: !!payload.subscriptionPermanent,
    subscriptionAmount: normalizeSubscriptionAmount(payload.subscriptionAmount),
    billingEmail: payload.billingEmail || current?.data?.billingEmail || '',
    billingPhone: payload.billingPhone || current?.data?.billingPhone || '',
    billingAddress: payload.billingAddress || current?.data?.billingAddress || '',
    billingCountry: payload.billingCountry || current?.data?.billingCountry || 'GH'
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
  const master = await getMasterConnection();
  const meta = await ensureTenantActivationCode(master, await Tenant.findOne({ tenantId: tid }));
  if (!meta) return res.json({});
  const tenantConn = await getTenantConnection(tid);
  const defaults = await getTenantLimitDefaults(master);
  const usageSummary = await getTenantUsageSummary(master, tenantConn, meta, defaults);
  meta._masterConn = master;
  const upgradeInfo = await getTenantLimitUpgradeInfo(tenantConn, meta, usageSummary);
  const paymentConfig = await getPaymentManagementConfig(master);
  res.json({
    ...meta.toObject?.() || meta,
    limits: usageSummary.limits,
    usage: usageSummary.usage,
    addOnPricing: upgradeInfo.addOnPricing,
    enabledGateways: paymentConfig.enabledGateways,
    mobileMoneyNetworks: getMobileMoneyNetworks(upgradeInfo.billingCountry),
    activationCode: undefined,
    activationCodeIssuedAt: undefined,
    activationCodeExpiresAt: undefined,
    activationLastUsedAt: undefined
  });
});

r.post('/start-limit-upgrade-payment', requireRoleOrPerm(['Admin', 'SuperAdmin'], 'view_config'), async (req, res) => {
  const tid = normalizeTenantId(req.user?.tenantId || req.tenantId || '');
  if (!tid || tid.toLowerCase() === 'master') return res.status(400).json({ error: 'Tenant payment is only available for tenant databases' });
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const tenant = await TenantModel.findOne({ tenantId: tid });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  if (tenant.disabled) return res.status(403).json({ error: 'Tenant disabled' });
  const tenantConn = await getTenantConnection(tid);
  const defaults = await getTenantLimitDefaults(master);
  const usageSummary = await getTenantUsageSummary(master, tenantConn, tenant, defaults);
  tenant._masterConn = master;
  const info = await getTenantLimitUpgradeInfo(tenantConn, tenant, usageSummary);
  const provider = String(req.body?.provider || 'paystack').trim().toLowerCase();
  const paymentConfig = await getPaymentManagementConfig(master);
  if (!paymentConfig.enabledGateways.includes(provider)) {
    return res.status(403).json({ error: 'That payment gateway is disabled by superadmin' });
  }
  const checkout = provider === 'paypal'
    ? await createPayPalLimitUpgradePayment(info, req.body || {})
    : provider === 'paystack'
      ? await createPaystackLimitUpgradePayment(info, req.body || {})
      : await createDpoLimitUpgradePayment(info, req.body || {});
  res.json({
    ok: true,
    ...checkout,
    limits: usageSummary.limits,
    usage: usageSummary.usage,
    addOnPricing: info.addOnPricing,
    mobileMoneyNetworks: getMobileMoneyNetworks(info.billingCountry)
  });
});

r.post('/verify-limit-upgrade-payment', requireRoleOrPerm(['Admin', 'SuperAdmin'], 'view_config'), async (req, res) => {
  const tid = normalizeTenantId(req.user?.tenantId || req.tenantId || '');
  if (!tid || tid.toLowerCase() === 'master') return res.status(400).json({ error: 'Tenant payment is only available for tenant databases' });
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const tenant = await TenantModel.findOne({ tenantId: tid });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const provider = String(req.body?.provider || 'paystack').trim().toLowerCase();
  const result = provider === 'paypal'
    ? await verifyPayPalLimitUpgradePayment(master, tenant, String(req.body?.orderId || req.body?.transactionToken || ''), String(req.body?.txRef || ''))
    : provider === 'paystack'
      ? await verifyPaystackLimitUpgradePayment(master, tenant, String(req.body?.reference || req.body?.txRef || ''))
      : await verifyDpoLimitUpgradePayment(master, tenant, String(req.body?.transactionToken || ''), String(req.body?.txRef || ''));
  const refreshedTenant = result.updated;
  const tenantConn = await getTenantConnection(tid);
  const defaults = await getTenantLimitDefaults(master);
  const usageSummary = await getTenantUsageSummary(master, tenantConn, refreshedTenant, defaults);
  const limits = getEffectiveTenantLimits(refreshedTenant, defaults);
  res.json({
    ok: true,
    message: `${result.resourceType === 'branch' ? 'Branch' : 'User'} limit increased successfully`,
    tenant: refreshedTenant,
    resourceType: result.resourceType,
    quantity: result.quantity,
    amount: result.amount,
    limits,
    usage: usageSummary.usage
  });
});

r.get('/data-export', requireFeature('modules.backup'), requireRoleOrPerm(['Admin'], 'export_tenant_data'), async (req, res) => {
  const tid = normalizeTenantId(req.user?.tenantId || req.tenantId || '');
  if (!tid || tid.toLowerCase() === 'master') return res.status(400).json({ error: 'Tenant export is only available for tenant databases' });
  const payload = await exportTenantData(tid);
  res.json(payload);
});

r.post('/data-import', requireFeature('modules.backup'), requireRoleOrPerm(['Admin'], 'import_tenant_data'), async (req, res) => {
  const tid = normalizeTenantId(req.user?.tenantId || req.tenantId || '');
  if (!tid || tid.toLowerCase() === 'master') return res.status(400).json({ error: 'Tenant import is only available for tenant databases' });
  const mode = String(req.body?.mode || 'keep_current').trim().toLowerCase() === 'overwrite' ? 'overwrite' : 'keep_current';
  const data = req.body?.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Import payload is required' });
  const result = await importTenantData(tid, data, mode);
  res.json(result);
});

r.get('/', requireSuperAdmin, async (_req, res) => {
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const rows = await TenantModel.find().sort({ createdAt: -1 });
  const defaults = await getTenantLimitDefaults(master);
  const ensured = await Promise.all(rows.map((row) => ensureTenantActivationCode(master, row)));
  const plain = await Promise.all(ensured.map(async (row) => {
    const item = row?.toObject?.() || row;
    const tid = String(item?.tenantId || '');
    let usageSummary = { limits: getEffectiveTenantLimits(item, defaults), usage: null };
    try {
      if (tid) {
        const tenantConn = await getTenantConnection(tid);
        usageSummary = await getTenantUsageSummary(master, tenantConn, item, defaults);
      }
    } catch {}
    return {
      ...item,
      features: normalizeFeatureList(item?.subscriptionPlan, Array.isArray(item?.features) ? item.features : []),
      limits: usageSummary.limits,
      usage: usageSummary.usage
    };
  }));
  res.json(plain);
});

r.get('/limits', requireSuperAdmin, async (_req, res) => {
  const master = await getMasterConnection();
  const defaults = await getTenantLimitDefaults(master);
  res.json(defaults);
});

r.get('/payment-management', requireSuperAdmin, async (_req, res) => {
  const master = await getMasterConnection();
  const dashboard = await getPaymentManagementDashboard(master);
  res.json(dashboard);
});

r.patch('/payment-management', requireSuperAdmin, async (req, res) => {
  const master = await getMasterConnection();
  const saved = await savePaymentManagementConfig(master, req.body || {});
  const dashboard = await getPaymentManagementDashboard(master);
  res.json({ ...dashboard, gateways: saved.gateways, enabledGateways: saved.enabledGateways });
});

r.get('/subscription-management', requireSuperAdmin, async (_req, res) => {
  const master = await getMasterConnection();
  const config = await getSubscriptionManagementConfig(master);
  res.json(config);
});

r.patch('/subscription-management', requireSuperAdmin, async (req, res) => {
  const master = await getMasterConnection();
  const saved = await saveSubscriptionManagementConfig(master, req.body || {});
  res.json(saved);
});

r.get('/user-audit', requireSuperAdmin, async (_req, res) => {
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const tenantRows = await TenantModel.find().sort({ tenantId: 1 }).lean();
  const nameMap = new Map();
  for (const tenant of tenantRows) {
    const tid = String(tenant.tenantId || '').trim();
    if (!tid) continue;
    const conn = await getTenantConnection(tid);
    const User = UserModelFor(conn);
    const rows = await User.find({}, { name: 1, role: 1, createdAt: 1, updatedAt: 1 }).sort({ name: 1 }).lean();
    rows.forEach((row) => {
      const key = String(row.name || '').trim();
      if (!key) return;
      if (!nameMap.has(key)) nameMap.set(key, []);
      nameMap.get(key).push({
        tenantId: tid,
        role: String(row.role || ''),
        createdAt: row.createdAt || null,
        updatedAt: row.updatedAt || null
      });
    });
  }
  const duplicates = Array.from(nameMap.entries())
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([userName, occurrences]) => {
      const matchingTenant = tenantRows.find((tenant) => String(tenant.tenantId || '').toLowerCase() === String(userName || '').toLowerCase());
      return {
        userName,
        suggestedOwnerTenantId: matchingTenant ? String(matchingTenant.tenantId || '') : '',
        occurrences
      };
    })
    .sort((a, b) => String(a.userName || '').localeCompare(String(b.userName || '')));
  res.json({
    scannedTenants: tenantRows.length,
    duplicateUserNames: duplicates,
    duplicateCount: duplicates.length
  });
});

r.post('/user-audit/cleanup', requireSuperAdmin, async (req, res) => {
  const tenantId = normalizeTenantId(req.body?.tenantId);
  const userName = String(req.body?.userName || '').trim();
  if (!tenantId || !userName) return res.status(400).json({ error: 'tenantId and userName are required' });
  const conn = await getTenantConnection(tenantId);
  const User = UserModelFor(conn);
  const result = await User.deleteOne({ name: userName });
  res.json({ ok: true, tenantId, userName, deletedCount: result.deletedCount || 0 });
});

r.patch('/limits', requireSuperAdmin, async (req, res) => {
  const master = await getMasterConnection();
  const defaults = normalizeLimitDefaults(req.body || {});
  const saved = await saveTenantLimitDefaults(master, defaults);
  res.json(saved);
});

r.post('/', requireSuperAdmin, async (req, res) => {
  const { tenantId, name, subscriptionPlan, features, adminName, adminPin, clientAppName, billingEmail, billingPhone, billingAddress, billingCountry, logo, themeColor, subscriptionExpiresAt, subscriptionPermanent, subscriptionAmount, maxUserAccountsOverride, maxActiveUsersOverride, maxBranchesOverride, additionalUserRateOverride, additionalBranchRateOverride, additionalUserSlots, additionalBranchSlots } = req.body || {};
  const tid = normalizeTenantId(tenantId);
  if (!tenantId || tid.toLowerCase() === 'master') return res.status(400).json({ error: 'Invalid tenantId' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Tenant name is required' });
  if (!adminName || !adminPin || !/^\d{4,6}$/.test(String(adminPin))) return res.status(400).json({ error: 'Default admin username and 4-6 digit PIN are required' });
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const exists = await TenantModel.findOne({ tenantId: tid });
  if (exists) return res.status(409).json({ error: 'Tenant already exists' });
  const planConfig = await resolveSubscriptionPlan(master, subscriptionPlan);
  const plan = String(planConfig?.key || 'basic');
  const enabledFeatures = Array.isArray(features) && features.length > 0
    ? normalizeFeatureList(plan, features.map((item) => String(item || '').trim()).filter((item) => ALL_FEATURES.includes(item)))
    : normalizeFeatureList(plan, Array.isArray(planConfig?.features) ? planConfig.features : []);
  await wipeTenantDb(tid);
  const doc = await TenantModel.create({
    tenantId: tid,
    name: String(name).trim(),
    dbName: getTenantDbName(tid),
    subscriptionPlan: plan,
    features: enabledFeatures,
    clientAppName: String(clientAppName || name).trim(),
    billingEmail: String(billingEmail || '').trim(),
    billingPhone: String(billingPhone || '').trim(),
    billingAddress: String(billingAddress || '').trim(),
    billingCountry: String(billingCountry || 'GH').trim().toUpperCase(),
    logo: String(logo || ''),
    themeColor: String(themeColor || ''),
    subscriptionExpiresAt: subscriptionPermanent ? null : (subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null),
    subscriptionPermanent: !!subscriptionPermanent,
    subscriptionAmount: normalizeSubscriptionAmount(subscriptionAmount),
    renewalHistory: [buildRenewalHistoryEntry({
      source: 'tenant_created',
      amount: subscriptionAmount,
      previousExpiry: null,
      newExpiry: subscriptionPermanent ? null : (subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null),
      permanentBefore: false,
      permanentAfter: !!subscriptionPermanent,
      note: 'Initial tenant subscription setup',
      actorName: String(req.user?.name || '')
    })],
    maxUserAccountsOverride: normalizeLimitValue(maxUserAccountsOverride),
    maxActiveUsersOverride: normalizeLimitValue(maxActiveUsersOverride),
    maxBranchesOverride: normalizeLimitValue(maxBranchesOverride),
    additionalUserRateOverride: normalizeSubscriptionAmount(additionalUserRateOverride),
    additionalBranchRateOverride: normalizeSubscriptionAmount(additionalBranchRateOverride),
    additionalUserSlots: Math.max(0, normalizeLimitValue(additionalUserSlots) || 0),
    additionalBranchSlots: Math.max(0, normalizeLimitValue(additionalBranchSlots) || 0)
  });
  const withCode = await ensureTenantActivationCode(master, doc);
  await ensureTenantBootstrap(tid, {
    name: String(name).trim(),
    subscriptionPlan: plan,
    features: enabledFeatures,
    adminName: String(adminName).trim(),
    adminPin: String(adminPin),
    clientAppName: String(clientAppName || name).trim(),
    billingEmail: String(billingEmail || '').trim(),
    billingPhone: String(billingPhone || '').trim(),
    billingAddress: String(billingAddress || '').trim(),
    billingCountry: String(billingCountry || 'GH').trim().toUpperCase(),
    logo: String(logo || ''),
    themeColor: String(themeColor || ''),
    subscriptionExpiresAt: subscriptionPermanent ? null : (subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null),
    subscriptionPermanent: !!subscriptionPermanent,
    subscriptionAmount: normalizeSubscriptionAmount(subscriptionAmount)
  });
  res.json(withCode);
});

r.patch('/:tenantId', requireSuperAdmin, async (req, res) => {
  const tid = normalizeTenantId(req.params.tenantId);
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const before = await TenantModel.findOne({ tenantId: tid });
  if (!before) return res.status(404).json({ error: 'Tenant not found' });
  const patch = req.body || {};
  const planConfig = await resolveSubscriptionPlan(master, patch.subscriptionPlan || before.subscriptionPlan);
  const plan = String(planConfig?.key || before.subscriptionPlan || 'basic');
  const enabledFeatures = Array.isArray(patch.features)
    ? normalizeFeatureList(plan, patch.features.map((item) => String(item || '').trim()).filter((item) => ALL_FEATURES.includes(item)))
    : normalizeFeatureList(
      plan,
      Array.isArray(before.features) && before.features.length > 0
        ? before.features
        : (Array.isArray(planConfig?.features) ? planConfig.features : [])
    );
  const nextPermanent = Object.prototype.hasOwnProperty.call(patch, 'subscriptionPermanent')
    ? !!patch.subscriptionPermanent
    : !!before.subscriptionPermanent;
  const explicitExpiryProvided = Object.prototype.hasOwnProperty.call(patch, 'subscriptionExpiresAt');
  const nextExpiry = nextPermanent
    ? null
    : explicitExpiryProvided
      ? (patch.subscriptionExpiresAt ? new Date(patch.subscriptionExpiresAt) : new Date())
      : (before.subscriptionPermanent ? new Date() : before.subscriptionExpiresAt);
  const nextAmount = Object.prototype.hasOwnProperty.call(patch, 'subscriptionAmount')
    ? normalizeSubscriptionAmount(patch.subscriptionAmount)
    : normalizeSubscriptionAmount(before.subscriptionAmount);
  const shouldLogRenewalChange =
    Object.prototype.hasOwnProperty.call(patch, 'subscriptionExpiresAt') ||
    Object.prototype.hasOwnProperty.call(patch, 'subscriptionPermanent') ||
    Object.prototype.hasOwnProperty.call(patch, 'subscriptionAmount');
  const renewalHistoryEntry = shouldLogRenewalChange ? buildRenewalHistoryEntry({
    source: 'superadmin_update',
    amount: nextAmount,
    previousExpiry: before.subscriptionExpiresAt || null,
    newExpiry: nextExpiry || null,
    permanentBefore: !!before.subscriptionPermanent,
    permanentAfter: !!nextPermanent,
    note: 'Superadmin updated subscription settings',
    actorName: String(req.user?.name || '')
  }) : null;
  const updated = await TenantModel.findOneAndUpdate(
    { tenantId: tid },
    {
      $set: {
        name: patch.name != null ? String(patch.name || '').trim() : before.name,
        subscriptionPlan: plan,
        features: enabledFeatures,
        disabled: typeof patch.disabled === 'boolean' ? patch.disabled : before.disabled,
        clientAppName: patch.clientAppName != null ? String(patch.clientAppName || '') : before.clientAppName,
        billingEmail: patch.billingEmail != null ? String(patch.billingEmail || '').trim() : before.billingEmail,
        billingPhone: patch.billingPhone != null ? String(patch.billingPhone || '').trim() : before.billingPhone,
        billingAddress: patch.billingAddress != null ? String(patch.billingAddress || '').trim() : before.billingAddress,
        billingCountry: patch.billingCountry != null ? String(patch.billingCountry || 'GH').trim().toUpperCase() : before.billingCountry,
        logo: patch.logo != null ? String(patch.logo || '') : before.logo,
        themeColor: patch.themeColor != null ? String(patch.themeColor || '') : before.themeColor,
        subscriptionPermanent: nextPermanent,
        subscriptionAmount: nextAmount,
        maxUserAccountsOverride: Object.prototype.hasOwnProperty.call(patch, 'maxUserAccountsOverride')
          ? normalizeLimitValue(patch.maxUserAccountsOverride)
          : before.maxUserAccountsOverride,
        maxActiveUsersOverride: Object.prototype.hasOwnProperty.call(patch, 'maxActiveUsersOverride')
          ? normalizeLimitValue(patch.maxActiveUsersOverride)
          : before.maxActiveUsersOverride,
        maxBranchesOverride: Object.prototype.hasOwnProperty.call(patch, 'maxBranchesOverride')
          ? normalizeLimitValue(patch.maxBranchesOverride)
          : before.maxBranchesOverride,
        additionalUserRateOverride: Object.prototype.hasOwnProperty.call(patch, 'additionalUserRateOverride')
          ? normalizeSubscriptionAmount(patch.additionalUserRateOverride)
          : before.additionalUserRateOverride,
        additionalBranchRateOverride: Object.prototype.hasOwnProperty.call(patch, 'additionalBranchRateOverride')
          ? normalizeSubscriptionAmount(patch.additionalBranchRateOverride)
          : before.additionalBranchRateOverride,
        additionalUserSlots: Object.prototype.hasOwnProperty.call(patch, 'additionalUserSlots')
          ? Math.max(0, normalizeLimitValue(patch.additionalUserSlots) || 0)
          : (before.additionalUserSlots || 0),
        additionalBranchSlots: Object.prototype.hasOwnProperty.call(patch, 'additionalBranchSlots')
          ? Math.max(0, normalizeLimitValue(patch.additionalBranchSlots) || 0)
          : (before.additionalBranchSlots || 0),
        subscriptionExpiresAt: nextExpiry
      },
      ...(renewalHistoryEntry ? { $push: { renewalHistory: renewalHistoryEntry } } : {})
    },
    { new: true }
  );
  await ensureTenantBootstrap(tid, {
    name: updated.name,
    subscriptionPlan: updated.subscriptionPlan,
    features: updated.features,
    clientAppName: updated.clientAppName,
    billingEmail: updated.billingEmail,
    billingPhone: updated.billingPhone,
    billingAddress: updated.billingAddress,
    billingCountry: updated.billingCountry,
    logo: updated.logo,
    themeColor: updated.themeColor,
    subscriptionExpiresAt: updated.subscriptionExpiresAt,
    subscriptionPermanent: updated.subscriptionPermanent,
    subscriptionAmount: updated.subscriptionAmount
  });
  res.json(updated);
});

r.post('/:tenantId/activation-code/refresh', requireSuperAdmin, async (req, res) => {
  const tid = normalizeTenantId(req.params.tenantId);
  const master = await getMasterConnection();
  const updated = await refreshTenantActivationCode(master, tid);
  if (!updated) return res.status(404).json({ error: 'Tenant not found' });
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

r.get('/:tenantId/data-export', requireSuperAdmin, async (req, res) => {
  const tid = normalizeTenantId(req.params.tenantId);
  if (!tid || tid.toLowerCase() === 'master') return res.status(400).json({ error: 'Invalid tenantId' });
  const payload = await exportTenantData(tid);
  res.json(payload);
});

r.post('/:tenantId/data-import', requireSuperAdmin, async (req, res) => {
  const tid = normalizeTenantId(req.params.tenantId);
  if (!tid || tid.toLowerCase() === 'master') return res.status(400).json({ error: 'Invalid tenantId' });
  const mode = String(req.body?.mode || 'keep_current').trim().toLowerCase() === 'overwrite' ? 'overwrite' : 'keep_current';
  const data = req.body?.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Import payload is required' });
  const result = await importTenantData(tid, data, mode);
  res.json(result);
});

export default r;
