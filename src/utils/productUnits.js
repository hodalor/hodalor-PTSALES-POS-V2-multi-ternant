import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import Product from '../models/Product.js';
import ProductUnit from '../models/ProductUnit.js';
import Branch from '../models/Branch.js';
import { getMapQty, getStockTarget, markInventoryModified, setMapQty } from './inventory.js';

function reportQueuedSalesImeiDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  const envCandidates = [
    path.resolve(process.cwd(), '.dbg', 'queued-sales-imei.env'),
    path.resolve(process.cwd(), '..', '.dbg', 'queued-sales-imei.env')
  ];
  let url = 'http://127.0.0.1:7777/event';
  let sessionId = 'queued-sales-imei';
  for (const candidate of envCandidates) {
    try {
      const text = fs.readFileSync(candidate, 'utf8');
      url = text.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
      sessionId = text.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
      break;
    } catch {}
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, runId: 'pre-fix', hypothesisId, location, msg, data, ts: Date.now() })
  }).catch(() => {});
}

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

function assertVariantAssignment(product, variantId = '') {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length === 0) return;
  const normalizedVariantId = String(variantId || '').trim();
  if (!normalizedVariantId) {
    const err = new Error('Select a variant before adding serialized units');
    err.status = 400;
    throw err;
  }
  const match = variants.find((variant) => String(variant?.id || '') === normalizedVariantId);
  if (!match) {
    const err = new Error('Selected variant was not found for this product');
    err.status = 400;
    throw err;
  }
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
    status: { $ne: 'adjusted_out' },
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

export async function reviveAdjustedOutUnits({ productId, variantId = '', branchId, inventoryType = 'retail', entries = [] }) {
  const normalizedType = normalizeInventoryType(inventoryType);
  const remaining = [];
  const revived = [];
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const match = await ProductUnit.findOne({
      status: 'adjusted_out',
      $or: [
        ...(entry?.imei ? [{ imei: String(entry.imei) }] : []),
        ...(entry?.serialNumber ? [{ serialNumber: String(entry.serialNumber) }] : [])
      ]
    }).sort({ updatedAt: -1, createdAt: -1 });
    if (!match) {
      remaining.push(entry);
      continue;
    }
    match.productId = String(productId);
    match.variantId = String(variantId || '');
    match.branchId = String(branchId);
    match.inventoryType = normalizedType;
    match.status = 'in_stock';
    match.reservationToken = '';
    match.reservedAt = null;
    match.soldAt = null;
    match.soldSaleId = '';
    match.lastReturnAt = new Date();
    await match.save();
    revived.push(match);
  }
  return { revived, remaining };
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
  assertVariantAssignment(product, variantId);
  const normalizedEntries = normalizeSerializedEntries(entries);
  if (normalizedEntries.length === 0) {
    const err = new Error('Serialized products require IMEI or serial numbers');
    err.status = 400;
    throw err;
  }
  await ensureUniqueUnitCodes(normalizedEntries);
  const { revived, remaining } = await reviveAdjustedOutUnits({
    productId: String(product.id || product._id),
    variantId,
    branchId,
    inventoryType,
    entries: normalizedEntries
  });
  const created = await ProductUnit.insertMany(remaining.map(entry => ({
    productId: String(product.id || product._id),
    variantId: String(variantId || ''),
    imei: entry.imei,
    serialNumber: entry.serialNumber,
    inventoryType: normalizeInventoryType(inventoryType),
    branchId: String(branchId),
    status: 'in_stock'
  })));
  const totalDelta = revived.length + created.length;
  await incrementSerializedStock(product, String(branchId), normalizeInventoryType(inventoryType), String(variantId || ''), totalDelta);
  return { product, created: [...revived, ...created] };
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

