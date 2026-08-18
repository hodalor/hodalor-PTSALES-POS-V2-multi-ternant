import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import Sale from '../models/Sale.js';
import Product from '../models/Product.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import Settings from '../models/Settings.js';
import Invoice from '../models/Invoice.js';
import Branch from '../models/Branch.js';
import Customer from '../models/Customer.js';
import CreditSale from '../models/CreditSale.js';
import ProductUnit from '../models/ProductUnit.js';
import WholesaleOperation from '../models/WholesaleOperation.js';
import TransferRequest from '../models/TransferRequest.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';
import { getMapQty, getStockTarget, markInventoryModified, resolveTierPrice, setMapQty } from '../utils/inventory.js';
import { makeInventoryLine, withInventoryAudit } from '../utils/inventoryAudit.js';
import { refreshCreditSaleStatus, updateCustomerCreditMetrics } from '../utils/credit.js';
import { normalizeTrackType, releaseSerializedUnits, sellSerializedUnits } from '../utils/productUnits.js';
import { safeErrorMessage, safeErrorStatus } from '../utils/safeError.js';
import { archiveLiveDocument } from '../utils/superBin.js';
import { enrichSalesWithAccounting } from '../utils/saleAccounting.js';
import { assertOutgoingAvailability } from '../utils/inTransitLocks.js';

const r = Router();

r.use(requireAuth);

function reportInTransitStockLockDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  const envCandidates = [
    path.resolve(process.cwd(), '.dbg', 'in-transit-stock-lock.env'),
    path.resolve(process.cwd(), '..', '.dbg', 'in-transit-stock-lock.env')
  ];
  let url = 'http://127.0.0.1:7777/event';
  let sessionId = 'in-transit-stock-lock';
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

async function summarizePendingInventoryLocks({ productId = '', variantId = '', branchId = '', inventoryType = 'retail', soldUnitIds = [] } = {}) {
  const wholesaleOps = await WholesaleOperation.find({
    status: { $in: ['pending_director', 'pending_manager'] },
    $or: [
      {
        operationType: 'transfer',
        fromBranchId: String(branchId || ''),
        fromInventoryType: String(inventoryType || 'retail'),
        items: { $elemMatch: { productId: String(productId || ''), variantId: String(variantId || ''), status: { $ne: 'cancelled' } } }
      },
      {
        operationType: 'adjustment',
        branchId: String(branchId || ''),
        fromInventoryType: String(inventoryType || 'retail'),
        items: { $elemMatch: { productId: String(productId || ''), variantId: String(variantId || ''), adjustmentType: 'decrease', status: { $ne: 'cancelled' } } }
      }
    ]
  }, {
    operationType: 1,
    status: 1,
    fromBranchId: 1,
    toBranchId: 1,
    branchId: 1,
    fromInventoryType: 1,
    toInventoryType: 1,
    items: 1
  }).limit(20).lean();
  const retailTransfers = await TransferRequest.find({
    status: { $in: ['pending_approval', 'pending_director', 'pending_manager'] },
    from: String(branchId || ''),
    items: { $elemMatch: { productId: String(productId || ''), variantId: String(variantId || ''), status: { $ne: 'cancelled' } } }
  }, {
    status: 1,
    from: 1,
    to: 1,
    items: 1
  }).limit(20).lean();
  const serializedRows = soldUnitIds.length > 0
    ? await ProductUnit.find({ _id: { $in: soldUnitIds.map(String) } }, { _id: 1, status: 1, reservationToken: 1, branchId: 1, inventoryType: 1, soldSaleId: 1, imei: 1, serialNumber: 1 }).lean()
    : [];
  return {
    wholesaleOps: wholesaleOps.map((row) => ({
      id: String(row?._id || ''),
      operationType: String(row?.operationType || ''),
      status: String(row?.status || ''),
      fromBranchId: String(row?.fromBranchId || row?.branchId || ''),
      toBranchId: String(row?.toBranchId || ''),
      fromInventoryType: String(row?.fromInventoryType || ''),
      lockedQty: (Array.isArray(row?.items) ? row.items : []).filter((item) => (
        String(item?.productId || '') === String(productId || '')
        && String(item?.variantId || '') === String(variantId || '')
        && String(item?.status || 'accepted').toLowerCase() !== 'cancelled'
        && (
          String(row?.operationType || '') !== 'adjustment'
          || String(item?.adjustmentType || '').toLowerCase() === 'decrease'
        )
      )).reduce((sum, item) => sum + Math.max(0, Number(item?.qty || 0)), 0),
      lockedUnitIds: (Array.isArray(row?.items) ? row.items : []).flatMap((item) => (
        String(item?.productId || '') === String(productId || '')
          && String(item?.variantId || '') === String(variantId || '')
          && String(item?.status || 'accepted').toLowerCase() !== 'cancelled'
          ? (Array.isArray(item?.unitIds) ? item.unitIds.map(String) : [])
          : []
      ))
    })),
    retailTransfers: retailTransfers.map((row) => ({
      id: String(row?._id || ''),
      status: String(row?.status || ''),
      fromBranchId: String(row?.from || ''),
      toBranchId: String(row?.to || ''),
      lockedQty: (Array.isArray(row?.items) ? row.items : []).filter((item) => (
        String(item?.productId || '') === String(productId || '')
        && String(item?.variantId || '') === String(variantId || '')
        && String(item?.status || 'accepted').toLowerCase() !== 'cancelled'
      )).reduce((sum, item) => sum + Math.max(0, Number(item?.qty || 0)), 0),
      lockedUnitIds: (Array.isArray(row?.items) ? row.items : []).flatMap((item) => (
        String(item?.productId || '') === String(productId || '')
          && String(item?.variantId || '') === String(variantId || '')
          && String(item?.status || 'accepted').toLowerCase() !== 'cancelled'
          ? (Array.isArray(item?.unitIds) ? item.unitIds.map(String) : [])
          : []
      ))
    })),
    serializedRows: serializedRows.map((row) => ({
      id: String(row?._id || ''),
      status: String(row?.status || ''),
      reservationToken: String(row?.reservationToken || ''),
      branchId: String(row?.branchId || ''),
      inventoryType: String(row?.inventoryType || ''),
      soldSaleId: String(row?.soldSaleId || ''),
      code: String(row?.imei || row?.serialNumber || '')
    }))
  };
}

