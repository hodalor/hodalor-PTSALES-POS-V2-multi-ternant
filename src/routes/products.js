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
  out.brand = String(out.brand || '').trim();
  const basePrice = toNumberOrZero(out.price || 0);
  if (hasNumber(out.retailPrice)) out.retailPrice = toNumberOrZero(out.retailPrice);
  else out.retailPrice = basePrice;
  if (hasNumber(out.wholesalePrice)) out.wholesalePrice = toNumberOrZero(out.wholesalePrice);
  else out.wholesalePrice = out.retailPrice;
  if (hasNumber(out.warehousePrice)) out.warehousePrice = toNumberOrZero(out.warehousePrice);
  else out.warehousePrice = 0;
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
      if (hasNumber(next.warehousePrice)) next.warehousePrice = toNumberOrZero(next.warehousePrice);
      else next.warehousePrice = 0;
      if (hasNumber(next.agentPrice)) next.agentPrice = toNumberOrZero(next.agentPrice);
      else next.agentPrice = next.wholesalePrice || out.agentPrice || 0;
      next.costPrice = hasNumber(next.costPrice) ? toNumberOrZero(next.costPrice) : toNumberOrZero(out.costPrice || 0);
      next.wholesaleStockByBranch = normalizeStockByBranch(next.wholesaleStockByBranch);
      next.warehouseStockByBranch = normalizeStockByBranch(next.warehouseStockByBranch);
      return next;
    });
  }
  return out;
}

function stripInventoryMapsFromPayload(body) {
  if (!body || typeof body !== 'object') return body;
  const next = { ...body };
  delete next.stockByBranch;
  delete next.wholesaleStockByBranch;
  delete next.warehouseStockByBranch;
  if (Array.isArray(next.variants)) {
    next.variants = next.variants.map((variant) => {
      if (!variant || typeof variant !== 'object') return variant;
      const cleanVariant = { ...variant };
      delete cleanVariant.stockByBranch;
      delete cleanVariant.wholesaleStockByBranch;
      delete cleanVariant.warehouseStockByBranch;
      return cleanVariant;
    });
  }
  return next;
}

function inventoryMapsAttempted(body) {
  if (!body || typeof body !== 'object') return false;
  if ('stockByBranch' in body || 'wholesaleStockByBranch' in body || 'warehouseStockByBranch' in body) return true;
  if (!Array.isArray(body.variants)) return false;
  return body.variants.some((variant) => variant && typeof variant === 'object' && (
    'stockByBranch' in variant ||
    'wholesaleStockByBranch' in variant ||
    'warehouseStockByBranch' in variant
  ));
}

