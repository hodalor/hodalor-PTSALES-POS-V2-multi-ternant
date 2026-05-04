import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { modelFor as UserModelFor } from '../models/User.js';
import { verifyPin } from '../utils/pin.js';
import { requireAuth } from '../middleware/auth.js';
import { modelFor as SettingsModelFor } from '../models/Settings.js';
import Tenant from '../models/Tenant.js';
import { filterGrantsByFeatureFlags } from '../config/tenantAccess.js';
import { getMasterConnection, getTenantConnection, resolveStoredTenantId } from '../config/tenancy.js';
import { modelFor as TenantSessionModelFor } from '../models/TenantSession.js';
import { cleanupExpiredTenantSessions, countActiveTenantSessions, getEffectiveTenantLimits, getTenantLimitDefaults, hasActiveTenantSession } from '../utils/tenantLimits.js';
import { activateTenantSubscription, ensureTenantActivationCode } from '../utils/tenantActivation.js';
import { createDpoRenewalPayment, createPayPalRenewalPayment, createPaystackRenewalPayment, getMobileMoneyNetworks, getTenantRenewalInfo, verifyDpoRenewalPayment, verifyPayPalRenewalPayment, verifyPaystackRenewalPayment } from '../utils/subscriptionPayments.js';
import { getPaymentManagementConfig } from '../utils/paymentManagement.js';

const r = Router();
const tenantMetaCache = new Map();
const TENANT_META_TTL_MS = 30_000;
const SUPPORTED_LANGUAGES = new Set(['en', 'tw', 'ga', 'ewe', 'dag', 'fr', 'zh']);

function normalizeLanguage(value) {
  const next = String(value || '').trim().toLowerCase();
  return SUPPORTED_LANGUAGES.has(next) ? next : '';
}

async function getTenantMetaCached(tenantId) {
  const key = String(tenantId || '').toLowerCase();
  const cached = tenantMetaCache.get(key);
  if (cached && (Date.now() - cached.ts) < TENANT_META_TTL_MS) return cached.value;
  const meta = await Tenant.findOne({ tenantId });
  tenantMetaCache.set(key, { ts: Date.now(), value: meta || null });
  return meta || null;
}

function sanitizeTenantMeta(meta) {
  const plain = meta?.toObject?.() || meta || {};
  return {
    ...plain,
    activationCode: undefined,
    activationCodeIssuedAt: undefined,
    activationCodeExpiresAt: undefined,
    activationLastUsedAt: undefined
  };
}

function isTenantExpired(meta) {
  if (!meta || meta.subscriptionPermanent) return false;
  if (!meta.subscriptionExpiresAt) return false;
  return new Date(meta.subscriptionExpiresAt).getTime() <= Date.now();
}

function toLanding(role) {
  const rl = String(role || '');
  if (rl === 'SuperAdmin') return '/tenants';
  if (rl === 'Admin' || rl === 'Manager') return '/dashboard';
  if (rl === 'Inventory Staff') return '/inventory';
  if (rl === 'Auditor') return '/reports';
  return '/pos';
}