function escapeRegex(text = '') {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBranchIds(value) {
  if (value === 'all') return 'all';
  return Array.from(new Set(
    (Array.isArray(value) ? value : [value])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function productLookupQuery(productId) {
  const pid = String(productId || '');
  const or = [{ id: pid }];
  if (mongoose.isValidObjectId(pid)) or.unshift({ _id: pid });
  return { $or: or };
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function canBackdateSales(req) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'superadmin' || role === 'admin') return true;
  const grants = Array.isArray(req.user?.grants) ? req.user.grants : [];
  return grants.includes('backdate_sales');
}

function resolveSaleTimestamps(payload = {}, req) {
  const recordedAt = new Date();
  const clientId = String(payload.clientId || '').trim();
  const clientCapturedAt = parseTimestamp(payload.saleCapturedAt)
    || (clientId.startsWith('offline-sale-') ? parseTimestamp(payload.created_at) : null);
  const saleCapturedAt = clientCapturedAt || recordedAt;
  const requestedBackdateAt = parseTimestamp(payload.saleDateTime);
  if (requestedBackdateAt) {
    if (!canBackdateSales(req)) {
      const err = new Error('Not authorized to backdate sales');
      err.status = 403;
      throw err;
    }
    return {
      recordedAt,
      saleCapturedAt,
      effectiveSaleAt: requestedBackdateAt,
      isBackdated: Math.abs(requestedBackdateAt.getTime() - saleCapturedAt.getTime()) > 1000,
      backdatedByName: String(req.user?.name || '').trim()
    };
  }
  return {
    recordedAt,
    saleCapturedAt,
    effectiveSaleAt: saleCapturedAt,
    isBackdated: false,
    backdatedByName: ''
  };
}

function computeSaleItemsSubtotal(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + (Number(item?.price || 0) * Math.max(0, Number(item?.qty || 0)))
  ), 0);
}

function computeSaleItemsCostTotal(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + (Math.max(0, Number(item?.costPrice || 0)) * Math.max(0, Number(item?.qty || 0)))
  ), 0);
}

function normalizeSaleFinancials(row = {}) {
  const itemsSubtotal = computeSaleItemsSubtotal(row.items);
  const storedSubtotal = Number(row?.subtotal);
  const hasStoredSubtotal = Number.isFinite(storedSubtotal) && (storedSubtotal !== 0 || itemsSubtotal === 0);
  const subtotal = hasStoredSubtotal ? storedSubtotal : itemsSubtotal;
  const discount = Math.max(0, Number(row?.discount || 0));
  const tax = Math.max(0, Number(row?.tax || 0));
  const storedTotal = Number(row?.total);
  const computedTotal = subtotal - discount + tax;
  const hasStoredTotal = Number.isFinite(storedTotal) && (storedTotal !== 0 || computedTotal === 0);
  const total = hasStoredTotal ? storedTotal : computedTotal;
  const itemCostTotal = computeSaleItemsCostTotal(row.items);
  const storedCostTotal = Number(row?.costTotal);
  const hasStoredCostTotal = Number.isFinite(storedCostTotal) && (storedCostTotal !== 0 || itemCostTotal === 0);
  const costTotal = hasStoredCostTotal ? storedCostTotal : itemCostTotal;
  const storedProfitTotal = Number(row?.profitTotal);
  const shouldRecomputeProfit = !Number.isFinite(storedProfitTotal)
    || (!hasStoredTotal && total !== 0);
  const profitTotal = shouldRecomputeProfit ? (total - costTotal) : storedProfitTotal;
  return {
    ...row,
    subtotal,
    total,
    costTotal,
    profitTotal
  };
}

