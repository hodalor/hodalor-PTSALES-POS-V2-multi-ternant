import { Router } from 'express';
import { modelFor as UserModelFor } from '../models/User.js';
import { modelFor as AuditModelFor } from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireAdmin, requireRoleOrPerm } from '../middleware/auth.js';
import { hashPin } from '../utils/pin.js';
import { getMasterConnection } from '../config/tenancy.js';
import Tenant, { modelFor as TenantModelFor } from '../models/Tenant.js';
import { modelFor as TenantSessionModelFor } from '../models/TenantSession.js';
import { getEffectiveTenantLimits, getTenantLimitDefaults, getTenantUsageSummary } from '../utils/tenantLimits.js';
import { getPaymentManagementConfig } from '../utils/paymentManagement.js';
import { getMobileMoneyNetworks, getTenantLimitUpgradeInfo } from '../utils/subscriptionPayments.js';

const r = Router();
const SUPPORTED_LANGUAGES = new Set(['en', 'tw', 'ga', 'ewe', 'dag', 'fr', 'zh']);

function normalizeLanguage(value) {
  const next = String(value || '').trim().toLowerCase();
  return SUPPORTED_LANGUAGES.has(next) ? next : '';
}

r.use(requireAuth);

r.get('/', requireAdmin, async (req, res) => {
  const User = UserModelFor(req.db);
  const rows = await User.find().sort({ name: 1 }).lean();
  const mapped = rows.map(u => ({
    id: String(u._id),
    name: u.name,
    role: u.role,
    branchId: u.branchId || 'main',
    assignedBranches: u.assignedBranches ?? (u.branchId ? [u.branchId] : []),
    preferredLanguage: normalizeLanguage(u.preferredLanguage),
    active: u.active !== false
  }));
  res.json(mapped);
});

