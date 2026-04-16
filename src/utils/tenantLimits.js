import { modelFor as SettingsModelFor } from '../models/Settings.js';
import { modelFor as TenantSessionModelFor } from '../models/TenantSession.js';

export const EMPTY_LIMITS = {
  basic: { maxUserAccounts: null, maxActiveUsers: null },
  pro: { maxUserAccounts: null, maxActiveUsers: null },
  enterprise: { maxUserAccounts: null, maxActiveUsers: null }
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
    maxActiveUsers: normalizeLimitValue(input.maxActiveUsers)
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
  return {
    maxUserAccounts: normalizeLimitValue(tenant?.maxUserAccountsOverride ?? planDefaults.maxUserAccounts),
    maxActiveUsers: normalizeLimitValue(tenant?.maxActiveUsersOverride ?? planDefaults.maxActiveUsers)
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
