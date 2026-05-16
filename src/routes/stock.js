import { Router } from 'express';
import Branch from '../models/Branch.js';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import TransferRequest from '../models/TransferRequest.js';
import AdjustmentRequest from '../models/AdjustmentRequest.js';
import WholesaleOperation from '../models/WholesaleOperation.js';
import Sale from '../models/Sale.js';
import RefundRequest from '../models/RefundRequest.js';
import { requireAuth, requireFeature, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';
import { normalizeTrackType, resolveInventoryTypeFromBranch } from '../utils/productUnits.js';
import { getMapQty, getStockTarget, markInventoryModified, setMapQty } from '../utils/inventory.js';
import { buildInventoryConsistencyReport } from '../utils/inventoryConsistency.js';
import { makeInventoryLine, withInventoryAudit } from '../utils/inventoryAudit.js';
import { safeErrorMessage, safeErrorStatus } from '../utils/safeError.js';

const r = Router();

r.use(requireAuth);

function productLookupQuery(productId) {
  const pid = String(productId || '');
  const or = [{ id: pid }];
  if (mongoose.isValidObjectId(pid)) or.unshift({ _id: pid });
  return { $or: or };
}

function getBranchQty(mapLike, branchId) {
  if (!mapLike) return 0;
  if (typeof mapLike.get === 'function') return Number(mapLike.get(branchId) || 0);
  return Number(mapLike[branchId] || 0);
}
function setBranchQty(mapLike, branchId, qty) {
  if (!mapLike) return;
  if (typeof mapLike.set === 'function') {
    mapLike.set(branchId, qty);
  } else {
    mapLike[branchId] = qty;
  }
}

async function adjustBaseStock(productId, branchId, delta, inventoryType = 'retail') {
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  const target = getStockTarget(p, '', inventoryType);
  if (!target) {
    const err = new Error('Product stock target not found');
    err.status = 400;
    throw err;
  }
  const cur = getMapQty(target.container, branchId);
  const next = cur + Number(delta);
  if (next < 0) {
    const err = new Error('Insufficient stock');
    err.status = 400;
    throw err;
  }
  setMapQty(target.container, branchId, next);
  markInventoryModified(target);
  await p.save();
  return p;
}

async function findProduct(productId) {
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  return p;
}

async function assertNonSerializedStockMutation(productId) {
  const p = await findProduct(productId);
  if (normalizeTrackType(p.trackType) === 'serialized') {
    const err = new Error('Serialized products cannot be changed by manual stock quantity endpoints. Use IMEI or serial unit actions instead.');
    err.status = 400;
    throw err;
  }
  return p;
}

 async function adjustVariantStock(productId, variantId, branchId, delta, inventoryType = 'retail') {
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  const target = getStockTarget(p, variantId, inventoryType);
  if (!target) {
    const err = new Error('Variant not found');
    err.status = 400;
    throw err;
  }
  const cur = getMapQty(target.container, branchId);
  const next = cur + Number(delta);
  if (next < 0) {
    const err = new Error('Insufficient stock');
    err.status = 400;
    throw err;
  }
  setMapQty(target.container, branchId, next);
  markInventoryModified(target);
  await p.save();
  return p;
}

r.post('/adjust', requireRoleOrPerm(['Admin','Manager','Inventory Staff'], 'add_adjustments'), async (req, res) => {
  const { productId, branchId, delta, actor, variantId, remark } = req.body || {};
  if (!productId || !branchId) return res.status(400).json({ error: 'Missing productId or branchId' });
  if (!Number.isFinite(Number(delta)) || Number(delta) === 0) return res.status(400).json({ error: 'Delta must be non-zero number' });
  let p;
  try {
    const inventoryType = await resolveInventoryTypeFromBranch(branchId, 'retail');
    await assertNonSerializedStockMutation(productId);
    if (variantId) {
      p = await adjustVariantStock(productId, variantId, branchId, delta, inventoryType);
    } else {
      p = await adjustBaseStock(productId, branchId, delta, inventoryType);
    }
  } catch (e) {
    return res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to adjust stock') });
  }
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === variantId)?.label : '') || '';
  const inventoryType = await resolveInventoryTypeFromBranch(branchId, 'retail');
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_adjust',
    details: withInventoryAudit(
      { product: p?.name || productId, variant: varLabel, delta: Number(delta), branchId, inventoryType },
      [makeInventoryLine({ productId, productName: p?.name || productId, variantId: variantId || '', variantLabel: varLabel, branchId, inventoryType, delta: Number(delta), remark: remark || '' })]
    ),
    remark: remark || '',
    branchId
  });
  await ServerLog.create({
    level: 'info',
    actor: actor || req.user?.name || 'unknown',
    route: '/api/stock/adjust',
    method: 'POST',
    status: 200,
    message: `Stock adjust ${Number(delta)} for ${p?.name || productId} @ ${branchId}${variantId ? ` (variant ${varLabel})` : ''}`
  });
  res.json({ ok: true });
});

