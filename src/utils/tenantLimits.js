import { modelFor as SettingsModelFor } from '../models/Settings.js';
import { modelFor as TenantSessionModelFor } from '../models/TenantSession.js';
import { modelFor as UserModelFor } from '../models/User.js';
import { modelFor as BranchModelFor } from '../models/Branch.js';

export const EMPTY_LIMITS = {
  basic: { maxUserAccounts: null, maxActiveUsers: null, maxBranches: null },
  pro: { maxUserAccounts: null, maxActiveUsers: null, maxBranches: null },
  enterprise: { maxUserAccounts: null, maxActiveUsers: null, maxBranches: null }
};

const LIMITS_KEY = 'tenantLimitsDefaults';
let defaultsCache = { ts: 0, value: EMPTY_LIMITS };
const DEFAULTS_TTL_MS = 30_000;

export function normalizeLimitValue(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function normalizePlanLimits(input = {}) {
  return {
    maxUserAccounts: normalizeLimitValue(input.maxUserAccounts),
    maxActiveUsers: normalizeLimitValue(input.maxActiveUsers),
    maxBranches: normalizeLimitValue(input.maxBranches)
  };
}

export function normalizeLimitDefaults(payload = {}) {
  return {
    basic: normalizePlanLimits(payload.basic || {}),
    pro: normalizePlanLimits(payload.pro || {}),
    enterprise: normalizePlanLimits(payload.enterprise || {})
  };
}

export async function getTenantLimitDefaults(masterConn) {
  if (Date.now() - defaultsCache.ts < DEFAULTS_TTL_MS) return defaultsCache.value;
  const Settings = SettingsModelFor(masterConn);
  const doc = await Settings.findOne({ key: LIMITS_KEY }).lean();
  const value = normalizeLimitDefaults(doc?.data || EMPTY_LIMITS);
  defaultsCache = { ts: Date.now(), value };
  return value;
}

export async function saveTenantLimitDefaults(masterConn, defaults) {
  const Settings = SettingsModelFor(masterConn);
  const normalized = normalizeLimitDefaults(defaults);
  const doc = await Settings.findOneAndUpdate(
    { key: LIMITS_KEY },
    { key: LIMITS_KEY, data: normalized },
    { upsert: true, new: true }
  ).lean();
  const value = normalizeLimitDefaults(doc?.data || normalized);
  defaultsCache = { ts: Date.now(), value };
  return value;
}

export function getEffectiveTenantLimits(tenant, defaults = EMPTY_LIMITS) {
  const plan = String(tenant?.subscriptionPlan || 'basic').toLowerCase();
  const planDefaults = defaults[plan] || defaults.basic || EMPTY_LIMITS.basic;
  const userBase = normalizeLimitValue(tenant?.maxUserAccountsOverride ?? planDefaults.maxUserAccounts);
  const branchBase = normalizeLimitValue(tenant?.maxBranchesOverride ?? planDefaults.maxBranches);
  const additionalUserSlots = Math.max(0, normalizeLimitValue(tenant?.additionalUserSlots) || 0);
  const additionalBranchSlots = Math.max(0, normalizeLimitValue(tenant?.additionalBranchSlots) || 0);
  return {
    maxUserAccounts: userBase == null ? null : userBase + additionalUserSlots,
    maxActiveUsers: normalizeLimitValue(tenant?.maxActiveUsersOverride ?? planDefaults.maxActiveUsers),
    maxBranches: branchBase == null ? null : branchBase + additionalBranchSlots
  };
}

export async function getTenantUsageSummary(masterConn, tenantConn, tenant, defaults = EMPTY_LIMITS) {
  const User = UserModelFor(tenantConn);
  const Branch = BranchModelFor(tenantConn);
  const [totalUsers, totalBranches, activeUsers] = await Promise.all([
    User.countDocuments(),
    Branch.countDocuments(),
    countActiveTenantSessions(masterConn, tenant?.tenantId || '', { skipCleanup: false })
  ]);
  const limits = getEffectiveTenantLimits(tenant, defaults);
  const remainingUsers = limits.maxUserAccounts == null ? null : Math.max(0, limits.maxUserAccounts - totalUsers);
  const remainingActiveUsers = limits.maxActiveUsers == null ? null : Math.max(0, limits.maxActiveUsers - activeUsers);
  const remainingBranches = limits.maxBranches == null ? null : Math.max(0, limits.maxBranches - totalBranches);
  return {
    limits,
    usage: {
      totalUsers,
      activeUsers,
      totalBranches,
      remainingUsers,
      remainingActiveUsers,
      remainingBranches
    }
  };
}

export async function cleanupExpiredTenantSessions(masterConn, tenantId) {
  const TenantSession = TenantSessionModelFor(masterConn);
  await TenantSession.deleteMany({
    tenantId: String(tenantId || ''),
    expiresAt: { $lte: new Date() }
  });
}

export async function getActiveUserNames(masterConn, tenantId) {
  const TenantSession = TenantSessionModelFor(masterConn);
  await cleanupExpiredTenantSessions(masterConn, tenantId);
  const rows = await TenantSession.distinct('userName', {
    tenantId: String(tenantId || ''),
    expiresAt: { $gt: new Date() }
  });
  return Array.isArray(rows) ? rows.map((x) => String(x || '')) : [];
}

export async function hasActiveTenantSession(masterConn, tenantId, userName, options = {}) {
  const TenantSession = TenantSessionModelFor(masterConn);
  if (!options.skipCleanup) await cleanupExpiredTenantSessions(masterConn, tenantId);
  const row = await TenantSession.findOne({
    tenantId: String(tenantId || ''),
    userName: String(userName || ''),
    expiresAt: { $gt: new Date() }
  }, { _id: 1 }).lean();
  return !!row;
}

export async function countActiveTenantSessions(masterConn, tenantId, options = {}) {
  const TenantSession = TenantSessionModelFor(masterConn);
  if (!options.skipCleanup) await cleanupExpiredTenantSessions(masterConn, tenantId);
  return TenantSession.countDocuments({
    tenantId: String(tenantId || ''),
    expiresAt: { $gt: new Date() }
  });
}
