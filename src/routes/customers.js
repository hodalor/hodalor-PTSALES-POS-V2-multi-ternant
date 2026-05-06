import { Router } from 'express';
import Customer from '../models/Customer.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireAdmin, requireRole, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';

const r = Router();

r.use(requireAuth);

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeCustomerCode() {
  const n = Math.floor(Math.random() * 1000000);
  return String(n).padStart(6, '0');
}

r.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limitRaw = Number(req.query.limit || 1000);
  const limit = Math.max(1, Math.min(2000, Number.isFinite(limitRaw) ? limitRaw : 1000));
  const query = {};
  if (q) {
    const re = new RegExp(escapeRegExp(q), 'i');
    query.$or = [
      { customerCode: re },
      { name: re },
      { phone: re },
      { businessPhone: re },
      { email: re },
      { idCardNumber: re },
      { businessName: re },
      { businessAddress: re }
    ];
  }
  const rows = await Customer.find(query).sort({ createdAt: -1 }).limit(limit);
  res.json(rows);
});

r.post('/', requireRoleOrPerm(['Admin','Manager','Cashier'], 'add_customers'), async (req, res) => {
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const clientId = String(payload.clientId || '').trim();
  if (clientId) {
    const existing = await Customer.findOne({ clientId });
    if (existing) return res.json(existing);
  }
  const doc = {
    clientId: clientId || undefined,
    customerCode: String(payload.customerCode || '').trim() || null,
    name,
    phone: String(payload.phone || '').trim() || '',
    email: String(payload.email || '').trim() || '',
    customerType: String(payload.customerType || 'retail').trim().toLowerCase() === 'distribution' ? 'distribution' : 'retail',
    dob: payload.dob ? new Date(payload.dob) : undefined,
    idType: String(payload.idType || '').trim() || '',
    idCardNumber: String(payload.idCardNumber || '').trim() || '',
    idFront: String(payload.idFront || '').trim() || '',
    idBack: String(payload.idBack || '').trim() || '',
    businessCertificate: String(payload.businessCertificate || '').trim() || '',
    address: String(payload.address || '').trim() || '',
    businessName: String(payload.businessName || '').trim() || '',
    businessAddress: String(payload.businessAddress || '').trim() || '',
    registrationNumber: String(payload.registrationNumber || '').trim() || '',
    taxId: String(payload.taxId || '').trim() || '',
    businessPhone: String(payload.businessPhone || '').trim() || '',
    businessEmail: String(payload.businessEmail || '').trim() || '',
    photo: String(payload.photo || '').trim() || '',
    vip: Boolean(payload.vip),
    anniversaryDate: payload.anniversaryDate ? new Date(payload.anniversaryDate) : undefined
  };
  if (doc.dob && Number.isNaN(doc.dob.getTime())) doc.dob = undefined;
  if (doc.anniversaryDate && Number.isNaN(doc.anniversaryDate.getTime())) doc.anniversaryDate = undefined;
  let c = null;
  for (let i = 0; i < 15; i++) {
    const next = { ...doc };
    if (!next.customerCode) next.customerCode = makeCustomerCode();
    try {
      c = await Customer.create(next);
      break;
    } catch (e) {
      if (e && e.code === 11000) {
        doc.customerCode = null;
        continue;
      }
      throw e;
    }
  }
  if (!c) return res.status(500).json({ error: 'Failed to generate customer id' });
  res.json(c);
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'customer_create',
    details: { customerCode: c.customerCode || '', name: c.name, phone: c.phone || '', email: c.email || '' },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'POST',
    status: 200,
    message: `Customer created: ${c.name}`
  }).catch(() => {});
});

