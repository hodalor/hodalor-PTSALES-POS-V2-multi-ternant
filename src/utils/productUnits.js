import mongoose from 'mongoose';
import Product from '../models/Product.js';
import ProductUnit from '../models/ProductUnit.js';
import Branch from '../models/Branch.js';
import { getMapQty, getStockTarget, markInventoryModified, setMapQty } from './inventory.js';

export function normalizeTrackType(value) {
  return String(value || '').toLowerCase() === 'serialized' ? 'serialized' : 'quantity';
}

export function normalizeInventoryType(value) {
  const kind = String(value || '').toLowerCase();
  if (kind === 'warehouse') return 'warehouse';
  if (kind === 'wholesale') return 'wholesale';
  return 'retail';
}

export function productLookupQuery(productId) {
  const pid = String(productId || '');
  const or = [{ id: pid }];
  if (mongoose.isValidObjectId(pid)) or.unshift({ _id: pid });
  return { $or: or };
}

export async function resolveInventoryTypeFromBranch(branchId, fallback = 'retail') {
  if (!branchId) return normalizeInventoryType(fallback);
  try {
    const branch = await Branch.findOne({ id: String(branchId) });
    if (branch?.branchType) return normalizeInventoryType(branch.branchType);
  } catch {}
  return normalizeInventoryType(fallback);
}

export function parseSerializedEntries(rawText = '') {
  return String(rawText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [first, ...rest] = line.split(/[,\t|]/).map(part => part.trim()).filter(Boolean);
      const second = rest[0] || '';
      return {
        imei: first || '',
        serialNumber: second || first || ''
      };
    });
}

export function normalizeSerializedEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({
      imei: String(entry?.imei || '').trim(),
      serialNumber: String(entry?.serialNumber || '').trim() || String(entry?.imei || '').trim() || `SER-${index + 1}`
    }))
    .filter(entry => entry.imei || entry.serialNumber);
}

export async function assertSerializedProduct(productId) {
  const product = await Product.findOne(productLookupQuery(productId));
  if (!product) {
    const err = new Error('Product not found');
    err.status = 404;
    throw err;
  }
  if (normalizeTrackType(product.trackType) !== 'serialized') {
    const err = new Error('Product is not serialized');
    err.status = 400;
    throw err;
  }
  return product;
}

export async function ensureUniqueUnitCodes(entries = []) {
  const seenImei = new Set();
  const seenSerial = new Set();
  entries.forEach(entry => {
    if (entry.imei) {
      if (seenImei.has(entry.imei)) {
        const err = new Error(`Duplicate IMEI in request: ${entry.imei}`);
        err.status = 400;
        throw err;
      }
      seenImei.add(entry.imei);
    }
    if (entry.serialNumber) {
      if (seenSerial.has(entry.serialNumber)) {
        const err = new Error(`Duplicate serial number in request: ${entry.serialNumber}`);
        err.status = 400;
        throw err;
      }
      seenSerial.add(entry.serialNumber);
    }
  });
  const imeis = entries.map(entry => entry.imei).filter(Boolean);
  const serials = entries.map(entry => entry.serialNumber).filter(Boolean);
  const existing = await ProductUnit.find({
    $or: [
      ...(imeis.length > 0 ? [{ imei: { $in: imeis } }] : []),
      ...(serials.length > 0 ? [{ serialNumber: { $in: serials } }] : [])
    ]
  }).limit(50);
  if (existing.length > 0) {
    const conflict = existing[0];
    const err = new Error(`Serialized unit already exists: ${conflict.imei || conflict.serialNumber}`);
    err.status = 400;
    throw err;
  }
}

export async function incrementSerializedStock(product, branchId, inventoryType, variantId, delta) {
  const target = getStockTarget(product, variantId, inventoryType);
  if (!target) {
    const err = new Error('Variant not found');
    err.status = 400;
    throw err;
  }
  const prev = getMapQty(target.container, branchId);
  setMapQty(target.container, branchId, Math.max(0, prev + Number(delta || 0)));
  markInventoryModified(target);
  await product.save();
}