export async function listSerializedUnits({ productId = '', variantId = '', branchId = '', inventoryType = '', status = '', reservationToken = '', query = '', page = 1, pageSize = 30, all = false }) {
  const filter = {};
  if (productId) filter.productId = String(productId);
  if (variantId) filter.variantId = String(variantId);
  if (branchId) filter.branchId = String(branchId);
  if (inventoryType) filter.inventoryType = normalizeInventoryType(inventoryType);
  const availabilityFilter = status === 'available'
    ? [
        { status: 'in_stock' },
        ...(reservationToken ? [{ status: 'reserved', reservationToken: String(reservationToken) }] : [])
      ]
    : null;
  if (status === 'available') {
    filter.$or = availabilityFilter;
  } else if (status) {
    filter.status = String(status);
  }
  if (query) {
    const queryRegex = new RegExp(String(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matchedProducts = await Product.find({
      $or: [
        { name: queryRegex },
        { sku: queryRegex },
        { barcode: queryRegex },
        { brand: queryRegex },
        { attributes: { $elemMatch: { key: /^brand$/i, value: queryRegex } } }
      ]
    }, { id: 1 }).limit(250).lean();
    const matchedProductIds = matchedProducts
      .map((row) => String(row.id || row._id || '').trim())
      .filter(Boolean);
    const queryFilter = [
      { imei: queryRegex },
      { serialNumber: queryRegex },
      ...(matchedProductIds.length > 0 ? [{ productId: { $in: matchedProductIds } }] : [])
    ];
    if (availabilityFilter) {
      delete filter.$or;
      filter.$and = [{ $or: availabilityFilter }, { $or: queryFilter }];
    } else {
      filter.$or = queryFilter;
    }
  }
  const skip = Math.max(0, (Number(page || 1) - 1) * Number(pageSize || 30));
  const limit = all ? 0 : Math.max(1, Number(pageSize || 30));
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
    }).sort({ createdAt: -1 }).skip(all ? 0 : skip).limit(limit).lean(),
    ProductUnit.countDocuments(filter)
  ]);
  const productIds = Array.from(new Set(rows.map((row) => String(row.productId || '')).filter(Boolean)));
  const products = productIds.length > 0
    ? await Product.find({ id: { $in: productIds } }, { id: 1, name: 1, sku: 1, brand: 1, attributes: 1, variants: 1 }).lean()
    : [];
  const productMap = new Map(products.map((row) => {
    const attrs = Array.isArray(row.attributes) ? row.attributes : [];
    const attrBrand = attrs.find((attr) => String(attr?.key || '').trim().toLowerCase() === 'brand' && String(attr?.value || '').trim());
    const variants = Array.isArray(row.variants) ? row.variants : [];
    return [String(row.id || row._id || ''), {
      name: row.name || '',
      sku: row.sku || '',
      brand: String(row.brand || attrBrand?.value || '').trim(),
      hasVariants: variants.length > 0,
      variantLabels: new Map(variants.map((variant) => [String(variant?.id || ''), String(variant?.label || '')]))
    }];
  }));
  return {
    rows: rows.map((row) => {
      const product = productMap.get(String(row.productId || '')) || {};
      const variantIdText = String(row.variantId || '').trim();
      const variantLabel = variantIdText
        ? (product.variantLabels?.get?.(variantIdText) || variantIdText)
        : (product.hasVariants ? 'Unassigned Variant' : '');
      return {
        ...row,
        productName: product.name || '',
        productSku: product.sku || '',
        productBrand: product.brand || '',
        variantLabel
      };
    }),
    total
  };
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
  // #region debug-point C:sell-serialized-load
  reportQueuedSalesImeiDebug({
    hypothesisId: 'C',
    location: 'productUnits.js:sellSerializedUnits:loaded',
    msg: '[DEBUG] Serialized units loaded for final sale marking',
    data: {
      saleId: String(saleId || ''),
      reservationToken: String(reservationToken || ''),
      requestedUnitIds: unitIds.map(String),
      foundCount: rows.length,
      rows: rows.map((row) => ({
        unitId: String(row?._id || ''),
        productId: String(row?.productId || ''),
        variantId: String(row?.variantId || ''),
        branchId: String(row?.branchId || ''),
        inventoryType: String(row?.inventoryType || ''),
        status: String(row?.status || ''),
        soldSaleId: String(row?.soldSaleId || ''),
        reservationToken: String(row?.reservationToken || ''),
        imei: String(row?.imei || ''),
        serialNumber: String(row?.serialNumber || '')
      }))
    }
  });
  // #endregion
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
  // #region debug-point C:sell-serialized-saved
  reportQueuedSalesImeiDebug({
    hypothesisId: 'C',
    location: 'productUnits.js:sellSerializedUnits:saved',
    msg: '[DEBUG] Serialized units saved as sold',
    data: {
      saleId: String(saleId || ''),
      reservationToken: String(reservationToken || ''),
      rows: rows.map((row) => ({
        unitId: String(row?._id || ''),
        branchId: String(row?.branchId || ''),
        inventoryType: String(row?.inventoryType || ''),
        status: String(row?.status || ''),
        soldSaleId: String(row?.soldSaleId || ''),
        imei: String(row?.imei || ''),
        serialNumber: String(row?.serialNumber || '')
      }))
    }
  });
  // #endregion
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
