import { Router } from 'express';
import mongoose from 'mongoose';
import Supplier from '../models/Supplier.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireAdmin, requireRole, requireRoleOrPerm } from '../middleware/auth.js';

const r = Router();

r.use(requireAuth);

r.get('/', async (req, res) => {
  const rows = await Supplier.find().sort({ name: 1 });
  res.json(rows);
});

r.post('/', requireRoleOrPerm(['Admin','Manager'], 'add_suppliers'), async (req, res) => {
  const payload = req.body || {};
  const clientId = String(payload.clientId || '').trim();
  if (clientId) {
    const existing = await Supplier.findOne({ clientId });
    if (existing) return res.json(existing);
  }
  const s = await Supplier.create(payload);
  res.json(s);
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'supplier_create',
    details: { name: s.name, contact: s.contact || '', phone: s.phone || '', email: s.email || '' },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'POST',
    status: 200,
    message: `Supplier created: ${s.name}`
  }).catch(() => {});
});

r.put('/:id', requireRoleOrPerm(['Admin','Manager'], 'edit_suppliers'), async (req, res) => {
  const id = req.params.id;
  const query = { $or: [{ clientId: id }] };
  if (mongoose.isValidObjectId(id)) query.$or.unshift({ _id: id });
  const before = await Supplier.findOne(query);
  const s = await Supplier.findOneAndUpdate(query, req.body, { new: true });
  const changed = [];
  const payload = req.body || {};
  Object.keys(payload).forEach(k => {
    try {
      const a = before ? JSON.stringify(before[k]) : undefined;
      const b = JSON.stringify(payload[k]);
      if (a !== b) changed.push(k);
    } catch {
      changed.push(k);
    }
  });
  res.json(s);
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'supplier_update',
    details: { id, name: s?.name || before?.name || '', changedKeys: changed },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'PUT',
    status: 200,
    message: `Supplier updated: ${s?.name || id}`,
    details: { changedKeys: changed }
  }).catch(() => {});
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const query = { $or: [{ clientId: id }] };
  if (mongoose.isValidObjectId(id)) query.$or.unshift({ _id: id });
  const doc = await Supplier.findOne(query);
  await Supplier.findOneAndDelete(query);
  res.json({ ok: true });
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'supplier_delete',
    details: { id, name: doc?.name || '' },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'DELETE',
    status: 200,
    message: `Supplier deleted: ${doc?.name || id}`
  }).catch(() => {});
});

export default r;