r.get('/', requireRoleOrPerm(['Admin','Manager','Cashier'], ['view_sales','see_sales']), async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  const grants = Array.isArray(req.user?.grants) ? req.user.grants : [];
  const query = {};
  const assigned = normalizeBranchIds(req.user?.assignedBranches);
  if (role !== 'superadmin' && role !== 'admin' && assigned !== 'all') {
    const branchIds = normalizeBranchIds([req.user?.branchId, ...(Array.isArray(assigned) ? assigned : [])]);
    if (branchIds.length > 0) query.branchId = { $in: branchIds };
  }
  const canViewCashierCompetitionAll = grants.includes('view_dashboard_cashier_all') || grants.includes('view_dashboard_branch_comparison_all');
  const canViewCashierCompetitionAssigned = canViewCashierCompetitionAll || grants.includes('view_dashboard_cashier_assigned') || grants.includes('view_dashboard_branch_comparison_assigned');
  if (role === 'cashier' && !canViewCashierCompetitionAssigned) {
    query.sellerName = new RegExp(`^${escapeRegex(String(req.user?.name || '').trim())}$`, 'i');
  }
  if (role === 'cashier' && canViewCashierCompetitionAssigned && !canViewCashierCompetitionAll) {
    const branchIds = assigned === 'all'
      ? normalizeBranchIds(req.user?.branchId)
      : normalizeBranchIds([req.user?.branchId, ...assigned]);
    if (branchIds.length > 0) query.branchId = { $in: branchIds };
  }
  if (req.query.branchId) {
    const requestedBranchId = String(req.query.branchId);
    const allowedBranchIds = Array.isArray(query.branchId?.$in) ? query.branchId.$in.map(String) : null;
    if (allowedBranchIds && !allowedBranchIds.includes(requestedBranchId)) return res.json([]);
    query.branchId = requestedBranchId;
  }
  const wantsAll = ['1', 'true', 'yes'].includes(String(req.query.all || '').trim().toLowerCase());
  const limit = Math.min(50000, Math.max(1, Number(req.query.limit || 500)));
  let salesQuery = Sale.find(query).sort({ created_at: -1 });
  if (!wantsAll) salesQuery = salesQuery.limit(limit);
  const rows = await salesQuery.lean();
  const enriched = await enrichSalesWithAccounting(rows.map(normalizeSaleFinancials));
  res.json(enriched);
});

r.post('/bulk-delete', async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, count: 0 });
  const objectIds = ids.filter(id => mongoose.isValidObjectId(id));
  const query = {
    $or: [
      { clientId: { $in: ids } },
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : [])
    ]
  };
  const rows = await Sale.find(query).lean();
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
  for (const row of rows) {
    await archiveLiveDocument({
      req,
      tenantId,
      entityType: 'sale',
      collectionName: 'sales',
      doc: row
    });
  }
  const result = await Sale.deleteMany(query);
  res.json({ ok: true, count: Number(result?.deletedCount || 0) });
});

r.patch('/:id/date', requireRoleOrPerm(['Admin'], 'backdate_sales'), async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing sale id' });
  const nextDate = parseTimestamp(req.body?.saleDateTime || req.body?.created_at);
  if (!nextDate) return res.status(400).json({ error: 'Invalid sale date/time' });
  if (nextDate.getTime() > Date.now()) {
    return res.status(400).json({ error: 'Sale date/time cannot be in the future' });
  }
  const query = mongoose.isValidObjectId(id)
    ? { $or: [{ _id: id }, { clientId: id }] }
    : { clientId: id };
  const sale = await Sale.findOne(query);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const previousEffectiveDate = sale.created_at || null;
  sale.created_at = nextDate;
  sale.isBackdated = !!sale.saleCapturedAt && Math.abs(nextDate.getTime() - new Date(sale.saleCapturedAt).getTime()) > 1000;
  sale.backdatedByName = String(req.user?.name || '').trim();
  if (!sale.recordedAt) sale.recordedAt = new Date();
  if (!sale.saleCapturedAt) sale.saleCapturedAt = sale.recordedAt;
  await sale.save();
  await Invoice.updateMany({ saleId: String(sale._id) }, { $set: { date: nextDate } }).catch(() => {});
  await Audit.create({
    actor: String(req.user?.name || sale.sellerName || 'unknown').trim() || 'unknown',
    actionType: 'sale_backdate_edit',
    details: {
      saleId: String(sale._id),
      invoiceSerial: sale.invoiceSerial || '',
      receiptNumber: sale.receiptNumber || '',
      previousDate: previousEffectiveDate,
      effectiveDate: sale.created_at || null
    },
    branchId: sale.branchId,
    ts: new Date()
  }).catch(() => {});
  res.json(normalizeSaleFinancials(sale?.toObject ? sale.toObject() : sale));
});