r.post('/damage-remove', requireRoleOrPerm(['Admin','Manager','Inventory Staff'], 'add_adjustments'), async (req, res) => {
  const { productId, branchId, qty, actor, variantId, remark } = req.body || {};
  if (!productId || !branchId) return res.status(400).json({ error: 'Missing productId or branchId' });
  const q = Math.abs(Number(qty));
  if (!Number.isFinite(q) || q <= 0) return res.status(400).json({ error: 'Qty must be a positive number' });
  let p;
  try {
    const inventoryType = await resolveInventoryTypeFromBranch(branchId, 'retail');
    await assertNonSerializedStockMutation(productId);
    if (variantId) {
      p = await adjustVariantStock(productId, variantId, branchId, -q, inventoryType);
    } else {
      p = await adjustBaseStock(productId, branchId, -q, inventoryType);
    }
  } catch (e) {
    return res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to remove stock') });
  }
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === variantId)?.label : '') || '';
  const inventoryType = await resolveInventoryTypeFromBranch(branchId, 'retail');
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_damage_remove',
    details: withInventoryAudit(
      { product: p?.name || productId, variant: varLabel, qty: Math.abs(Number(qty)), branchId, inventoryType },
      [makeInventoryLine({ productId, productName: p?.name || productId, variantId: variantId || '', variantLabel: varLabel, branchId, inventoryType, delta: -Math.abs(Number(qty)), remark: remark || '' })]
    ),
    remark: remark || '',
    branchId
  });
  await ServerLog.create({
    level: 'info',
    actor: actor || req.user?.name || 'unknown',
    route: '/api/stock/damage-remove',
    method: 'POST',
    status: 200,
    message: `Stock damage-remove ${Math.abs(Number(qty))} for ${p?.name || productId} @ ${branchId}${variantId ? ` (variant ${varLabel})` : ''}`
  });
  res.json({ ok: true });
});

r.post('/receive', requireRoleOrPerm(['Admin','Manager','Inventory Staff'], 'add_purchases'), async (req, res) => {
  const { productId, branchId, baseUnits, actor, supplier, cost, costPerUnit, expiryDate, remark, variantId } = req.body || {};
  if (!productId || !branchId) return res.status(400).json({ error: 'Missing productId or branchId' });
  const u = Number(baseUnits);
  if (!Number.isFinite(u) || u <= 0) return res.status(400).json({ error: 'baseUnits must be a positive number' });
  let p;
  try {
    const inventoryType = await resolveInventoryTypeFromBranch(branchId, 'retail');
    await assertNonSerializedStockMutation(productId);
    if (variantId) {
      p = await adjustVariantStock(productId, variantId, branchId, u, inventoryType);
    } else {
      p = await adjustBaseStock(productId, branchId, u, inventoryType);
    }
  } catch (e) {
    return res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to receive stock') });
  }
  const cpu = costPerUnit != null ? Number(costPerUnit) : null;
  if (cpu != null && Number.isFinite(cpu) && cpu >= 0) {
    p.costPrice = cpu;
  }
  if (expiryDate) {
    const dt = new Date(expiryDate);
    if (!Number.isNaN(dt.getTime())) p.expiryDate = dt;
  }
  if (cpu != null || expiryDate) {
    await p.save();
  }
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === variantId)?.label : '') || '';
  const inventoryType = await resolveInventoryTypeFromBranch(branchId, 'retail');
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_receive',
    details: withInventoryAudit(
      { product: p?.name || productId, variant: varLabel, baseUnits: Number(baseUnits), supplier: supplier || '', cost: Number(cost) || 0, costPerUnit: cpu != null ? cpu : 0, expiryDate: expiryDate || null, branchId, inventoryType },
      [makeInventoryLine({ productId, productName: p?.name || productId, variantId: variantId || '', variantLabel: varLabel, branchId, inventoryType, delta: Number(baseUnits), remark: remark || '' })]
    ),
    remark: remark || '',
    branchId
  });
  await ServerLog.create({
    level: 'info',
    actor: actor || req.user?.name || 'unknown',
    route: '/api/stock/receive',
    method: 'POST',
    status: 200,
    message: `Stock receive +${Number(baseUnits)} for ${p?.name || productId} @ ${branchId}${variantId ? ` (variant ${varLabel})` : ''}`
  });
  res.json({ ok: true });
});