export async function createSerializedUnits({ productId, variantId = '', branchId, inventoryType = 'retail', entries = [] }) {
  const product = await assertSerializedProduct(productId);
  const normalizedEntries = normalizeSerializedEntries(entries);
  if (normalizedEntries.length === 0) {
    const err = new Error('Serialized products require IMEI or serial numbers');
    err.status = 400;
    throw err;
  }
  await ensureUniqueUnitCodes(normalizedEntries);
  const created = await ProductUnit.insertMany(normalizedEntries.map(entry => ({
    productId: String(product.id || product._id),
    variantId: String(variantId || ''),
    imei: entry.imei,
    serialNumber: entry.serialNumber,
    inventoryType: normalizeInventoryType(inventoryType),
    branchId: String(branchId),
    status: 'in_stock'
  })));
  await incrementSerializedStock(product, String(branchId), normalizeInventoryType(inventoryType), String(variantId || ''), created.length);
  return { product, created };
}

export async function reserveSerializedUnit({ code, unitId = '', productId = '', variantId = '', branchId, inventoryType = 'retail', reservationToken }) {
  const normalizedType = normalizeInventoryType(inventoryType);
  const query = {
    branchId: String(branchId),
    inventoryType: normalizedType,
    status: { $in: ['in_stock', 'reserved'] }
  };
  if (unitId) {
    query._id = String(unitId);
  } else if (code) {
    query.$or = [{ imei: String(code) }, { serialNumber: String(code) }];
  } else {
    query.productId = String(productId);
    if (variantId) query.variantId = String(variantId);
  }
  const sort = unitId ? undefined : { createdAt: 1 };
  const unit = await ProductUnit.findOne(query).sort(sort);
  if (!unit) {
    const err = new Error('Serialized unit not available');
    err.status = 404;
    throw err;
  }
  if (unit.status === 'reserved' && unit.reservationToken && unit.reservationToken !== reservationToken) {
    const err = new Error('Serialized unit already reserved');
    err.status = 409;
    throw err;
  }
  const updated = await ProductUnit.findOneAndUpdate(
    {
      _id: unit._id,
      $or: [
        { status: 'in_stock' },
        { status: 'reserved', reservationToken: String(reservationToken || '') }
      ]
    },
    {
      $set: {
        status: 'reserved',
        reservationToken: String(reservationToken || ''),
        reservedAt: new Date()
      }
    },
    { new: true }
  );
  if (!updated) {
    const err = new Error('Serialized unit already reserved');
    err.status = 409;
    throw err;
  }
  return updated;
}