r.post('/', requireAdmin, async (req, res) => {
  const User = UserModelFor(req.db);
  const Audit = AuditModelFor(req.db);
  const { name, role, pin, branchId, assignedBranches, preferredLanguage } = req.body || {};
  if (!name || !role || !/^\d{4,6}$/.test(String(pin || ''))) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master');
  if (tenantId.toLowerCase() !== 'master') {
    const master = await getMasterConnection();
    const TenantModel = TenantModelFor(master);
    const tenant = await TenantModel.findOne({ tenantId }).lean();
    const defaults = await getTenantLimitDefaults(master);
    const limits = getEffectiveTenantLimits(tenant, defaults);
    if (limits.maxUserAccounts) {
      const usageSummary = await getTenantUsageSummary(master, req.db, tenant, defaults);
      if ((usageSummary?.usage?.totalUsers || 0) >= limits.maxUserAccounts) {
        const paymentConfig = await getPaymentManagementConfig(master);
        tenant._masterConn = master;
        const upgradeInfo = await getTenantLimitUpgradeInfo(req.db, tenant, usageSummary);
        return res.status(403).json({
          error: 'User account creation limit reached. Contact admin or pay for additional user slots.',
          code: 'TENANT_USER_LIMIT_REACHED',
          resourceType: 'user',
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
  const exists = await User.findOne({ name });
  if (exists) return res.status(409).json({ error: 'User already exists' });
  const pinHash = await hashPin(String(pin));
  let assigned = assignedBranches;
  if (assigned === undefined) {
    assigned = branchId ? [branchId] : [];
  }
  if (assigned !== 'all' && !Array.isArray(assigned)) {
    assigned = [assigned];
  }
  const doc = await User.create({
    name,
    role,
    pinHash,
    assignedBranches: assigned,
    branchId: Array.isArray(assigned) ? (assigned[0] || branchId || 'main') : (branchId || 'main'),
    preferredLanguage: normalizeLanguage(preferredLanguage),
    active: true
  });
  res.json({
    id: String(doc._id),
    name: doc.name,
    role: doc.role,
    branchId: doc.branchId || 'main',
    assignedBranches: doc.assignedBranches,
    preferredLanguage: normalizeLanguage(doc.preferredLanguage),
    active: doc.active !== false
  });
  void Audit.create({
    actor: (req.user && req.user.name) || 'unknown',
    actionType: 'user_create',
    details: { name: doc.name, role: doc.role, assignedBranches: doc.assignedBranches },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: (req.user && req.user.name) || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'POST',
    status: 200,
    message: `User created: ${doc.name}`,
    details: { role: doc.role }
  }).catch(() => {});
});

r.put('/:name', requireAdmin, async (req, res) => {
  const User = UserModelFor(req.db);
  const Audit = AuditModelFor(req.db);
  const name = req.params.name;
  const { name: newName, role, pin, branchId, assignedBranches, preferredLanguage, active } = req.body || {};
  const u = await User.findOne({ name });
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (newName && newName !== u.name) {
    const exists = await User.findOne({ name: newName });
    if (exists) return res.status(409).json({ error: 'User already exists' });
    u.name = newName;
  }
  if (role) u.role = role;
  if (typeof active === 'boolean') u.active = active;
  if (assignedBranches !== undefined) {
    let assigned = assignedBranches;
    if (assigned !== 'all' && !Array.isArray(assigned)) assigned = [assigned];
    u.assignedBranches = assigned;
    if (assigned === 'all') {
      u.branchId = 'main';
    } else if (Array.isArray(assigned) && assigned.length > 0) {
      u.branchId = assigned[0];
    } else if (branchId) {
      u.branchId = branchId;
      u.assignedBranches = [branchId];
    }
  } else if (branchId) {
    u.branchId = branchId;
    if (u.assignedBranches !== 'all') {
      if (!Array.isArray(u.assignedBranches)) u.assignedBranches = [branchId];
      else if (u.assignedBranches.length === 0) u.assignedBranches = [branchId];
      else u.assignedBranches[0] = branchId;
    }
  }
  if (pin && /^\d{4,6}$/.test(String(pin))) {
    u.pinHash = await hashPin(String(pin));
  }
  if (preferredLanguage !== undefined) {
    u.preferredLanguage = normalizeLanguage(preferredLanguage);
  }
  await u.save();
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master');
  if (tenantId.toLowerCase() !== 'master' && typeof active === 'boolean' && active === false) {
    try {
      const master = await getMasterConnection();
      const TenantSession = TenantSessionModelFor(master);
      await TenantSession.deleteMany({ tenantId, userName: String(u.name || '') });
    } catch {}
  }
  const changed = [];
  const payload = { name: newName, role, branchId, assignedBranches, preferredLanguage, active };
  Object.keys(payload).forEach(k => {
    if (payload[k] !== undefined) changed.push(k);
  });
  res.json({
    id: String(u._id),
    name: u.name,
    role: u.role,
    branchId: u.branchId || 'main',
    assignedBranches: u.assignedBranches,
    preferredLanguage: normalizeLanguage(u.preferredLanguage),
    active: u.active !== false
  });
  void Audit.create({
    actor: (req.user && req.user.name) || 'unknown',
    actionType: 'user_update',
    details: { id: String(u._id), name: u.name, changedKeys: changed },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: (req.user && req.user.name) || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'PUT',
    status: 200,
    message: `User updated: ${u.name}`,
    details: { changedKeys: changed }
  }).catch(() => {});
});

r.delete('/:name', requireAdmin, async (req, res) => {
  const User = UserModelFor(req.db);
  const Audit = AuditModelFor(req.db);
  const name = req.params.name;
  const u = await User.findOne({ name });
  if (!u) return res.json({ ok: true });
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master');
  if (tenantId.toLowerCase() !== 'master') {
    try {
      const master = await getMasterConnection();
      const TenantSession = TenantSessionModelFor(master);
      await TenantSession.deleteMany({ tenantId, userName: String(u.name || '') });
    } catch {}
  }
  await User.deleteOne({ _id: u._id });
  res.json({ ok: true });
  void Audit.create({
    actor: (req.user && req.user.name) || 'unknown',
    actionType: 'user_delete',
    details: { id: String(u._id), name: u.name },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: (req.user && req.user.name) || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'DELETE',
    status: 200,
    message: `User deleted: ${u.name}`
  }).catch(() => {});
});

export default r;