r.patch('/:id/credit-package', requireRoleOrPerm(['Admin'], 'backdate_sales'), async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing sale id' });
  const query = mongoose.isValidObjectId(id)
    ? { $or: [{ _id: id }, { clientId: id }] }
    : { $or: [{ id }, { clientId: id }] };
  const sale = await Sale.findOne(query);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const creditMode = String(sale.creditMode || '').trim().toLowerCase();
  if (!creditMode || creditMode === 'none' || creditMode === 'non_credit') {
    return res.status(400).json({ error: 'Only credit sales can change credit package' });
  }
  const nextPackageName = String(req.body?.creditPackageName || '').trim();
  if (!nextPackageName) return res.status(400).json({ error: 'Credit package name is required' });
  const nextPackageId = String(req.body?.creditPackageId || '').trim()
    || nextPackageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const previousPackageName = String(sale.creditPackageName || '').trim();
  const previousPackageId = String(sale.creditPackageId || '').trim();
  sale.creditPackageName = nextPackageName;
  sale.creditPackageId = nextPackageId;
  await sale.save();
  if (String(sale.creditSaleId || '').trim()) {
    await CreditSale.findByIdAndUpdate(String(sale.creditSaleId), {
      creditPackageName: nextPackageName,
      creditPackageId: nextPackageId
    }).catch(() => null);
  }
  await Audit.create({
    actor: String(req.user?.name || sale.sellerName || 'unknown').trim() || 'unknown',
    actionType: 'sale_credit_package_edit',
    details: {
      saleId: String(sale._id),
      invoiceSerial: sale.invoiceSerial || '',
      previousPackageName,
      nextPackageName,
      previousPackageId,
      nextPackageId
    },
    branchId: sale.branchId,
    ts: new Date()
  }).catch(() => {});
  res.json(normalizeSaleFinancials(sale?.toObject ? sale.toObject() : sale));
});

