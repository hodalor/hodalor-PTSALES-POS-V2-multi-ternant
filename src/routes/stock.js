import { Router } from 'express';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';
import { normalizeTrackType } from '../utils/productUnits.js';

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

async function adjustBaseStock(productId, branchId, delta) {
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  if (!p.stockByBranch) p.stockByBranch = new Map();
  const cur = getBranchQty(p.stockByBranch, branchId);
  setBranchQty(p.stockByBranch, branchId, Math.max(0, cur + Number(delta)));
  p.markModified('stockByBranch');
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

 async function adjustVariantStock(productId, variantId, branchId, delta) {
  const p = await Product.findOne(productLookupQuery(productId));
  if (!p) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const idx = variants.findIndex(v => v.id === variantId);
  if (idx < 0) {
    const err = new Error('Variant not found');
    err.status = 400;
    throw err;
  }
  const v = variants[idx];
  if (!v.stockByBranch) v.stockByBranch = new Map();
  const cur = getBranchQty(v.stockByBranch, branchId);
  setBranchQty(v.stockByBranch, branchId, Math.max(0, cur + Number(delta)));
  p.variants[idx] = v;
  p.markModified('variants');
  await p.save();
  return p;
}

r.post('/adjust', requireRoleOrPerm(['Admin','Manager','Inventory Staff'], 'add_adjustments'), async (req, res) => {
  const { productId, branchId, delta, actor, variantId, remark } = req.body || {};
  if (!productId || !branchId) return res.status(400).json({ error: 'Missing productId or branchId' });
  if (!Number.isFinite(Number(delta)) || Number(delta) === 0) return res.status(400).json({ error: 'Delta must be non-zero number' });
  let p;
  try {
    await assertNonSerializedStockMutation(productId);
    if (variantId) {
      p = await adjustVariantStock(productId, variantId, branchId, delta);
    } else {
      p = await adjustBaseStock(productId, branchId, delta);
    }
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || 'Failed to adjust stock' });
  }
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === variantId)?.label : '') || '';
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_adjust',
    details: { product: p?.name || productId, variant: varLabel, delta: Number(delta), branchId },
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
    await assertNonSerializedStockMutation(productId);
    if (variantId) {
      p = await adjustVariantStock(productId, variantId, branchId, -q);
    } else {
      p = await adjustBaseStock(productId, branchId, -q);
    }
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || 'Failed to remove stock' });
  }
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === variantId)?.label : '') || '';
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_damage_remove',
    details: { product: p?.name || productId, variant: varLabel, qty: Math.abs(Number(qty)), branchId },
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
    await assertNonSerializedStockMutation(productId);
    if (variantId) {
      p = await adjustVariantStock(productId, variantId, branchId, u);
    } else {
      p = await adjustBaseStock(productId, branchId, u);
    }
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || 'Failed to receive stock' });
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
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_receive',
    details: { product: p?.name || productId, variant: varLabel, baseUnits: Number(baseUnits), supplier: supplier || '', cost: Number(cost) || 0, costPerUnit: cpu != null ? cpu : 0, expiryDate: expiryDate || null, branchId },
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
    await assertNonSerializedStockMutation(productId);
    if (variantId) {
      p = await adjustVariantStock(productId, variantId, from, -q);
      p = await adjustVariantStock(productId, variantId, to, q);
    } else {
      await adjustBaseStock(productId, from, -q);
      p = await adjustBaseStock(productId, to, q);
    }
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || 'Failed to transfer stock' });
  }
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === variantId)?.label : '') || '';
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_transfer',
    details: { product: p?.name || productId, variant: varLabel, from, to, qty: Math.abs(Number(qty)) },
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
  let current = 0;
  if (variantId) {
    const v = (Array.isArray(p.variants) ? p.variants.find(v => v.id === variantId) : null);
    if (!v) return res.status(400).json({ error: 'Variant not found' });
    current = getBranchQty(v?.stockByBranch, branchId);
  } else {
    current = getBranchQty(p.stockByBranch, branchId);
  }
  const next = Number(quantity);
  if (!Number.isFinite(next) || next < 0) return res.status(400).json({ error: 'Quantity must be a non-negative number' });
  const delta = next - current;
  try {
    if (variantId) {
      await adjustVariantStock(productId, variantId, branchId, delta);
    } else {
      await adjustBaseStock(productId, branchId, delta);
    }
  } catch (e) {
    return res.status(e?.status || 500).json({ error: e?.message || 'Failed to set stock' });
  }
  const varLabel = (Array.isArray(p?.variants) ? p.variants.find(v => v.id === variantId)?.label : '') || '';
  await Audit.create({
    actor: actor || 'unknown',
    actionType: 'stock_set_manual',
    details: { product: p?.name || productId, variant: varLabel, quantity: Number(quantity), delta, branchId },
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

export default r;
