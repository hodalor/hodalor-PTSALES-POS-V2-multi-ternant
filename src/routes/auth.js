import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { verifyPin } from '../utils/pin.js';
import { requireAuth } from '../middleware/auth.js';
import Settings from '../models/Settings.js';

const r = Router();

function toLanding(role) {
  const rl = String(role || '');
  if (rl === 'SuperAdmin' || rl === 'Admin' || rl === 'Manager') return '/dashboard';
  if (rl === 'Inventory Staff') return '/inventory';
  if (rl === 'Auditor') return '/reports';
  return '/pos';
}

r.post('/login', async (req, res) => {
  const { username, pin } = req.body || {};
  if (!username || !/^\d{4,6}$/.test(String(pin || ''))) return res.status(400).json({ error: 'Invalid input' });
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
    if (Array.isArray(arr)) grants = arr;
  } catch {}
  const payload = {
    sub: String(u._id),
    name: u.name,
    role: u.role,
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
    user: { name: u.name, branchId: u.branchId || 'main', assignedBranches: u.assignedBranches || (u.branchId ? [u.branchId] : []) }
  });
});

export default r;

r.get('/me', requireAuth, async (req, res) => {
  const u = req.user || {};
  res.json({
    role: u.role || null,
    grants: Array.isArray(u.grants) ? u.grants : [],
    user: { name: u.name, branchId: u.branchId || 'main', assignedBranches: u.assignedBranches || (u.branchId ? [u.branchId] : []) }
  });
});
