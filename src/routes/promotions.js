import { Router } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Promotion from '../models/Promotion.js';
import Product from '../models/Product.js';
import ProductUnit from '../models/ProductUnit.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { safeErrorMessage, safeErrorStatus } from '../utils/safeError.js';

const r = Router();
r.use(requireAuth);

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function productLookup(productId) {
  const key = String(productId || '').trim();
  if (!key) return null;
  const or = [{ id: key }];
  if (mongoose.isValidObjectId(key)) or.push({ _id: key });
  return { $or: or };
}

async function normalizeCombos(combos = []) {
  const source = Array.isArray(combos) ? combos : [];
  if (source.length === 0) {
    const err = new Error('Add at least one combo to this promotion');
    err.status = 400;
    throw err;
  }
  const normalized = [];
  for (const combo of source) {
    const name = String(combo?.name || '').trim();
    if (!name) {
      const err = new Error('Each combo needs a name');
      err.status = 400;
      throw err;
    }
    const promoPrice = roundMoney(combo?.promoPrice);
    if (promoPrice < 0) {
      const err = new Error(`Promo price for ${name} cannot be negative`);
      err.status = 400;
      throw err;
    }
    const image = String(combo?.image || '').trim();
    if (image && !image.startsWith('data:image/')) {
      const err = new Error(`Upload an image file for ${name}`);
      err.status = 400;
      throw err;
    }
    if (image.length > 700000) {
      const err = new Error(`The image for ${name} is too large`);
      err.status = 400;
      throw err;
    }
    const rawItems = Array.isArray(combo?.items) ? combo.items : [];
    if (rawItems.length < 2) {
      const err = new Error(`${name} needs at least two products`);
      err.status = 400;
      throw err;
    }
    const items = [];
    for (const item of rawItems) {
      const productId = String(item?.productId || '').trim();
      const variantId = String(item?.variantId || '').trim();
      const qty = Math.floor(Number(item?.qty || 0));
      if (!productId || qty < 1) {
        const err = new Error(`Each product in ${name} needs a quantity of at least 1`);
        err.status = 400;
        throw err;
      }
      const query = productLookup(productId);
      const product = query ? await Product.findOne(query) : null;
      if (!product) {
        const err = new Error(`Product not found for ${name}`);
        err.status = 400;
        throw err;
      }
      const variant = variantId
        ? (Array.isArray(product.variants) ? product.variants : []).find((row) => String(row.id) === variantId)
        : null;
      if (variantId && !variant) {
        const err = new Error(`Variant not found for ${product.name}`);
        err.status = 400;
        throw err;
      }
      const serialized = String(product.trackType || 'quantity') === 'serialized';
      const hasVariants = (Array.isArray(product.variants) ? product.variants : []).some((row) => String(row?.id || '').trim());
      if (serialized && hasVariants && !variantId) {
        const err = new Error(`Choose a variant for ${product.name}`);
        err.status = 400;
        throw err;
      }
      const units = [];
      if (serialized) {
        const requested = Array.from(new Set(
          (Array.isArray(item?.units) ? item.units : [])
            .map((unit) => String(unit?.unitId || unit?._id || '').trim())
            .filter(Boolean)
        ));
        if (requested.length < qty || requested.length % qty !== 0) {
          const err = new Error(`Select complete sets of units for ${product.name}`);
          err.status = 400;
          throw err;
        }
        const rows = await ProductUnit.find({
          _id: { $in: requested },
          productId: String(product.id || product._id),
          variantId,
          inventoryType: 'retail',
          status: { $in: ['in_stock', 'reserved'] }
        }).select('imei serialNumber branchId productId variantId').lean();
        if (rows.length !== requested.length) {
          const err = new Error(`Some selected units for ${product.name} are no longer available`);
          err.status = 400;
          throw err;
        }
        rows.forEach((row) => {
          units.push({
            unitId: String(row._id),
            imei: row.imei || '',
            serialNumber: row.serialNumber || '',
            branchId: String(row.branchId || '')
          });
        });
      }
      const label = variant?.label ? `${product.name} (${variant.label})` : product.name;
      items.push({ productId: String(product.id || product._id), variantId, name: label, qty, units });
    }
    let profitAmount = combo?.profitAmount == null || combo?.profitAmount === '' ? null : roundMoney(combo.profitAmount);
    const profitPercentInput = combo?.profitPercent == null || combo?.profitPercent === '' ? null : roundMoney(combo.profitPercent);
    if (profitAmount == null && profitPercentInput != null) {
      profitAmount = roundMoney(promoPrice * profitPercentInput / 100);
    }
    if (profitAmount == null) profitAmount = 0;
    if (profitAmount < 0) profitAmount = 0;
    if (profitAmount > promoPrice) {
      const err = new Error(`Profit for ${name} cannot be more than the promo price`);
      err.status = 400;
      throw err;
    }
    const profitPercent = promoPrice > 0 ? roundMoney((profitAmount / promoPrice) * 100) : 0;
    normalized.push({
      id: String(combo?.id || crypto.randomUUID()),
      name,
      image,
      promoPrice,
      profitAmount,
      profitPercent,
      items
    });
  }
  return normalized;
}

