import { Router } from 'express';
import mongoose from 'mongoose';
import Branch from '../models/Branch.js';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAdmin } from '../middleware/auth.js';

const r = Router();

function inventoryFieldForBranchType(branchType = 'retail') {
  const kind = String(branchType || 'retail').toLowerCase();
  if (kind === 'warehouse') return 'warehouseStockByBranch';
  if (kind === 'wholesale') return 'wholesaleStockByBranch';
  return 'stockByBranch';
}

async function provisionBranchProducts(branch) {
  if (!branch?.id) return;
  const field = inventoryFieldForBranchType(branch.branchType);
  await Product.updateMany(
    {},
    {
      $set: {
        [`${field}.${branch.id}`]: 0,
        [`variants.$[].${field}.${branch.id}`]: 0
      }
    }
  );
}

async function removeBranchProducts(branch) {
  if (!branch?.id) return;
  const fields = ['stockByBranch', 'wholesaleStockByBranch', 'warehouseStockByBranch'];
  const unset = {};
  fields.forEach(field => {
    unset[`${field}.${branch.id}`] = 1;
    unset[`variants.$[].${field}.${branch.id}`] = 1;
  });
  await Product.updateMany({}, { $unset: unset });
}

r.get('/', async (req, res) => {
  const items = await Branch.find().sort({ name: 1 });
  res.json(items);
});

r.post('/', requireAdmin, async (req, res) => {
  const b = await Branch.create(req.body);
  res.json(b);
  void provisionBranchProducts(b).catch(() => {});
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'branch_create',
    details: { id: b.id || String(b._id), name: b.name, code: b.code },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'POST',
    status: 200,
    message: `Branch created: ${b.name} (${b.code || ''})`
  }).catch(() => {});
});

r.put('/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const query = { $or: [{ _id: id }, { id }] };
  const before = await Branch.findOne(query);
  const b = await Branch.findOneAndUpdate(query, req.body, { new: true });
  if (b) await provisionBranchProducts(b);
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'branch_update',
    details: { id, before: before ? { name: before.name, code: before.code } : null, after: b ? { name: b.name, code: b.code } : null },
    branchId: req.user?.branchId || ''
  });
  await ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'PUT',
    status: 200,
    message: `Branch updated: ${b ? b.name : id}`
  });
  res.json(b);
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const query = { $or: [{ id }] };
  if (mongoose.isValidObjectId(id)) query.$or.unshift({ _id: id });
  const b = await Branch.findOne(query);
  await Branch.findOneAndDelete(query);
  res.json({ ok: true });
  void removeBranchProducts(b).catch(() => {});
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'branch_delete',
    details: b ? { id, name: b.name, code: b.code } : { id },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'DELETE',
    status: 200,
    message: `Branch deleted: ${b ? b.name : id}`
  }).catch(() => {});
});

export default r;