export async function listSerializedUnits({ productId = '', variantId = '', branchId = '', inventoryType = '', status = '', query = '', page = 1, pageSize = 30 }) {
  const filter = {};
  if (productId) filter.productId = String(productId);
  if (variantId) filter.variantId = String(variantId);
  if (branchId) filter.branchId = String(branchId);
  if (inventoryType) filter.inventoryType = normalizeInventoryType(inventoryType);
  if (status) filter.status = String(status);
  if (query) {
    filter.$or = [
      { imei: new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { serialNumber: new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    ];
  }
  const skip = Math.max(0, (Number(page || 1) - 1) * Number(pageSize || 30));
  const [rows, total] = await Promise.all([
    ProductUnit.find(filter, {
      productId: 1,
      variantId: 1,
      imei: 1,
      serialNumber: 1,
      inventoryType: 1,
      branchId: 1,
      status: 1,
      reservationToken: 1,
      reservedAt: 1,
      soldAt: 1,
      soldSaleId: 1,
      createdAt: 1,
      updatedAt: 1
    }).sort({ createdAt: -1 }).skip(skip).limit(Math.max(1, Number(pageSize || 30))).lean(),
    ProductUnit.countDocuments(filter)
  ]);
  return { rows, total };
}

export async function releaseSerializedUnits({ unitIds = [], reservationToken = '' }) {
  const filter = {
    status: 'reserved'
  };
  if (unitIds.length > 0) filter._id = { $in: unitIds };
  if (reservationToken) filter.reservationToken = String(reservationToken);
  const rows = await ProductUnit.find(filter);
  if (rows.length === 0) return [];
  for (const row of rows) {
    row.status = 'in_stock';
    row.reservationToken = '';
    row.reservedAt = null;
    await row.save();
  }
  return rows;
}

export async function sellSerializedUnits({ unitIds = [], reservationToken = '', saleId }) {
  const rows = await ProductUnit.find({ _id: { $in: unitIds } });
  if (rows.length !== unitIds.length) {
    const err = new Error('Some serialized units were not found');
    err.status = 404;
    throw err;
  }
  for (const row of rows) {
    if (row.status === 'sold') {
      const err = new Error(`Serialized unit already sold: ${row.imei || row.serialNumber}`);
      err.status = 409;
      throw err;
    }
    if (row.status === 'reserved' && row.reservationToken && row.reservationToken !== reservationToken) {
      const err = new Error(`Serialized unit reserved by another session: ${row.imei || row.serialNumber}`);
      err.status = 409;
      throw err;
    }
  }
  for (const row of rows) {
    row.status = 'sold';
    row.soldSaleId = String(saleId || '');
    row.soldAt = new Date();
    row.reservationToken = '';
    row.reservedAt = null;
    await row.save();
  }
  return rows;
}

export async function returnSerializedUnits({ unitIds = [], branchId = '', inventoryType = '', saleId = '' }) {
  const rows = await ProductUnit.find({ _id: { $in: unitIds } });
  for (const row of rows) {
    row.status = 'in_stock';
    row.branchId = String(branchId || row.branchId);
    row.inventoryType = inventoryType ? normalizeInventoryType(inventoryType) : row.inventoryType;
    row.reservationToken = '';
    row.reservedAt = null;
    row.soldSaleId = saleId ? String(saleId) : row.soldSaleId;
    row.lastReturnAt = new Date();
    await row.save();
  }
  return rows;
}

export async function transferSerializedUnits({ productId, variantId = '', fromBranchId, toBranchId, fromInventoryType = 'retail', toInventoryType = 'retail', unitIds = [] }) {
  const product = await assertSerializedProduct(productId);
  const rows = await ProductUnit.find({
    _id: { $in: unitIds },
    productId: String(product.id || product._id),
    variantId: String(variantId || ''),
    branchId: String(fromBranchId),
    inventoryType: normalizeInventoryType(fromInventoryType),
    status: 'in_stock'
  });
  if (rows.length !== unitIds.length) {
    const err = new Error('Some serialized units are unavailable for transfer');
    err.status = 400;
    throw err;
  }
  for (const row of rows) {
    row.branchId = String(toBranchId);
    row.inventoryType = normalizeInventoryType(toInventoryType);
    await row.save();
  }
  await incrementSerializedStock(product, String(fromBranchId), normalizeInventoryType(fromInventoryType), String(variantId || ''), -rows.length);
  await incrementSerializedStock(product, String(toBranchId), normalizeInventoryType(toInventoryType), String(variantId || ''), rows.length);
  return rows;
}

export async function adjustSerializedUnits({ productId, variantId = '', branchId, inventoryType = 'retail', unitIds = [], entries = [], mode = 'increase' }) {
  const direction = String(mode || 'increase').toLowerCase() === 'decrease' ? 'decrease' : 'increase';
  if (direction === 'increase') {
    return createSerializedUnits({ productId, variantId, branchId, inventoryType, entries });
  }
  const product = await assertSerializedProduct(productId);
  const rows = await ProductUnit.find({
    _id: { $in: unitIds },
    productId: String(product.id || product._id),
    variantId: String(variantId || ''),
    branchId: String(branchId),
    inventoryType: normalizeInventoryType(inventoryType),
    status: 'in_stock'
  });
  if (rows.length !== unitIds.length) {
    const err = new Error('Some serialized units are unavailable for adjustment');
    err.status = 400;
    throw err;
  }
  for (const row of rows) {
    row.status = 'adjusted_out';
    row.reservationToken = '';
    row.reservedAt = null;
    await row.save();
  }
  await incrementSerializedStock(product, String(branchId), normalizeInventoryType(inventoryType), String(variantId || ''), -rows.length);
  return { product, removed: rows };
}