r.post('/', requireRoleOrPerm(['Admin','Manager','Cashier'], 'add_sales'), async (req, res) => {
  const payload = req.body || {};
  let saleTimes;
  try {
    saleTimes = resolveSaleTimestamps(payload, req);
  } catch (e) {
    return res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to validate sale date/time') });
  }
  const branchId = String(payload.branchId || '');
  if (!branchId) return res.status(400).json({ error: 'Missing branchId' });
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) return res.status(400).json({ error: 'Sale must include items' });
  const posType = String(payload.posType || 'retail').toLowerCase() === 'wholesale' ? 'wholesale' : 'retail';
  const inventoryType = String(payload.inventoryType || (posType === 'wholesale' ? 'wholesale' : 'retail')).toLowerCase() === 'wholesale' ? 'wholesale' : 'retail';
  const allowedPriceTiers = new Set(['retail', 'wholesale', 'agent']);
  const defaultPriceTier = allowedPriceTiers.has(String(payload.defaultPriceTier || '').toLowerCase())
    ? String(payload.defaultPriceTier || '').toLowerCase()
    : (posType === 'wholesale' ? 'wholesale' : 'retail');
  const creditPayload = payload.creditSale && payload.creditSale.enabled ? payload.creditSale : null;
  const clientId = String(payload.clientId || '').trim();
  if (clientId) {
    const existing = await Sale.findOne({ clientId });
    if (existing) return res.json(existing);
  }
  const cleaned = items.map(it => ({
    productId: it.productId,
    variantId: it.variantId || null,
    qty: Math.abs(Number(it.qty) || 0),
    soldUnitIds: Array.isArray(it.soldUnitIds) ? it.soldUnitIds.map(String).filter(Boolean) : [],
    sku: it.sku || '',
    name: it.name || '',
    spec: it.spec || '',
    requestedPrice: Number(it.price || 0),
    priceTier: allowedPriceTiers.has(String(it.priceTier || '').toLowerCase()) ? String(it.priceTier || '').toLowerCase() : defaultPriceTier
  }));
  if (cleaned.some(it => !it.productId || !Number.isFinite(it.qty) || it.qty <= 0)) {
    return res.status(400).json({ error: 'Each item must include productId and positive qty' });
  }

  let customerId = String(payload.customerId || '').trim();
  let customerCode = String(payload.customerCode || '').trim();
  let customerName = String(payload.customerName || '').trim();
  let customerPhone = String(payload.customerPhone || '').trim();
  let customerDoc = null;
  if (customerId || customerCode) {
    let cust = null;
    if (customerId) {
      if (mongoose.isValidObjectId(customerId)) cust = await Customer.findById(customerId);
      else cust = await Customer.findOne({ clientId: customerId });
      customerId = cust ? String(cust._id) : '';
    } else {
      cust = await Customer.findOne({ customerCode });
      customerId = cust ? String(cust._id) : '';
    }
    if (!cust) return res.status(400).json({ error: 'Customer not found' });
    customerDoc = cust;
    customerCode = String(cust.customerCode || customerCode || '');
    customerName = String(cust.name || customerName || '');
    customerPhone = String(cust.phone || customerPhone || '');
  } else {
    customerId = '';
    customerCode = '';
    customerName = '';
    customerPhone = '';
  }

  let branchCode = branchId;
  try {
    const b = await Branch.findOne({ id: branchId });
    if (b?.code) branchCode = b.code;
  } catch {}

  let invoiceNum = 1;
  let receiptNum = 1;
  let invoicePrefix = 'INV';
  let receiptPrefix = 'RCPT';
  let settingsData = {};
  try {
    const updated = await Settings.findOneAndUpdate(
      { key: 'default' },
      { $inc: { 'data.nextInvoiceNumber': 1, 'data.nextReceiptNumber': 1 } },
      { new: true, upsert: true }
    );
    settingsData = updated?.data || {};
    invoicePrefix = String(settingsData.invoicePrefix || 'INV');
    receiptPrefix = String(settingsData.receiptPrefix || 'RCPT');
    invoiceNum = Math.max(1, Number(settingsData.nextInvoiceNumber || 1) - 1);
    receiptNum = Math.max(1, Number(settingsData.nextReceiptNumber || 1) - 1);
  } catch {
    // keep defaults
  }

  const invoiceSerial = `${invoicePrefix}-${branchCode}-${String(invoiceNum).padStart(6,'0')}`;
  const receiptNumber = `${receiptPrefix}-${branchCode}-${String(receiptNum).padStart(6,'0')}`;

  const touched = [];
  let costTotal = 0;
  const finalItems = [];
  const touchedSerializedUnits = [];
  try {
    for (const it of cleaned) {
      const p = await Product.findOne(productLookupQuery(it.productId));
      if (!p) {
        const err = new Error(`Product not found: ${it.productId}`);
        err.status = 400;
        throw err;
      }
      const variant = it.variantId && Array.isArray(p.variants)
        ? p.variants.find(v => String(v.id) === String(it.variantId))
        : null;
      if (it.variantId && !variant) {
        const err = new Error(`Variant not found for product ${p.name}`);
        err.status = 400;
        throw err;
      }
      if (normalizeTrackType(p.trackType) === 'serialized') {
        if (it.soldUnitIds.length !== it.qty) {
          const err = new Error(`Serialized product ${p.name} requires ${it.qty} unit selection(s)`);
          err.status = 400;
          throw err;
        }
        const rows = await ProductUnit.find({
          _id: { $in: it.soldUnitIds },
          productId: String(p.id || p._id),
          variantId: String(it.variantId || ''),
          branchId,
          inventoryType
        });
        if (rows.length !== it.soldUnitIds.length) {
          const err = new Error(`Some serialized units were not found for ${p.name}`);
          err.status = 400;
          throw err;
        }
        rows.forEach(row => {
          if (row.status === 'sold') {
            const err = new Error(`Serialized unit already sold: ${row.imei || row.serialNumber}`);
            err.status = 409;
            throw err;
          }
          touchedSerializedUnits.push(String(row._id));
        });
        await assertOutgoingAvailability({
          product: p,
          productId: String(p.id || p._id || it.productId),
          variantId: String(it.variantId || ''),
          branchId,
          inventoryType,
          qty: it.qty,
          unitIds: it.soldUnitIds,
          purpose: 'sale'
        });
      }
      const target = getStockTarget(p, it.variantId, inventoryType);
      if (!target) {
        const err = new Error(`Inventory target not found for ${p.name}`);
        err.status = 400;
        throw err;
      }
      const prev = getMapQty(target.container, branchId);
      const pendingLocks = await summarizePendingInventoryLocks({
        productId: String(p.id || p._id || it.productId),
        variantId: String(it.variantId || ''),
        branchId,
        inventoryType,
        soldUnitIds: it.soldUnitIds
      });
      // #region debug-point A:sale-stock-check
      reportInTransitStockLockDebug({
        hypothesisId: 'A',
        location: 'sales.js:post:stock-check',
        msg: '[DEBUG] Sale stock check evaluated against pending transfer/adjustment locks',
        data: {
          seller: String(req.user?.name || req.user?.username || ''),
          branchId: String(branchId || ''),
          inventoryType: String(inventoryType || ''),
          productId: String(p.id || p._id || ''),
          productName: String(p.name || ''),
          variantId: String(it.variantId || ''),
          qtyRequested: Number(it.qty || 0),
          currentStock: Number(prev || 0),
          soldUnitIds: Array.isArray(it.soldUnitIds) ? it.soldUnitIds.map(String) : [],
          pendingLocks
        }
      });
      // #endregion
      await assertOutgoingAvailability({
        product: p,
        productId: String(p.id || p._id || it.productId),
        variantId: String(it.variantId || ''),
        branchId,
        inventoryType,
        qty: it.qty,
        unitIds: it.soldUnitIds,
        purpose: 'sale'
      });
      if (prev < it.qty) {
        const label = variant?.label ? `${p.name} (${variant.label})` : p.name;
        const err = new Error(`Insufficient ${inventoryType} stock for ${label} at ${branchCode}`);
        err.status = 400;
        throw err;
      }
      touched.push({ target, branchId, prev });
      setMapQty(target.container, branchId, Math.max(0, prev - it.qty));
      markInventoryModified(target);
      await p.save();
      const cp = variant?.costPrice != null ? Number(variant.costPrice || 0) : Number(p.costPrice || 0);
      if (Number.isFinite(cp) && cp > 0) costTotal += cp * it.qty;
      const requestedPrice = Math.max(0, Number(it.requestedPrice || 0));
      const itemPrice = requestedPrice > 0
        ? requestedPrice
        : resolveTierPrice(
            variant || p,
            it.priceTier,
            resolveTierPrice(p, it.priceTier, Number(p.retailPrice || p.price || 0))
          );
      finalItems.push({
        productId: it.productId,
        variantId: it.variantId || null,
        qty: it.qty,
        soldUnitIds: it.soldUnitIds,
        sku: it.sku || variant?.sku || p.sku || '',
        name: it.name || (variant?.label ? `${p.name} (${variant.label})` : p.name),
        spec: it.spec || '',
        priceTier: it.priceTier,
        price: itemPrice,
        costPrice: Number.isFinite(cp) ? cp : 0
      });
    }
  } catch (e) {
    try {
      for (let i = touched.length - 1; i >= 0; i--) {
        const t = touched[i];
        setMapQty(t.target.container, t.branchId, t.prev);
        markInventoryModified(t.target);
        await t.target.product.save();
      }
    } catch {}
    return res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to apply sale stock changes') });
  }

  let sale;
  let customerPointsAfter = null;
  let creditSale = null;
  try {
    function badRequest(message) {
      const err = new Error(message);
      err.status = 400;
      throw err;
    }
    const subtotal = finalItems.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 0)), 0);
    const discount = Math.max(0, Number(payload.discount || 0));
    const tax = Math.max(0, Number(payload.tax || 0));
    const revenueTotal = Math.max(0, subtotal - discount + tax);
    const profitTotal = revenueTotal - Number(costTotal || 0);
    const loyaltyEnabled = !!settingsData.loyaltyEnabled;
    const earnAmount = Number(settingsData.loyaltyEarnAmount || 0);
    const earnPoints = Number(settingsData.loyaltyEarnPoints || 0);
    const redeemValue = Number(settingsData.loyaltyRedeemValue || 0);
    const minRedeemPoints = Math.max(0, Number(settingsData.loyaltyMinRedeemPoints || 0));
    const maxRedeemPercent = Math.max(0, Math.min(100, Number(settingsData.loyaltyMaxRedeemPercent ?? 50)));

    const earned = (loyaltyEnabled && earnAmount > 0 && earnPoints > 0)
      ? Math.max(0, Math.floor(revenueTotal / earnAmount) * earnPoints)
      : 0;

    let redeemed = 0;
    let loyaltyDiscount = 0;
    if (loyaltyEnabled && customerId) {
      const reqRedeemed = Math.max(0, Math.floor(Number(payload.loyaltyPointsRedeemed || 0)));
      if (reqRedeemed > 0) {
        if (reqRedeemed < minRedeemPoints) badRequest(`Minimum redeem is ${minRedeemPoints} point(s)`);
        const cust = await Customer.findById(customerId);
        if (!cust) badRequest('Customer not found');
        const bal = Math.max(0, Math.floor(Number(cust.loyaltyPoints || 0)));
        redeemed = Math.min(reqRedeemed, bal);
        loyaltyDiscount = Math.max(0, redeemed * (Number.isFinite(redeemValue) ? redeemValue : 0));
        const cap = revenueTotal * (maxRedeemPercent / 100);
        if (loyaltyDiscount > cap) {
          loyaltyDiscount = cap;
          redeemed = redeemValue > 0 ? Math.floor(loyaltyDiscount / redeemValue) : 0;
        }
        const disc = Number(payload.discount || 0);
        if (disc + 0.0001 < loyaltyDiscount) badRequest('Discount is less than loyalty discount');
      }
    }

    const payments = Array.isArray(payload.payment_methods)
      ? payload.payment_methods.map(p => ({ type: String(p.type || ''), amount: Math.max(0, Number(p.amount || 0)) }))
      : [];
    const paidOutsideCredit = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    if (!creditPayload && paidOutsideCredit + 0.0001 < revenueTotal) {
      badRequest('Payment incomplete');
    }
    let creditUpfront = 0;
    let creditDueDate = null;
    if (creditPayload) {
      if (!customerId || !customerDoc) badRequest('EasyBuy requires a registered customer');
      creditUpfront = Math.max(0, Math.min(revenueTotal, Number(creditPayload.amountPaidNow || 0)));
      if (Math.abs(paidOutsideCredit - creditUpfront) > 0.005) {
        badRequest('Credit sale payment methods must match the amount paid now');
      }
      creditDueDate = creditPayload.dueDate ? new Date(creditPayload.dueDate) : null;
      if (!creditDueDate || Number.isNaN(creditDueDate.getTime())) badRequest('EasyBuy due date is required');
      const selectedSaleAt = parseTimestamp(payload.saleDateTime || payload.created_at) || new Date();
      const effectiveSaleAt = selectedSaleAt;
      const saleDayStart = new Date(effectiveSaleAt.getFullYear(), effectiveSaleAt.getMonth(), effectiveSaleAt.getDate());
      const dueDayStart = new Date(creditDueDate.getFullYear(), creditDueDate.getMonth(), creditDueDate.getDate());
      if (dueDayStart.getTime() < saleDayStart.getTime()) {
        badRequest('EasyBuy due date cannot be earlier than the sale date');
      }
      const globalPercent = Math.max(0, Math.min(100, Number(settingsData.minimumUpfrontPaymentPercent || 0)));
      const globalFixed = Math.max(0, Number(settingsData.minimumUpfrontPaymentFixed || 0));
      let requiredUpfront = Math.max(revenueTotal * (globalPercent / 100), globalFixed);
      for (const item of finalItems) {
        const product = await Product.findOne(productLookupQuery(item.productId));
        const pct = Math.max(0, Math.min(100, Number(product?.minimumCreditPercentage || 0)));
        if (product?.allowCredit === false) {
          badRequest(`${product.name} is not eligible for credit sales`);
        }
        requiredUpfront = Math.max(requiredUpfront, (Number(item.price || 0) * Number(item.qty || 0)) * (pct / 100));
      }
      requiredUpfront = Math.min(revenueTotal, requiredUpfront);
      if (creditUpfront + 0.0001 < requiredUpfront) {
        badRequest(`Minimum upfront payment is ${requiredUpfront.toFixed(2)}`);
      }
      const maxCreditLimit = Math.max(0, Number(customerDoc.maxCreditLimit || settingsData.maxCreditLimitPerCustomer || 0));
      const requestedBalance = Math.max(0, revenueTotal - creditUpfront);
      if (maxCreditLimit > 0 && (Number(customerDoc.outstandingBalance || 0) + requestedBalance) > maxCreditLimit) {
        badRequest('Customer exceeds the configured credit limit');
      }
    }

    const defaultCreditPackageName = posType === 'wholesale' ? 'Credit Sale' : 'Credit';
    const creditPackageId = creditPayload ? String(payload.creditPackageId || '').trim() : '';
    const creditPackageName = creditPayload
      ? (String(payload.creditPackageName || '').trim() || defaultCreditPackageName)
      : '';
    sale = await Sale.create({
      ...payload,
      posType,
      inventoryType,
      defaultPriceTier,
      items: finalItems,
      customerId: customerId || undefined,
      customerCode: customerCode || undefined,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      subtotal,
      discount,
      tax,
      total: revenueTotal,
      payment_methods: payments,
      creditMode: creditPayload
        ? (posType === 'wholesale' ? 'distribution_credit' : 'retail_easybuy')
        : 'none',
      creditPackageId,
      creditPackageName,
      invoiceSerial,
      receiptNumber,
      creditDueDate: creditPayload ? creditDueDate : undefined,
      creditAmountPaidNow: creditPayload ? creditUpfront : 0,
      creditBalance: creditPayload ? Math.max(0, revenueTotal - creditUpfront) : 0,
      costTotal: Number(costTotal || 0),
      profitTotal: Number(profitTotal || 0),
      loyaltyPointsEarned: earned,
      loyaltyPointsRedeemed: redeemed,
      loyaltyDiscount: loyaltyDiscount,
      recordedAt: saleTimes.recordedAt,
      saleCapturedAt: saleTimes.saleCapturedAt,
      created_at: saleTimes.effectiveSaleAt,
      isBackdated: saleTimes.isBackdated,
      backdatedByName: saleTimes.backdatedByName
    });
    if (touchedSerializedUnits.length > 0) {
      const soldRows = await sellSerializedUnits({
        unitIds: touchedSerializedUnits,
        reservationToken: String(payload.reservationToken || ''),
        saleId: String(sale._id)
      });
      const soldById = new Map(soldRows.map(row => [String(row._id), row]));
      sale.items = sale.items.map(item => ({
        ...(item?.toObject ? item.toObject() : item),
        soldUnits: Array.isArray(item.soldUnitIds)
          ? item.soldUnitIds.map(unitId => {
              const row = soldById.get(String(unitId));
              return row ? { unitId: String(row._id), imei: row.imei || '', serialNumber: row.serialNumber || '' } : null;
            }).filter(Boolean)
          : []
      }));
      await sale.save();
    }
    if (creditPayload) {
      creditSale = await CreditSale.create({
        customer_id: customerId,
        saleId: String(sale._id),
        branchId,
        posType,
        inventoryType,
        creditPackageId,
        creditPackageName,
        items: finalItems.map(item => ({
          productId: item.productId,
          variantId: item.variantId || '',
          sku: item.sku || '',
          name: item.name || '',
          qty: Number(item.qty || 0),
          price: Number(item.price || 0),
          priceTier: item.priceTier || defaultPriceTier
        })),
        total_amount: revenueTotal,
        amount_paid: creditUpfront,
        balance: Math.max(0, revenueTotal - creditUpfront),
        due_date: creditDueDate,
        penalty_per_day: Math.max(0, Number(settingsData.penaltyPerDay || 0)),
        status: 'active'
      });
      await refreshCreditSaleStatus(creditSale);
      sale.creditSaleId = String(creditSale._id);
      await sale.save();
      await updateCustomerCreditMetrics(customerId);
    }
    if (loyaltyEnabled && customerId && !creditPayload && (earned !== 0 || sale.loyaltyPointsRedeemed !== 0)) {
      const updated = await Customer.findByIdAndUpdate(
        customerId,
        { $inc: { loyaltyPoints: Number(earned || 0) - Number(sale.loyaltyPointsRedeemed || 0) } },
        { new: true }
      );
      customerPointsAfter = updated ? Number(updated.loyaltyPoints || 0) : null;
    }
  } catch (e) {
    try {
      for (let i = touched.length - 1; i >= 0; i--) {
        const t = touched[i];
        setMapQty(t.target.container, t.branchId, t.prev);
        markInventoryModified(t.target);
        await t.target.product.save();
      }
      if (touchedSerializedUnits.length > 0) {
        await releaseSerializedUnits({ unitIds: touchedSerializedUnits, reservationToken: String(payload.reservationToken || '') });
      }
    } catch {}
    return res.status(safeErrorStatus(e)).json({ error: safeErrorMessage(e, 'Failed to create sale') });
  }

  await Audit.create({
    actor: sale.sellerName || 'unknown',
    actionType: posType === 'wholesale' ? 'stock_wholesale_sale_deduct' : 'stock_sale_deduct',
    details: withInventoryAudit(
      {
        items: sale.items.map(i => ({ sku: i.sku, qty: i.qty, productId: i.productId || null, variantId: i.variantId || null, priceTier: i.priceTier || defaultPriceTier })),
        invoiceSerial,
        receiptNumber,
        saleCapturedAt: sale.saleCapturedAt || null,
        saleEffectiveAt: sale.created_at || null,
        isBackdated: !!sale.isBackdated,
        inventoryType,
        posType
      },
      sale.items.map((item) => makeInventoryLine({
        productId: item.productId || '',
        productName: item.name || item.productId || '',
        variantId: item.variantId || '',
        branchId: sale.branchId,
        inventoryType,
        delta: -Math.abs(Number(item.qty || 0)),
        remark: receiptNumber
      }))
    ),
    branchId: sale.branchId,
    ts: new Date()
  });
  try {
    await ServerLog.create({
      level: 'info',
      actor: sale.sellerName || req.user?.name || 'unknown',
      route: '/api/sales',
      method: 'POST',
      status: 200,
      message: `Sale ${sale._id}: ${Array.isArray(sale.items) ? sale.items.map(i => `${i.sku || i.productId} x${i.qty}`).join(', ') : 'items'} @ ${sale.branchId}`,
      details: { invoiceSerial, receiptNumber }
    });
  } catch {}
  const out = normalizeSaleFinancials(sale?.toObject ? sale.toObject() : sale);
  if (customerPointsAfter != null) out.customerPointsAfter = customerPointsAfter;
  if (creditSale) out.creditSale = creditSale;
  try {
    const payTerms = Array.isArray(sale.payment_methods) ? sale.payment_methods.map(p => {
      const t = String(p.type || '').toLowerCase();
      if (t === 'cash') return 'Cash';
      if (t === 'card') return 'Card';
      if (t === 'mobile' || t === 'momo' || t === 'mobile money') return 'Mobile Money';
      if (t === 'wallet') return 'Wallet';
      if (t === 'easybuy') return 'EasyBuy';
      return t ? (t[0].toUpperCase() + t.slice(1)) : 'Cash';
    }).join(', ') : 'Cash';
    await Invoice.create({
      number: sale.invoiceSerial || '',
      date: sale.created_at || new Date(),
      saleId: String(sale._id),
      source: posType === 'wholesale' ? 'wholesale-pos' : 'pos',
      paymentStatus: creditSale ? (Number(creditSale.balance || 0) > 0 ? 'active' : 'paid') : 'paid',
      customer: {
        name: sale.customerName || '',
        phone: sale.customerPhone || '',
        customerCode: sale.customerCode || '',
        customerId: sale.customerId || ''
      },
      items: (sale.items || []).map(i => ({ name: i.name, spec: i.spec || '', qty: i.qty, rate: i.price, per: 'pcs' })),
      subtotal: Number(sale.subtotal || 0),
      tax: Number(sale.tax || 0),
      total: Number(sale.total || 0),
      deliveryNote: 'Physical',
      paymentTerms: payTerms,
      despatchedThrough: 'In person'
    });
  } catch {}
  res.json(out);
});

export default r;
