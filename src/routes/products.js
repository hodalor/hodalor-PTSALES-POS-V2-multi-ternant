import { Router } from 'express';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireAdmin, requireRole, requireRoleOrPerm } from '../middleware/auth.js';
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

function normalizeStockByBranch(x) {
  if (!x) return {};
  if (x instanceof Map) return Object.fromEntries(x.entries());
  if (typeof x === 'object') return x;
  return {};
}

function hasNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n);
}

function toNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizePricingPayload(body = {}) {
  const out = { ...body };
  const basePrice = toNumberOrZero(out.price || 0);
  if (hasNumber(out.retailPrice)) out.retailPrice = toNumberOrZero(out.retailPrice);
  else out.retailPrice = basePrice;
  if (hasNumber(out.wholesalePrice)) out.wholesalePrice = toNumberOrZero(out.wholesalePrice);
  else out.wholesalePrice = out.retailPrice;
  if (hasNumber(out.agentPrice)) out.agentPrice = toNumberOrZero(out.agentPrice);
  else out.agentPrice = out.wholesalePrice;
  out.allowCredit = out.allowCredit !== false;
  out.trackType = normalizeTrackType(out.trackType);
  out.lowStock = toNumberOrZero(out.lowStock || 0);
  out.wholesaleLowStock = toNumberOrZero(out.wholesaleLowStock != null ? out.wholesaleLowStock : out.lowStock || 0);
  out.warehouseLowStock = toNumberOrZero(out.warehouseLowStock != null ? out.warehouseLowStock : out.lowStock || 0);
  out.minimumCreditPercentage = Math.max(0, Math.min(100, Number(out.minimumCreditPercentage || 0)));
  out.wholesaleStockByBranch = normalizeStockByBranch(out.wholesaleStockByBranch);
  out.warehouseStockByBranch = normalizeStockByBranch(out.warehouseStockByBranch);
  if (Array.isArray(out.variants)) {
    out.variants = out.variants.map(v => {
      const next = { ...(v || {}) };
      const variantBase = toNumberOrZero(next.price != null ? next.price : out.price || 0);
      next.sku = next.sku || '';
      if (hasNumber(next.retailPrice)) next.retailPrice = toNumberOrZero(next.retailPrice);
      else next.retailPrice = variantBase || out.retailPrice || 0;
      if (hasNumber(next.wholesalePrice)) next.wholesalePrice = toNumberOrZero(next.wholesalePrice);
      else next.wholesalePrice = next.retailPrice || out.wholesalePrice || 0;
      if (hasNumber(next.agentPrice)) next.agentPrice = toNumberOrZero(next.agentPrice);
      else next.agentPrice = next.wholesalePrice || out.agentPrice || 0;
      next.wholesaleStockByBranch = normalizeStockByBranch(next.wholesaleStockByBranch);
      next.warehouseStockByBranch = normalizeStockByBranch(next.warehouseStockByBranch);
      return next;
    });
  }
  return out;
}

function stockFieldForInventoryType(inventoryType) {
  const type = String(inventoryType || 'retail').toLowerCase();
  if (type === 'warehouse') return 'warehouseStockByBranch';
  if (type === 'wholesale') return 'wholesaleStockByBranch';
  return 'stockByBranch';
}

function pad12Digits(n) {
  const s = String(n).replace(/\D/g, '');
  if (s.length >= 12) return s.slice(-12);
  return (s + '000000000000').slice(0, 12);
}
function ean13CheckDigit(d12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(d12[i]);
    sum += (i % 2 === 0) ? d : d * 3;
  }
  const mod = sum % 10;
  return String((10 - mod) % 10);
}
function generateEAN13() {
  const base = pad12Digits(String(Date.now()).slice(-10) + String(Math.floor(Math.random() * 100)).padStart(2, '0'));
  return base + ean13CheckDigit(base);
}