r.put('/:id', requireRoleOrPerm(['Admin','Manager','Cashier'], 'edit_customers'), async (req, res) => {
  const id = String(req.params.id || '');
  const or = [];
  if (mongoose.isValidObjectId(id)) or.push({ _id: id });
  or.push({ clientId: id });
  const before = await Customer.findOne({ $or: or });
  if (!before) return res.status(404).json({ error: 'Not found' });
  const payload = req.body || {};
  const patch = {
    name: payload.name != null ? String(payload.name || '').trim() : undefined,
    phone: payload.phone != null ? String(payload.phone || '').trim() : undefined,
    email: payload.email != null ? String(payload.email || '').trim() : undefined,
    customerType: payload.customerType != null ? (String(payload.customerType || 'retail').trim().toLowerCase() === 'distribution' ? 'distribution' : 'retail') : undefined,
    dob: payload.dob != null ? (payload.dob ? new Date(payload.dob) : null) : undefined,
    idType: payload.idType != null ? String(payload.idType || '').trim() : undefined,
    idCardNumber: payload.idCardNumber != null ? String(payload.idCardNumber || '').trim() : undefined,
    idFront: payload.idFront != null ? String(payload.idFront || '').trim() : undefined,
    idBack: payload.idBack != null ? String(payload.idBack || '').trim() : undefined,
    businessCertificate: payload.businessCertificate != null ? String(payload.businessCertificate || '').trim() : undefined,
    address: payload.address != null ? String(payload.address || '').trim() : undefined,
    businessName: payload.businessName != null ? String(payload.businessName || '').trim() : undefined,
    businessAddress: payload.businessAddress != null ? String(payload.businessAddress || '').trim() : undefined,
    registrationNumber: payload.registrationNumber != null ? String(payload.registrationNumber || '').trim() : undefined,
    taxId: payload.taxId != null ? String(payload.taxId || '').trim() : undefined,
    businessPhone: payload.businessPhone != null ? String(payload.businessPhone || '').trim() : undefined,
    businessEmail: payload.businessEmail != null ? String(payload.businessEmail || '').trim() : undefined,
    photo: payload.photo != null ? String(payload.photo || '').trim() : undefined,
    vip: payload.vip != null ? Boolean(payload.vip) : undefined,
    anniversaryDate: payload.anniversaryDate != null ? (payload.anniversaryDate ? new Date(payload.anniversaryDate) : null) : undefined
  };
  if (patch.name === '') return res.status(400).json({ error: 'Name is required' });
  if (patch.dob && Number.isNaN(patch.dob.getTime())) patch.dob = null;
  if (patch.anniversaryDate && Number.isNaN(patch.anniversaryDate.getTime())) patch.anniversaryDate = null;
  Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
  const c = await Customer.findOneAndUpdate({ $or: or }, patch, { new: true });
  const changed = [];
  Object.keys(payload).forEach(k => {
    try {
      const a = JSON.stringify(before[k]);
      const b = JSON.stringify(payload[k]);
      if (a !== b) changed.push(k);
    } catch {
      changed.push(k);
    }
  });
  res.json(c);
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'customer_update',
    details: { id, name: c?.name || before?.name || '', changedKeys: changed },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'PUT',
    status: 200,
    message: `Customer updated: ${c?.name || id}`,
    details: { changedKeys: changed }
  }).catch(() => {});
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id || '');
  const or = [];
  if (mongoose.isValidObjectId(id)) or.push({ _id: id });
  or.push({ clientId: id });
  const doc = await Customer.findOne({ $or: or });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  await Customer.findOneAndDelete({ $or: or });
  res.json({ ok: true });
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'customer_delete',
    details: { id, customerCode: doc?.customerCode || '', name: doc?.name || '' },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'DELETE',
    status: 200,
    message: `Customer deleted: ${doc?.name || id}`
  }).catch(() => {});
});

r.post('/bulk-delete', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, count: 0 });
  const objectIds = ids.filter(id => mongoose.isValidObjectId(id));
  const query = {
    $or: [
      { clientId: { $in: ids } },
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : [])
    ]
  };
  const rows = await Customer.find(query, { _id: 1, customerCode: 1, name: 1 }).lean();
  const result = await Customer.deleteMany(query);
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'customer_bulk_delete',
    details: { count: Number(result?.deletedCount || 0), ids, names: rows.map(r => r.name).filter(Boolean).slice(0, 50) },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'POST',
    status: 200,
    message: `Customers bulk deleted: ${Number(result?.deletedCount || 0)}`
  }).catch(() => {});
  res.json({ ok: true, count: Number(result?.deletedCount || 0) });
});

export default r;
