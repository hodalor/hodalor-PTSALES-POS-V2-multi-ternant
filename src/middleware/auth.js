import jwt from 'jsonwebtoken';
import Settings from '../models/Settings.js';
import { filterGrantsByFeatureFlags } from '../config/tenantAccess.js';

export function parseAuth(req, _res, next) {
  const auth = req.header('authorization') || req.header('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    try {
      const secret = process.env.JWT_SECRET || '';
      const decoded = jwt.verify(m[1], secret);
      req.user = decoded || null;
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
  if (role === 'admin' || role === 'superadmin') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

export function requireSuperAdmin(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  const tenantId = String(req.user?.tenantId || req.tenantId || '').toLowerCase();
  if (role === 'superadmin' && (!tenantId || tenantId === 'master')) return next();
  return res.status(403).json({ error: 'SuperAdmin only' });
}

export function requireRole(roles = []) {
  const set = new Set((roles || []).map(r => String(r || '').toLowerCase()));
  return (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'superadmin') return next();
    if (set.has(role)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  };
}

export function requireRoleOrPerm(roles = [], perm = '') {
  const set = new Set((roles || []).map(r => String(r || '').toLowerCase()));
  const p = String(perm || '');
  return async (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (role === 'superadmin') return next();
    if (!p && set.has(role)) return next();
    if (p && role === 'admin' && set.has(role)) return next();
    const grants = Array.isArray(req.user?.grants) ? req.user.grants : [];
    if (p && grants.includes(p)) return next();
    if (p) {
      try {
        const doc = await Settings.findOne({ key: 'default' });
        const map = doc?.data?.userGrants || {};
        const arr = map?.[req.user?.name];
        if (Array.isArray(arr) && filterGrantsByFeatureFlags(arr, doc?.data?.featureFlags || {}).includes(p)) return next();
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