r.post('/transfer', requireRoleOrPerm(['Admin','Manager','Inventory Staff'], 'add_transfers'), async (req, res) => {
  const { productId, from, to, qty, actor, remark, variantId } = req.body || {};
  if (!productId || !from || !to) return res.status(400).json({ error: 'Missing productId, from, or to' });
  if (from === to) return res.status(400).json({ error: 'From and To must be different branches' });
  const q = Math.abs(Number(qty));
  if (!Number.isFinite(q) || q <= 0) return res.status(400).json({ error: 'Qty must be a positive number' });
  let p;
  try {
    const fromInventoryType = await resolveInventoryTypeFromBranch(from, 'retail');
    const toInventoryType = await resolveInventoryTypeFromBranch(to, 'retail');
    await assertNonSerializedStockMutation(productId);
    if (variantId) {
      p = await adjustVariantStock(productId, variantId, from, -q, fromInventoryType);
      p = await adjustVariantStock(productId, variantId, to, q, toInventoryType);
    } else {
      await adjustBaseStock(productId, from, -q, fromInventoryType);
      p = await adjustBaseStock(productId, to, q, toInventoryType);
    }
  } catch (e) {
    return res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to transfer stock') });
  }
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === variantId)?.label : '') || '';
  const fromInventoryType = await resolveInventoryTypeFromBranch(from, 'retail');
  const toInventoryType = await resolveInventoryTypeFromBranch(to, 'retail');
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_transfer',
    details: withInventoryAudit(
      { product: p?.name || productId, variant: varLabel, from, to, qty: Math.abs(Number(qty)), fromInventoryType, toInventoryType },
      [
        makeInventoryLine({ productId, productName: p?.name || productId, variantId: variantId || '', variantLabel: varLabel, branchId: from, inventoryType: fromInventoryType, delta: -Math.abs(Number(qty)), remark: remark || '' }),
        makeInventoryLine({ productId, productName: p?.name || productId, variantId: variantId || '', variantLabel: varLabel, branchId: to, inventoryType: toInventoryType, delta: Math.abs(Number(qty)), remark: remark || '' })
      ]
    ),
    remark: remark || '',
    branchId: from
  });
  await ServerLog.create({
    level: 'info',
    actor: actor || req.user?.name || 'unknown',
    route: '/api/stock/transfer',
    method: 'POST',
    status: 200,
    message: `Stock transfer ${Math.abs(Number(qty))} ${from} -> ${to} for ${p?.name || productId}${variantId ? ` (variant ${varLabel})` : ''}`
  });
  res.json({ ok: true });
});

r.post('/set', requireRoleOrPerm(['Admin','Manager','Inventory Staff'], 'edit_inventory'), async (req, res) => {
  const { productId, branchId, quantity, actor, variantId, remark } = req.body || {};
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (normalizeTrackType(p.trackType) === 'serialized') {
    return res.status(400).json({ error: 'Serialized products cannot be set by manual stock quantity. Use IMEI or serial unit actions instead.' });
  }
  const inventoryType = await resolveInventoryTypeFromBranch(branchId, 'retail');
  let current = 0;
  if (variantId) {
    const target = getStockTarget(p, variantId, inventoryType);
    if (!target) return res.status(400).json({ error: 'Variant not found' });
    current = getMapQty(target.container, branchId);
  } else {
    const target = getStockTarget(p, '', inventoryType);
    if (!target) return res.status(400).json({ error: 'Product stock target not found' });
    current = getMapQty(target.container, branchId);
  }
  const next = Number(quantity);
  if (!Number.isFinite(next) || next < 0) return res.status(400).json({ error: 'Quantity must be a non-negative number' });
  const delta = next - current;
  try {
    if (variantId) {
      await adjustVariantStock(productId, variantId, branchId, delta, inventoryType);
    } else {
      await adjustBaseStock(productId, branchId, delta, inventoryType);
    }
  } catch (e) {
    return res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to set stock') });
  }
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === variantId)?.label : '') || '';
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_set_manual',
    details: withInventoryAudit(
      { product: p?.name || productId, variant: varLabel, quantity: Number(quantity), delta, branchId, inventoryType },
      [makeInventoryLine({ productId, productName: p?.name || productId, variantId: variantId || '', variantLabel: varLabel, branchId, inventoryType, delta, remark: remark || '' })]
    ),
    remark: remark || '',
    branchId
  });
  await ServerLog.create({
    level: 'info',
    actor: actor || req.user?.name || 'unknown',
    route: '/api/stock/set',
    method: 'POST',
    status: 200,
    message: `Stock set -> ${Number(quantity)} (Δ ${delta}) for ${p?.name || productId} @ ${branchId}${variantId ? ` (variant ${varLabel})` : ''}`
  });
  res.json({ ok: true });
});

r.get('/consistency-report', requireFeature('admin.inventoryConsistency'), requireRoleOrPerm(['Admin','Manager'], ['view_inventory_consistency', 'see_inventory_consistency', 'view_stock_records', 'see_stock_records', 'view_audit', 'see_audit']), async (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 200)));
  const mismatchOnly = String(req.query.mismatchOnly || 'true').toLowerCase() !== 'false';
  const [products, audits, branches, purchases, transfers, adjustments, wholesaleOperations, sales, refunds] = await Promise.all([
    Product.find({}).lean(),
    Audit.find({}).sort({ ts: -1 }).limit(20000).lean(),
    Branch.find({}).lean(),
    PurchaseRequest.find({ status: 'approved' }).lean(),
    TransferRequest.find({ status: 'approved' }).lean(),
    AdjustmentRequest.find({ status: 'approved' }).lean(),
    WholesaleOperation.find({ status: 'approved' }).lean(),
    Sale.find({}).lean(),
    RefundRequest.find({ approved_at: { $ne: null }, restockMode: { $ne: 'none' } }).lean()
  ]);
  const report = buildInventoryConsistencyReport({ products, audits, branches, purchases, transfers, adjustments, wholesaleOperations, sales, refunds, mismatchOnly, limit });
  res.json(report);
});

export default r;