r.post('/login', async (req, res) => {
  const { username, pin, tenantId } = req.body || {};
  const loginTenantId = String(req.tenantId || tenantId || 'master').trim() || 'master';
  if (!username || !/^\d{4,6}$/.test(String(pin || '')) || !loginTenantId) return res.status(400).json({ error: 'Invalid input' });
  const User = UserModelFor(req.db);
  const Settings = SettingsModelFor(req.db);
  let meta = null;
  if (String(loginTenantId).toLowerCase() !== 'master') {
    meta = await Tenant.findOne({ tenantId: loginTenantId });
    tenantMetaCache.set(String(loginTenantId || '').toLowerCase(), { ts: Date.now(), value: meta || null });
    if (!meta) return res.status(404).json({ error: 'Tenant not found' });
    if (meta.disabled) return res.status(403).json({ error: 'Tenant disabled' });
    if (isTenantExpired(meta)) {
      return res.status(403).json({ error: 'Subscription expired' });
    }
  }
  const u = await User.findOne({ name: username });
  if (!u || !u.active) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await verifyPin(String(pin), u.pinHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const secret = process.env.JWT_SECRET || '';
  if (!secret) return res.status(500).json({ error: 'Server config error' });
  let jti = '';
  if (String(loginTenantId).toLowerCase() !== 'master') {
    const master = await getMasterConnection();
    const defaults = await getTenantLimitDefaults(master);
    const limits = getEffectiveTenantLimits(meta, defaults);
    if (limits.maxActiveUsers) {
      await cleanupExpiredTenantSessions(master, loginTenantId);
      const alreadyActive = await hasActiveTenantSession(master, loginTenantId, String(u.name || ''), { skipCleanup: true });
      const activeCount = alreadyActive ? 0 : await countActiveTenantSessions(master, loginTenantId, { skipCleanup: true });
      if (!alreadyActive && activeCount >= limits.maxActiveUsers) {
        return res.status(403).json({ error: 'Active limit reached for that tenant. Please wait until someone logs out.' });
      }
    }
    jti = randomUUID();
    const TenantSession = TenantSessionModelFor(master);
    await TenantSession.findOneAndUpdate({
      tenantId: loginTenantId,
      userName: String(u.name || '')
    }, { $set: {
      tenantId: loginTenantId,
      userName: String(u.name || ''),
      jti,
      role: String(u.role || ''),
      expiresAt: new Date(Date.now() + (7 * 24 * 3600 * 1000))
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  let grants = [];
  try {
    const doc = await Settings.findOne({ key: 'default' });
    const map = doc?.data?.userGrants || {};
    const arr = map && map[u.name];
    if (Array.isArray(arr)) grants = filterGrantsByFeatureFlags(arr, doc?.data?.featureFlags || {});
  } catch {}
  const payload = {
    sub: String(u._id),
    name: u.name,
    role: u.role,
    jti,
    tenantId: loginTenantId,
    branchId: u.branchId || 'main',
    assignedBranches: u.assignedBranches,
    preferredLanguage: normalizeLanguage(u.preferredLanguage),
    grants
  };
  const token = jwt.sign(payload, secret, { expiresIn: '7d' });
  res.json({
    token,
    role: u.role,
    grants,
    landing: toLanding(u.role),
    user: {
      name: u.name,
      tenantId: loginTenantId,
      branchId: u.branchId || 'main',
      assignedBranches: u.assignedBranches || (u.branchId ? [u.branchId] : []),
      preferredLanguage: normalizeLanguage(u.preferredLanguage)
    }
  });
});

r.post('/activate-subscription', async (req, res) => {
  const { tenantId, username, pin, activationCode } = req.body || {};
  const resolvedTenantId = await resolveStoredTenantId(String(tenantId || ''));
  if (!resolvedTenantId || resolvedTenantId.toLowerCase() === 'master') return res.status(400).json({ error: 'Invalid tenant' });
  if (!username || !/^\d{4,6}$/.test(String(pin || '')) || !activationCode) return res.status(400).json({ error: 'Invalid input' });
  const master = await getMasterConnection();
  const meta = await ensureTenantActivationCode(master, await Tenant.findOne({ tenantId: resolvedTenantId }));
  if (!meta) return res.status(404).json({ error: 'Tenant not found' });
  if (meta.disabled) return res.status(403).json({ error: 'Tenant disabled' });
  if (meta.subscriptionPermanent) return res.status(400).json({ error: 'This tenant already has permanent access' });
  const code = String(activationCode || '').trim().toUpperCase();
  if (!meta.activationCode || String(meta.activationCode).trim().toUpperCase() !== code) {
    return res.status(403).json({ error: 'Invalid activation code' });
  }
  if (!meta.activationCodeExpiresAt || new Date(meta.activationCodeExpiresAt).getTime() < Date.now()) {
    return res.status(403).json({ error: 'Activation code expired. Please request a new code.' });
  }
  const tenantConn = await getTenantConnection(resolvedTenantId);
  const User = UserModelFor(tenantConn);
  const user = await User.findOne({ name: String(username || '').trim() });
  if (!user || !user.active) return res.status(401).json({ error: 'Invalid tenant admin credentials' });
  const role = String(user.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') return res.status(403).json({ error: 'Only tenant admin can activate subscription' });
  const ok = await verifyPin(String(pin), user.pinHash);
  if (!ok) return res.status(401).json({ error: 'Invalid tenant admin credentials' });
  const updated = await activateTenantSubscription(master, tenantConn, meta, { actorName: String(user.name || '') });
  tenantMetaCache.delete(String(resolvedTenantId || '').toLowerCase());
  res.json({
    ok: true,
    tenant: sanitizeTenantMeta(updated),
    message: 'Subscription extended for 30 days'
  });
});

r.get('/renewal-info', async (req, res) => {
  const resolvedTenantId = await resolveStoredTenantId(String(req.query?.tenantId || ''));
  if (!resolvedTenantId || resolvedTenantId.toLowerCase() === 'master') return res.status(400).json({ error: 'Invalid tenant' });
  const master = await getMasterConnection();
  const meta = await ensureTenantActivationCode(master, await Tenant.findOne({ tenantId: resolvedTenantId }));
  if (!meta) return res.status(404).json({ error: 'Tenant not found' });
  const tenantConn = await getTenantConnection(resolvedTenantId);
  meta._masterConn = master;
  const info = await getTenantRenewalInfo(tenantConn, meta);
  const Settings = SettingsModelFor(tenantConn);
  const settingsDoc = await Settings.findOne({ key: 'default' }).lean().catch(() => null);
  const paymentUnavailableMessage = String(
    settingsDoc?.data?.subscriptionPaymentUnavailableMessage
    || 'Online payment is currently unavailable contact Prynovatechnologies@gmail.com for activation code.'
  );
  const paymentConfig = await getPaymentManagementConfig(master);
  res.json({
    ...info,
    enabledGateways: paymentConfig.enabledGateways,
    mobileMoneyNetworks: getMobileMoneyNetworks(info.billingCountry),
    paymentUnavailableMessage
  });
});

r.post('/start-renewal-payment', async (req, res) => {
  const resolvedTenantId = await resolveStoredTenantId(String(req.body?.tenantId || ''));
  if (!resolvedTenantId || resolvedTenantId.toLowerCase() === 'master') return res.status(400).json({ error: 'Invalid tenant' });
  const master = await getMasterConnection();
  const meta = await ensureTenantActivationCode(master, await Tenant.findOne({ tenantId: resolvedTenantId }));
  if (!meta) return res.status(404).json({ error: 'Tenant not found' });
  if (meta.disabled) return res.status(403).json({ error: 'Tenant disabled' });
  if (!isTenantExpired(meta)) return res.status(400).json({ error: 'Renewal payment is only available for expired tenants' });
  const tenantConn = await getTenantConnection(resolvedTenantId);
  meta._masterConn = master;
  const info = await getTenantRenewalInfo(tenantConn, meta);
  const provider = String(req.body?.provider || 'dpo_pay').trim().toLowerCase();
  const paymentConfig = await getPaymentManagementConfig(master);
  if (!paymentConfig.enabledGateways.includes(provider)) {
    return res.status(403).json({ error: 'That payment gateway is disabled by superadmin' });
  }
  const checkout = provider === 'paypal'
    ? await createPayPalRenewalPayment(info, req.body || {})
    : provider === 'paystack'
      ? await createPaystackRenewalPayment(info, req.body || {})
      : await createDpoRenewalPayment(info, req.body || {});
  res.json({
    ok: true,
    ...checkout,
    mobileMoneyNetworks: getMobileMoneyNetworks(info.billingCountry)
  });
});

r.post('/verify-renewal-payment', async (req, res) => {
  const { tenantId, transactionToken, orderId, txRef, reference, provider } = req.body || {};
  const resolvedTenantId = await resolveStoredTenantId(String(tenantId || ''));
  if (!resolvedTenantId || (!txRef && !reference)) return res.status(400).json({ error: 'Invalid payment verification input' });
  const master = await getMasterConnection();
  const meta = await ensureTenantActivationCode(master, await Tenant.findOne({ tenantId: resolvedTenantId }));
  if (!meta) return res.status(404).json({ error: 'Tenant not found' });
  const tenantConn = await getTenantConnection(resolvedTenantId);
  const chosenProvider = String(provider || 'dpo_pay').trim().toLowerCase();
  const result = chosenProvider === 'paypal'
    ? await verifyPayPalRenewalPayment(master, tenantConn, meta, String(orderId || transactionToken || ''), txRef)
    : chosenProvider === 'paystack'
      ? await verifyPaystackRenewalPayment(master, tenantConn, meta, String(reference || txRef || ''))
      : await verifyDpoRenewalPayment(master, tenantConn, meta, String(transactionToken || ''), txRef);
  tenantMetaCache.delete(String(resolvedTenantId || '').toLowerCase());
  res.json({
    ok: true,
    message: 'Payment verified and subscription renewed',
    tenant: sanitizeTenantMeta(result.updated),
    activationCode: result.refreshedCode,
    activationCodeExpiresAt: result.refreshedCodeExpiresAt,
    months: result.months,
    amount: result.amount
  });
});

export default r;

r.post('/logout', requireAuth, async (req, res) => {
  try {
    const tenantId = String(req.user?.tenantId || req.tenantId || 'master');
    const jti = String(req.user?.jti || '');
    if (tenantId && tenantId.toLowerCase() !== 'master' && jti) {
      const master = await getMasterConnection();
      const TenantSession = TenantSessionModelFor(master);
      await TenantSession.deleteOne({ tenantId, jti });
    }
  } catch {}
  res.json({ ok: true });
});

r.get('/me', requireAuth, async (req, res) => {
  const authUser = req.user || {};
  const User = UserModelFor(req.db);
  const Settings = SettingsModelFor(req.db);
  let grants = Array.isArray(authUser.grants) ? authUser.grants : [];
  let currentUser = null;
  try {
    currentUser = await User.findById(authUser.sub).lean();
  } catch {}
  const u = currentUser || authUser;
  try {
    const doc = await Settings.findOne({ key: 'default' });
    const map = doc?.data?.userGrants || {};
    const arr = map && map[u.name];
    if (Array.isArray(arr)) grants = filterGrantsByFeatureFlags(arr, doc?.data?.featureFlags || {});
  } catch {}
  res.json({
    role: u.role || null,
    grants,
    user: {
      name: u.name,
      tenantId: authUser.tenantId || req.tenantId || 'master',
      branchId: u.branchId || 'main',
      assignedBranches: u.assignedBranches || (u.branchId ? [u.branchId] : []),
      preferredLanguage: normalizeLanguage(u.preferredLanguage)
    }
  });
});

r.patch('/me', requireAuth, async (req, res) => {
  const User = UserModelFor(req.db);
  const authUser = req.user || {};
  const updates = req.body || {};
  const u = await User.findById(authUser.sub);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (Object.prototype.hasOwnProperty.call(updates, 'preferredLanguage')) {
    u.preferredLanguage = normalizeLanguage(updates.preferredLanguage);
  }
  await u.save();
  res.json({
    ok: true,
    user: {
      name: u.name,
      tenantId: authUser.tenantId || req.tenantId || 'master',
      branchId: u.branchId || 'main',
      assignedBranches: u.assignedBranches || (u.branchId ? [u.branchId] : []),
      preferredLanguage: normalizeLanguage(u.preferredLanguage)
    }
  });
});