r.get('/', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(v => String(v || '').trim()).filter(Boolean);
  const query = ids.length > 0 ? { $or: [{ id: { $in: ids } }, { _id: { $in: ids.filter(v => mongoose.isValidObjectId(v)).map(v => new mongoose.Types.ObjectId(v)) } }] } : {};
  const items = await Product.find(query).sort({ createdAt: -1 }).limit(ids.length > 0 ? Math.max(ids.length, 1) : 1000);
  // Backfill missing barcodes
  const toUpdate = items.filter(p => !p.barcode);
  if (toUpdate.length > 0) {
    await Promise.allSettled(toUpdate.map(async p => {
      p.barcode = generateEAN13();
      try { await p.save(); } catch {}
    }));
  }
  const mapped = items.map(p => {
    const obj = p.toObject ? p.toObject({ flattenMaps: true }) : p;
    if (!obj.id && obj._id) obj.id = String(obj._id);
    obj.stockByBranch = normalizeStockByBranch(obj.stockByBranch);
    obj.wholesaleStockByBranch = normalizeStockByBranch(obj.wholesaleStockByBranch);
    obj.warehouseStockByBranch = normalizeStockByBranch(obj.warehouseStockByBranch);
    const basePrice = toNumberOrZero(obj.price || 0);
    obj.retailPrice = hasNumber(obj.retailPrice) ? toNumberOrZero(obj.retailPrice) : basePrice;
    obj.wholesalePrice = hasNumber(obj.wholesalePrice) ? toNumberOrZero(obj.wholesalePrice) : obj.retailPrice;
    obj.agentPrice = hasNumber(obj.agentPrice) ? toNumberOrZero(obj.agentPrice) : obj.wholesalePrice;
    obj.allowCredit = obj.allowCredit !== false;
    obj.trackType = normalizeTrackType(obj.trackType);
    obj.lowStock = toNumberOrZero(obj.lowStock || 0);
    obj.wholesaleLowStock = hasNumber(obj.wholesaleLowStock) ? toNumberOrZero(obj.wholesaleLowStock) : obj.lowStock;
    obj.warehouseLowStock = hasNumber(obj.warehouseLowStock) ? toNumberOrZero(obj.warehouseLowStock) : obj.lowStock;
    obj.minimumCreditPercentage = Math.max(0, Math.min(100, Number(obj.minimumCreditPercentage || 0)));
    if (Array.isArray(obj.variants)) {
      obj.variants = obj.variants.map((v, idx) => ({
        id: v.id || v.label || String(idx),
        label: v.label,
        sku: v.sku || '',
        price: v.price,
        retailPrice: hasNumber(v.retailPrice) ? toNumberOrZero(v.retailPrice) : (hasNumber(v.price) ? toNumberOrZero(v.price) : obj.retailPrice),
        wholesalePrice: hasNumber(v.wholesalePrice) ? toNumberOrZero(v.wholesalePrice) : (hasNumber(v.retailPrice) ? toNumberOrZero(v.retailPrice) : obj.wholesalePrice),
        agentPrice: hasNumber(v.agentPrice) ? toNumberOrZero(v.agentPrice) : (hasNumber(v.wholesalePrice) ? toNumberOrZero(v.wholesalePrice) : obj.agentPrice),
        stockByBranch: normalizeStockByBranch(v.stockByBranch),
        wholesaleStockByBranch: normalizeStockByBranch(v.wholesaleStockByBranch),
        warehouseStockByBranch: normalizeStockByBranch(v.warehouseStockByBranch)
      }));
    }
    return obj;
  });
  res.json(mapped);
});

r.post('/', requireRoleOrPerm(['Admin','Manager'], 'edit_products'), async (req, res) => {
  const body = normalizePricingPayload(req.body || {});
  const initialStock = Number(body.initialStock || 0);
  const initialBranchId = String(body.initialBranchId || '').trim();
  const initialInventoryType = String(body.initialInventoryType || 'retail').trim().toLowerCase();
  delete body.initialStock;
  delete body.initialBranchId;
  delete body.initialInventoryType;
  if (!body.barcode) body.barcode = generateEAN13();
  if (initialBranchId && Number.isFinite(initialStock) && initialStock > 0 && normalizeTrackType(body.trackType) !== 'serialized') {
    const field = stockFieldForInventoryType(initialInventoryType);
    body[field] = {
      ...(body[field] || {}),
      [initialBranchId]: initialStock
    };
  }
  const p = await Product.create(body);
  if (!p.id) {
    p.id = String(p._id);
    try { await p.save(); } catch {}
  }
  await Audit.create({
    actor: (req.user && req.user.name) || 'unknown',
    actionType: 'product_create',
    details: { name: p.name, sku: p.sku, price: p.price, category: p.category || '', initialStock: initialStock > 0 ? initialStock : 0, initialBranchId: initialBranchId || '' },
    branchId: req.user?.branchId || ''
  });
  await ServerLog.create({
    level: 'info',
    actor: (req.user && req.user.name) || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'POST',
    status: 200,
    message: `Product created: ${p.name} (${p.sku})`
  });
  res.json(p);
});

r.put('/:id', requireRoleOrPerm(['Admin','Manager'], 'edit_products'), async (req, res) => {
  const id = req.params.id;
  const query = productLookupQuery(id);
  const before = await Product.findOne(query);
  const payload = normalizePricingPayload(req.body || {});
  if (payload && payload.stockByBranch != null) {
    delete payload.stockByBranch;
  }
  if (Array.isArray(payload?.variants)) {
    payload.variants = payload.variants.map(v => {
      const out = { ...(v || {}) };
      if (out.stockByBranch != null) delete out.stockByBranch;
      return out;
    });
  }
  if (!payload.id && before?.id) {
    payload.id = before.id;
  }
  const p = await Product.findOneAndUpdate(query, payload, { new: true });
  const changed = [];
  Object.keys(payload).forEach(k => {
    try {
      const a = before ? JSON.stringify(before[k]) : undefined;
      const b = JSON.stringify(payload[k]);
      if (a !== b) changed.push(k);
    } catch {
      changed.push(k);
    }
  });
  await Audit.create({
    actor: (req.user && req.user.name) || 'unknown',
    actionType: 'product_update',
    details: { id, name: p?.name || before?.name || '', sku: p?.sku || before?.sku || '', changedKeys: changed },
    branchId: req.user?.branchId || ''
  });
  await ServerLog.create({
    level: 'info',
    actor: (req.user && req.user.name) || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'PUT',
    status: 200,
    message: `Product updated: ${p?.name || id}`,
    details: { changedKeys: changed }
  });
  res.json(p);
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const query = productLookupQuery(id);
  const doc = await Product.findOne(query);
  await Product.findOneAndDelete(query);
  await Audit.create({
    actor: (req.user && req.user.name) || 'unknown',
    actionType: 'product_delete',
    details: { id, name: doc?.name || '', sku: doc?.sku || '' },
    branchId: req.user?.branchId || ''
  });
  await ServerLog.create({
    level: 'info',
    actor: (req.user && req.user.name) || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'DELETE',
    status: 200,
    message: `Product deleted: ${doc?.name || id}`
  });
  res.json({ ok: true });
});

export default r;