function preserveVariantInventoryMaps(existingVariants = [], incomingVariants = []) {
  if (!Array.isArray(incomingVariants)) return incomingVariants;
  const existing = Array.isArray(existingVariants) ? existingVariants : [];
  const usedIndexes = new Set();
  return incomingVariants.map((variant, index) => {
    if (!variant || typeof variant !== 'object') return variant;
    const incomingId = String(variant.id || '').trim();
    const incomingSku = String(variant.sku || '').trim().toLowerCase();
    const incomingLabel = String(variant.label || '').trim().toLowerCase();
    let matchIndex = existing.findIndex((entry, idx) => !usedIndexes.has(idx) && String(entry?.id || '').trim() === incomingId && incomingId);
    if (matchIndex < 0 && incomingSku) {
      matchIndex = existing.findIndex((entry, idx) => !usedIndexes.has(idx) && String(entry?.sku || '').trim().toLowerCase() === incomingSku);
    }
    if (matchIndex < 0 && incomingLabel) {
      matchIndex = existing.findIndex((entry, idx) => !usedIndexes.has(idx) && String(entry?.label || '').trim().toLowerCase() === incomingLabel);
    }
    if (matchIndex < 0) return variant;
    usedIndexes.add(matchIndex);
    const current = existing[matchIndex] || {};
    return {
      ...variant,
      stockByBranch: normalizeStockByBranch(current.stockByBranch),
      wholesaleStockByBranch: normalizeStockByBranch(current.wholesaleStockByBranch),
      warehouseStockByBranch: normalizeStockByBranch(current.warehouseStockByBranch)
    };
  });
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

function productRouteErrorMessage(err) {
  const code = String(err?.code || err?.name || '').trim();
  if (code === '11000' || code === 'E11000') {
    const dupField = Object.keys(err?.keyPattern || err?.keyValue || {})[0] || 'record';
    if (dupField === 'sku') return 'A product with this SKU already exists';
    return `Duplicate ${dupField} is not allowed`;
  }
  if (code === 'ValidationError') {
    const first = Object.values(err?.errors || {})[0];
    return String(first?.message || 'Product validation failed');
  }
  return String(err?.message || 'Failed to save product');
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
    obj.warehousePrice = hasNumber(obj.warehousePrice) ? toNumberOrZero(obj.warehousePrice) : 0;
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
        warehousePrice: hasNumber(v.warehousePrice) ? toNumberOrZero(v.warehousePrice) : 0,
        agentPrice: hasNumber(v.agentPrice) ? toNumberOrZero(v.agentPrice) : (hasNumber(v.wholesalePrice) ? toNumberOrZero(v.wholesalePrice) : obj.agentPrice),
        costPrice: hasNumber(v.costPrice) ? toNumberOrZero(v.costPrice) : obj.costPrice,
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
  try {
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
    res.json(p);
    void Audit.create({
      actor: (req.user && req.user.name) || 'unknown',
      actionType: 'product_create',
      details: {
        productId: p.id || String(p._id),
        name: p.name,
        sku: p.sku,
        price: p.price,
        category: p.category || '',
        initialStock: initialStock > 0 ? initialStock : 0,
        initialBranchId: initialBranchId || '',
        initialInventoryType: initialInventoryType || 'retail'
      },
      branchId: req.user?.branchId || ''
    }).catch(() => {});
    void ServerLog.create({
      level: 'info',
      actor: (req.user && req.user.name) || 'unknown',
      route: req.originalUrl || req.url || '',
      method: req.method || 'POST',
      status: 200,
      message: `Product created: ${p.name} (${p.sku})`
    }).catch(() => {});
  } catch (err) {
    const message = productRouteErrorMessage(err);
    const status = String(err?.code || err?.name || '') === 'ValidationError' || String(err?.code || '') === '11000' || String(err?.code || '') === 'E11000' ? 400 : 500;
    void ServerLog.create({
      level: 'error',
      actor: (req.user && req.user.name) || 'unknown',
      route: req.originalUrl || req.url || '',
      method: req.method || 'POST',
      status,
      message: `Product create failed: ${message}`,
      errorCode: String(err?.code || err?.name || ''),
      details: {
        sku: String(req.body?.sku || ''),
        name: String(req.body?.name || '')
      },
      stack: String(err?.stack || '')
    }).catch(() => {});
    return res.status(status).json({ error: message });
  }
});

r.put('/:id', requireRoleOrPerm(['Admin','Manager'], 'edit_products'), async (req, res) => {
  const id = req.params.id;
  const query = productLookupQuery(id);
  const before = await Product.findOne(query);
  const hadInventoryMapAttempt = inventoryMapsAttempted(req.body || {});
  if (hadInventoryMapAttempt) {
    void ServerLog.create({
      level: 'warn',
      actor: (req.user && req.user.name) || 'unknown',
      route: req.originalUrl || req.url || '',
      method: req.method || 'PUT',
      status: 400,
      message: `Rejected normal product update with inventory map fields: ${before?.name || id}`,
      details: { productId: before?.id || id }
    }).catch(() => {});
    return res.status(400).json({
      error: 'Normal product editing cannot change stock balances. Use the inventory stock endpoints for stock changes.'
    });
  }
  let payload = normalizePricingPayload(req.body || {});
  if (!payload.id && before?.id) {
    payload.id = before.id;
  }
  payload = stripInventoryMapsFromPayload(payload);
  if (Array.isArray(payload.variants) && before) {
    payload.variants = preserveVariantInventoryMaps(before.variants, payload.variants);
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
  res.json(p);
  void Audit.create({
    actor: (req.user && req.user.name) || 'unknown',
    actionType: 'product_update',
    details: { id, name: p?.name || before?.name || '', sku: p?.sku || before?.sku || '', changedKeys: changed },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: (req.user && req.user.name) || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'PUT',
    status: 200,
    message: `Product updated: ${p?.name || id}`,
    details: { changedKeys: changed }
  }).catch(() => {});
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const query = productLookupQuery(id);
  const doc = await Product.findOne(query);
  if (!doc) return res.status(404).json({ error: 'Product not found' });
  const remark = String(req.body?.remark || '').trim();
  if (!remark) return res.status(400).json({ error: 'Deletion remark is required' });
  await Product.findOneAndDelete(query);
  res.json({ ok: true });
  void Audit.create({
    actor: (req.user && req.user.name) || 'unknown',
    actionType: 'product_delete',
    details: { id, name: doc?.name || '', sku: doc?.sku || '', remark },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: (req.user && req.user.name) || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'DELETE',
    status: 200,
    message: `Product deleted: ${doc?.name || id}`,
    details: { productId: doc?.id || String(doc?._id || id), remark }
  }).catch(() => {});
});

export default r;