function normalizePayload(body = {}) {
  const name = String(body.name || '').trim();
  if (!name) {
    const err = new Error('Promotion name is required');
    err.status = 400;
    throw err;
  }
  const allBranches = body.allBranches !== false;
  const branchIds = allBranches
    ? []
    : Array.from(new Set((Array.isArray(body.branchIds) ? body.branchIds : []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (!allBranches && branchIds.length === 0) {
    const err = new Error('Select at least one branch, or choose all branches');
    err.status = 400;
    throw err;
  }
  return {
    name,
    active: body.active !== false,
    allBranches,
    branchIds
  };
}

r.get('/', async (req, res) => {
  const rows = await Promotion.find({}).sort({ createdAt: -1 }).limit(500).lean();
  if (String(req.query.available || '') === '1') {
    const unitIds = [];
    rows.forEach((row) => {
      (row.combos || []).forEach((combo) => {
        (combo.items || []).forEach((item) => {
          (item.units || []).forEach((unit) => {
            if (unit?.unitId) unitIds.push(unit.unitId);
          });
        });
      });
    });
    const liveRows = unitIds.length > 0
      ? await ProductUnit.find({
        _id: { $in: unitIds },
        inventoryType: 'retail',
        status: 'in_stock'
      }).select('_id').lean()
      : [];
    const liveIds = new Set(liveRows.map((row) => String(row._id)));
    rows.forEach((row) => {
      (row.combos || []).forEach((combo) => {
        (combo.items || []).forEach((item) => {
          if (!Array.isArray(item.units) || item.units.length === 0) return;
          item.units = item.units.filter((unit) => liveIds.has(String(unit.unitId || '')));
        });
      });
    });
  }
  res.json(rows);
});

r.post('/', requireRoleOrPerm(['Admin', 'Manager', 'SuperAdmin'], ''), async (req, res) => {
  try {
    const base = normalizePayload(req.body || {});
    const combos = await normalizeCombos(req.body?.combos);
    const row = await Promotion.create({ ...base, combos });
    res.status(201).json(row);
  } catch (e) {
    res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to save promotion') });
  }
});

r.patch('/:id', requireRoleOrPerm(['Admin', 'Manager', 'SuperAdmin'], ''), async (req, res) => {
  try {
    const row = await Promotion.findById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Promotion not found' });
    const base = normalizePayload({ ...row.toObject(), ...(req.body || {}) });
    row.name = base.name;
    row.active = base.active;
    row.allBranches = base.allBranches;
    row.branchIds = base.branchIds;
    if (Array.isArray(req.body?.combos)) {
      row.combos = await normalizeCombos(req.body.combos);
    }
    await row.save();
    res.json(row);
  } catch (e) {
    res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to update promotion') });
  }
});

r.delete('/:id', requireRoleOrPerm(['Admin', 'Manager', 'SuperAdmin'], ''), async (req, res) => {
  const row = await Promotion.findByIdAndDelete(req.params.id);
  if (!row) return res.status(404).json({ error: 'Promotion not found' });
  res.json({ ok: true });
});

export default r;
