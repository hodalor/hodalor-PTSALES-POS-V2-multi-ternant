import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { modelFor as UserModelFor } from '../models/User.js';
import { verifyPin } from '../utils/pin.js';
import { requireAuth } from '../middleware/auth.js';
import { modelFor as SettingsModelFor } from '../models/Settings.js';
import Tenant from '../models/Tenant.js';
import { filterGrantsByFeatureFlags } from '../config/tenantAccess.js';
import { getMasterConnection } from '../config/tenancy.js';
import { modelFor as TenantSessionModelFor } from '../models/TenantSession.js';
import { cleanupExpiredTenantSessions, countActiveTenantSessions, getEffectiveTenantLimits, getTenantLimitDefaults, hasActiveTenantSession } from '../utils/tenantLimits.js';

const r = Router();
const tenantMetaCache = new Map();
const TENANT_META_TTL_MS = 30_000;

async function getTenantMetaCached(tenantId) {
  const key = String(tenantId || '').toLowerCase();
  const cached = tenantMetaCache.get(key);
  if (cached && (Date.now() - cached.ts) < TENANT_META_TTL_MS) return cached.value;
  const meta = await Tenant.findOne({ tenantId });
  tenantMetaCache.set(key, { ts: Date.now(), value: meta || null });
  return meta || null;
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
    meta = await getTenantMetaCached(loginTenantId);
    if (!meta) return res.status(404).json({ error: 'Tenant not found' });
    if (meta.disabled) return res.status(403).json({ error: 'Tenant disabled' });
    if (meta.subscriptionExpiresAt && new Date(meta.subscriptionExpiresAt).getTime() < Date.now()) {
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
    grants
  };
  const token = jwt.sign(payload, secret, { expiresIn: '7d' });
  res.json({
    token,
    role: u.role,
    grants,
    landing: toLanding(u.role),
    user: { name: u.name, tenantId: loginTenantId, branchId: u.branchId || 'main', assignedBranches: u.assignedBranches || (u.branchId ? [u.branchId] : []) }
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
  const u = req.user || {};
  const Settings = SettingsModelFor(req.db);
  let grants = Array.isArray(u.grants) ? u.grants : [];
  try {
    const doc = await Settings.findOne({ key: 'default' });
    const map = doc?.data?.userGrants || {};
    const arr = map && map[u.name];
    if (Array.isArray(arr)) grants = filterGrantsByFeatureFlags(arr, doc?.data?.featureFlags || {});
  } catch {}
  res.json({
    role: u.role || null,
    grants,
    user: { name: u.name, tenantId: u.tenantId || req.tenantId || 'master', branchId: u.branchId || 'main', assignedBranches: u.assignedBranches || (u.branchId ? [u.branchId] : []) }
  });
});
