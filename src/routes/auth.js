import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { verifyPin } from '../utils/pin.js';
import { requireAuth } from '../middleware/auth.js';
import Settings from '../models/Settings.js';
import Tenant from '../models/Tenant.js';
import { filterGrantsByFeatureFlags } from '../config/tenantAccess.js';

const r = Router();

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
  const loginTenantId = String(tenantId || req.tenantId || 'master').trim() || 'master';
  if (!username || !/^\d{4,6}$/.test(String(pin || '')) || !loginTenantId) return res.status(400).json({ error: 'Invalid input' });
  if (String(loginTenantId).toLowerCase() !== 'master') {
    const meta = await Tenant.findOne({ tenantId: loginTenantId });
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

r.get('/me', requireAuth, async (req, res) => {
  const u = req.user || {};
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
