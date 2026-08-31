import jwt from 'jsonwebtoken';
import Settings from '../models/Settings.js';
import { filterGrantsByFeatureFlags } from '../config/tenantAccess.js';

function isMasterSuperAdmin(user = {}, tenantId = '') {
  const role = String(user?.role || '').toLowerCase();
  const resolvedTenantId = String(tenantId || user?.tenantId || '').toLowerCase();
  return role === 'superadmin' && (!resolvedTenantId || resolvedTenantId === 'master');
}

function normalizeTenantScopedRole(rawRole, tenantId = '') {
  const role = String(rawRole || '').trim();
  const resolvedTenantId = String(tenantId || '').trim().toLowerCase();
  if (role.toLowerCase() === 'superadmin' && resolvedTenantId && resolvedTenantId !== 'master') return 'Admin';
  return role;
}

export function parseAuth(req, _res, next) {
  const auth = req.header('authorization') || req.header('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    try {
      const secret = process.env.JWT_SECRET || '';
      const decoded = jwt.verify(m[1], secret);
      const tenantId = String(decoded?.tenantId || req.tenantId || '').trim();
      req.user = decoded
        ? {
            ...decoded,
            role: normalizeTenantScopedRole(decoded.role, tenantId)
          }
        : null;
    } catch {
      req.user = null;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user && req.user.name) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

export function requireAdmin(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'admin' || isMasterSuperAdmin(req.user, req.tenantId)) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

export function requireSuperAdmin(req, res, next) {
  const tenantId = String(req.user?.tenantId || req.tenantId || '').toLowerCase();
  if (isMasterSuperAdmin(req.user, tenantId)) return next();
  return res.status(403).json({ error: 'SuperAdmin only' });
}

export function requireRole(roles = []) {
  const set = new Set((roles || []).map(r => String(r || '').toLowerCase()));
  return (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (isMasterSuperAdmin(req.user, req.tenantId)) return next();
    if (set.has(role)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

export function requireRoleOrPerm(roles = [], perm = '') {
  const set = new Set((roles || []).map(r => String(r || '').toLowerCase()));
  const perms = (Array.isArray(perm) ? perm : [perm]).map(p => String(p || '').trim()).filter(Boolean);
  return async (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (isMasterSuperAdmin(req.user, req.tenantId)) return next();
    if (perms.length === 0 && set.has(role)) return next();
    if (perms.length > 0 && role === 'admin' && set.has(role)) return next();
    const grants = Array.isArray(req.user?.grants) ? req.user.grants : [];
    if (perms.length > 0 && perms.some(p => grants.includes(p))) return next();
    if (perms.length > 0) {
      try {
        const doc = await Settings.findOne({ key: 'default' });
        const map = doc?.data?.userGrants || {};
        const arr = map?.[req.user?.name];
        const filtered = Array.isArray(arr) ? filterGrantsByFeatureFlags(arr, doc?.data?.featureFlags || {}) : [];
        if (perms.some(p => filtered.includes(p))) return next();
      } catch {}
    }
    return res.status(403).json({ error: 'Forbidden' });
  };
}

export function requireFeature(featureKey = '') {
  const key = String(featureKey || '').trim();
  return async (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    const tenantId = String(req.user?.tenantId || req.tenantId || '').toLowerCase();
    if (role === 'superadmin' && (!tenantId || tenantId === 'master')) return next();
    if (!key) return next();
    try {
      const doc = await Settings.findOne({ key: 'default' });
      const flags = doc?.data?.featureFlags || {};
      if (flags[key] === false) return res.status(403).json({ error: 'Feature not enabled for this tenant' });
    } catch {}
    return next();
  };
}
