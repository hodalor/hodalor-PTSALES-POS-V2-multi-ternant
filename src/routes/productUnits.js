import { Router } from 'express';
import ProductUnit from '../models/ProductUnit.js';
import Audit from '../models/Audit.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { createSerializedUnits, listSerializedUnits, releaseSerializedUnits, reserveSerializedUnit, resolveInventoryTypeFromBranch, transferSerializedUnits } from '../utils/productUnits.js';
import mongoose from 'mongoose';

const r = Router();

r.use(requireAuth);

r.get('/', async (req, res) => {
  const result = await listSerializedUnits({
    productId: req.query.productId || '',
    variantId: req.query.variantId || '',
    branchId: req.query.branchId || '',
    inventoryType: req.query.inventoryType || '',
    status: req.query.status || '',
    reservationToken: req.query.reservationToken || '',
    query: req.query.query || '',
    page: Number(req.query.page || 1),
    pageSize: Math.min(100, Math.max(1, Number(req.query.pageSize || 30)))
  });
  res.json(result);
});

r.post('/bulk-create', requireRoleOrPerm(['Admin', 'Manager', 'Inventory Staff'], 'add_purchases'), async (req, res) => {
  const payload = req.body || {};
  const branchId = String(payload.branchId || '');
  if (!branchId) return res.status(400).json({ error: 'Missing branchId' });
  const inventoryType = payload.inventoryType ? String(payload.inventoryType) : await resolveInventoryTypeFromBranch(branchId, 'retail');
  try {
    const result = await createSerializedUnits({
      productId: payload.productId,
      variantId: payload.variantId || '',
      branchId,
      inventoryType,
      entries: Array.isArray(payload.entries) ? payload.entries : []
    });
    await Audit.create({
      actor: req.user?.name || 'unknown',
      actionType: 'serialized_units_create',
      details: { productId: payload.productId, variantId: payload.variantId || '', count: result.created.length, branchId, inventoryType },
      branchId
    });
    res.json({ count: result.created.length, rows: result.created });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || 'Failed to create serialized units' });
  }
});

r.post('/reserve', requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], 'add_sales'), async (req, res) => {
  const payload = req.body || {};
  try {
    const inventoryType = payload.inventoryType ? String(payload.inventoryType) : await resolveInventoryTypeFromBranch(payload.branchId, 'retail');
    const row = await reserveSerializedUnit({
      code: payload.code || '',
      unitId: payload.unitId || '',
      productId: payload.productId || '',
      variantId: payload.variantId || '',
      branchId: payload.branchId,
      inventoryType,
      reservationToken: payload.reservationToken
    });
    res.json(row);
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || 'Failed to reserve serialized unit' });
  }
});

r.post('/scan-imei', requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], 'add_sales'), async (req, res) => {
  const payload = req.body || {};
  const code = String(payload.imei || payload.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Missing IMEI or serial number' });
  try {
    const inventoryType = payload.inventoryType ? String(payload.inventoryType) : await resolveInventoryTypeFromBranch(payload.branchId, 'retail');
    const row = await reserveSerializedUnit({
      code,
      productId: payload.productId || '',
      variantId: payload.variantId || '',
      branchId: payload.branchId,
      inventoryType,
      reservationToken: payload.reservationToken
    });
    res.json(row);
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || 'Failed to scan IMEI' });
  }
});

r.post('/release', requireRoleOrPerm(['Admin', 'Manager', 'Cashier', 'Inventory Staff'], 'add_sales'), async (req, res) => {
  try {
    const rows = await releaseSerializedUnits({
      unitIds: Array.isArray(req.body?.unitIds) ? req.body.unitIds : [],
      reservationToken: req.body?.reservationToken || ''
    });
    res.json({ count: rows.length });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || 'Failed to release serialized units' });
  }
});

r.post('/transfer', requireRoleOrPerm(['Admin', 'Manager', 'Inventory Staff'], 'approve_transfers'), async (req, res) => {
  try {
    const rows = await transferSerializedUnits({
      productId: req.body?.productId,
      variantId: req.body?.variantId || '',
      fromBranchId: req.body?.fromBranchId,
      toBranchId: req.body?.toBranchId,
      fromInventoryType: req.body?.fromInventoryType || 'retail',
      toInventoryType: req.body?.toInventoryType || 'retail',
      unitIds: Array.isArray(req.body?.unitIds) ? req.body.unitIds.map(String) : []
    });
    res.json({ count: rows.length, rows });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || 'Failed to transfer serialized units' });
  }
});

r.get('/lookup/:code', async (req, res) => {
  const code = String(req.params.code || '');
  const row = await ProductUnit.findOne({
    $or: [{ imei: code }, { serialNumber: code }]
  });
  if (!row) return res.status(404).json({ error: 'Serialized unit not found' });
  res.json(row);
});

r.post('/bulk-delete', async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, count: 0 });
  const objectIds = ids.filter(id => mongoose.isValidObjectId(id));
  const result = await ProductUnit.deleteMany({ _id: { $in: objectIds } });
  res.json({ ok: true, count: Number(result?.deletedCount || 0) });
});

export default r;
