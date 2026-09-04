import { Router } from 'express';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import CreditRepayment from '../models/CreditRepayment.js';
import CreditSale from '../models/CreditSale.js';
import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';
import Approval from '../models/Approval.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { createApprovalForReference } from '../utils/approvalWorkflow.js';
import { computeCreditStatus, customerRankFromScore, refreshCreditSaleStatus, updateCustomerCreditMetrics } from '../utils/credit.js';
import { archiveLiveDocument } from '../utils/superBin.js';

const r = Router();

r.use(requireAuth);

function reportCreditDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  const envCandidates = [
    path.resolve(process.cwd(), '.dbg', 'credit-active-sales-list.env'),
    path.resolve(process.cwd(), '..', '.dbg', 'credit-active-sales-list.env')
  ];
  let url = 'http://127.0.0.1:7777/event';
  let sessionId = 'credit-active-sales-list';
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

async function getPendingRepaymentAmount(creditSaleId) {
  if (!creditSaleId) return 0;
  const rows = await CreditRepayment.find({
    creditSaleId: String(creditSaleId),
    status: { $in: ['pending_director', 'pending_manager'] }
  }).select('amount').lean();
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row?.amount || 0)), 0);
}

function normalizeRepaymentMethod(value) {
  return ['cash', 'card', 'mobile', 'wallet'].includes(String(value || '').trim().toLowerCase())
    ? String(value || '').trim().toLowerCase()
    : 'cash';
}

function buildRepaymentClientId({ creditSaleId = '', amount = 0, paymentMethod = 'cash', remark = '', paidDate = null } = {}) {
  const amountKey = Number(amount || 0).toFixed(2);
  const dateValue = paidDate ? new Date(paidDate) : new Date();
  const safeDate = Number.isNaN(dateValue.getTime()) ? new Date() : dateValue;
  const dayKey = `${safeDate.getFullYear()}-${String(safeDate.getMonth() + 1).padStart(2, '0')}-${String(safeDate.getDate()).padStart(2, '0')}`;
  const remarkKey = String(remark || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
  return [
    'credit-repayment',
    String(creditSaleId || '').trim(),
    amountKey,
    normalizeRepaymentMethod(paymentMethod),
    dayKey,
    remarkKey
  ].join(':');
}

function normalizeBranchIds(value) {
  if (value === 'all') return 'all';
  return Array.from(new Set(
    (Array.isArray(value) ? value : [value])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function getAccessibleBranchIds(user = {}) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'superadmin' || role === 'admin') return 'all';
  const assigned = normalizeBranchIds(user?.assignedBranches);
  if (assigned === 'all') return 'all';
  return normalizeBranchIds([user?.branchId, ...(Array.isArray(assigned) ? assigned : [])]);
}

function buildCustomerLookupQuery(customerIds = []) {
  const ids = Array.from(new Set((Array.isArray(customerIds) ? customerIds : []).map((item) => String(item || '').trim()).filter(Boolean)));
  const objectIds = ids.filter((id) => mongoose.isValidObjectId(id));
  const or = [];
  if (objectIds.length > 0) or.push({ _id: { $in: objectIds } });
  if (ids.length > 0) {
    or.push({ clientId: { $in: ids } });
    or.push({ customerCode: { $in: ids } });
  }
  return or.length > 0 ? { $or: or } : null;
}

function summarizeCustomerCreditRows(creditSales = [], repayments = []) {
  let totalCreditPurchases = 0;
  let totalCreditPaid = 0;
  let outstandingBalance = 0;
  let overdueDays = 0;
  let onTimePayments = 0;
  let latePayments = 0;
  for (const doc of creditSales) {
    const current = computeCreditStatus(doc);
    totalCreditPurchases += Number(doc?.total_amount || 0);
    outstandingBalance += Number(current?.balance || 0);
    overdueDays += Number(current?.overdueDays || 0);
    if (current.status === 'completed') {
      if (current.overdueDays > 0) latePayments += 1;
      else onTimePayments += 1;
    } else if (current.status === 'overdue') {
      latePayments += 1;
    }
  }
  for (const doc of repayments) {
    totalCreditPaid += Number(doc?.amount || 0);
  }
  const scoreBase = 100 + (onTimePayments * 5) - (latePayments * 10) - Math.min(overdueDays, 30);
  const creditScore = Math.max(0, Math.min(100, scoreBase));
  const creditRank = customerRankFromScore(creditScore);
  return {
    totalCreditPurchases,
    totalCreditPaid,
    outstandingBalance,
    overdueDays,
    onTimePayments,
    latePayments,
    creditScore,
    creditRank
  };
}

r.get('/sales', async (req, res) => {
  const accessibleBranchIds = getAccessibleBranchIds(req.user);
  const query = {};
  if (req.query.customerId) query.customer_id = String(req.query.customerId);
  if (req.query.status) query.status = String(req.query.status);
  if (req.query.branchId) {
    const requestedBranchId = String(req.query.branchId);
    if (accessibleBranchIds !== 'all' && !accessibleBranchIds.includes(requestedBranchId)) return res.json([]);
    query.branchId = requestedBranchId;
  } else if (accessibleBranchIds !== 'all') {
    query.branchId = { $in: accessibleBranchIds };
  }
  if (req.query.posType) query.posType = String(req.query.posType);
  if (req.query.creditPackageName) query.creditPackageName = String(req.query.creditPackageName);
  const rows = await CreditSale.find(query).sort({ createdAt: -1 }).limit(500).lean();
  // #region debug-point B:credit-sales-list
  reportCreditDebug({
    hypothesisId: 'B',
    location: 'credits.js:get:sales',
    msg: '[DEBUG] Credit sales list resolved',
    data: {
      user: String(req.user?.name || req.user?.username || ''),
      role: String(req.user?.role || ''),
      branchId: String(req.user?.branchId || ''),
      assignedBranches: req.user?.assignedBranches ?? 'all',
      accessibleBranchIds,
      query,
      count: rows.length,
      sample: rows.slice(0, 20).map((row) => ({
        id: String(row?._id || ''),
        saleId: String(row?.saleId || ''),
        branchId: String(row?.branchId || ''),
        customerId: String(row?.customer_id || ''),
        posType: String(row?.posType || ''),
        status: String(row?.status || ''),
        createdAt: row?.createdAt || row?.created_at || null,
        dueDate: row?.due_date || null,
        balance: Number(row?.balance || 0)
      }))
    }
  });
  // #endregion
  res.json(rows);
});

r.get('/repayments', async (req, res) => {
  const accessibleBranchIds = getAccessibleBranchIds(req.user);
  const query = {};
  if (req.query.customerId) query.customerId = String(req.query.customerId);
  if (req.query.status) query.status = String(req.query.status);
  if (accessibleBranchIds !== 'all') {
    const saleBranchQuery = {};
    if (req.query.branchId) {
      const requestedBranchId = String(req.query.branchId);
      if (!accessibleBranchIds.includes(requestedBranchId)) return res.json([]);
      saleBranchQuery.branchId = requestedBranchId;
    } else {
      saleBranchQuery.branchId = { $in: accessibleBranchIds };
    }
    const saleIds = (await CreditSale.find(saleBranchQuery).select('_id').lean()).map((row) => String(row?._id || '')).filter(Boolean);
    if (saleIds.length === 0) return res.json([]);
    query.creditSaleId = { $in: saleIds };
  }
  const rows = await CreditRepayment.find(query).sort({ createdAt: -1 }).limit(500).lean();
  res.json(rows);
});

r.get('/customers/:id/summary', async (req, res) => {
  const customerId = String(req.params.id || '');
  const accessibleBranchIds = getAccessibleBranchIds(req.user);
  let customer = null;
  if (mongoose.isValidObjectId(customerId)) customer = await Customer.findById(customerId);
  if (!customer) customer = await Customer.findOne({ $or: [{ clientId: customerId }, { customerCode: customerId }] });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  if (accessibleBranchIds !== 'all') {
    const creditSales = await CreditSale.find({
      customer_id: String(customer._id),
      branchId: { $in: accessibleBranchIds }
    }).sort({ createdAt: -1 }).lean();
    if (creditSales.length === 0) return res.status(404).json({ error: 'Customer not found' });
    const creditSaleIds = creditSales.map((row) => String(row?._id || '')).filter(Boolean);
    const repayments = creditSaleIds.length > 0
      ? await CreditRepayment.find({
          customerId: String(customer._id),
          status: 'approved',
          creditSaleId: { $in: creditSaleIds }
        }).sort({ createdAt: -1 }).lean()
      : [];
    const sales = await Sale.find({
      customerId: String(customer._id),
      branchId: { $in: accessibleBranchIds }
    }).sort({ created_at: -1 }).limit(100).lean();
    const summary = summarizeCustomerCreditRows(creditSales, repayments);
    return res.json({
      customer,
      creditSales,
      repayments,
      sales,
      summary
    });
  }
  const data = await updateCustomerCreditMetrics(String(customer._id));
  res.json(data);
});

r.get('/customers', async (req, res) => {
  const accessibleBranchIds = getAccessibleBranchIds(req.user);
  if (accessibleBranchIds === 'all') {
    const customers = await Customer.find().sort({ name: 1 }).limit(500).lean();
    return res.json(customers);
  }
  const creditSales = await CreditSale.find({ branchId: { $in: accessibleBranchIds } }).sort({ createdAt: -1 }).lean();
  const customerIds = Array.from(new Set(creditSales.map((row) => String(row?.customer_id || '')).filter(Boolean)));
  if (customerIds.length === 0) return res.json([]);
  const lookupQuery = buildCustomerLookupQuery(customerIds);
  if (!lookupQuery) return res.json([]);
  const customers = await Customer.find(lookupQuery).sort({ name: 1 }).lean();
  const saleIds = creditSales.map((row) => String(row?._id || '')).filter(Boolean);
  const repayments = saleIds.length > 0
    ? await CreditRepayment.find({ status: 'approved', creditSaleId: { $in: saleIds } }).sort({ createdAt: -1 }).lean()
    : [];
  const creditSalesByCustomerId = new Map();
  creditSales.forEach((row) => {
    const key = String(row?.customer_id || '');
    if (!key) return;
    if (!creditSalesByCustomerId.has(key)) creditSalesByCustomerId.set(key, []);
    creditSalesByCustomerId.get(key).push(row);
  });
  const saleCustomerIdByCreditSaleId = new Map(creditSales.map((row) => [String(row?._id || ''), String(row?.customer_id || '')]));
  const repaymentsByCustomerId = new Map();
  repayments.forEach((row) => {
    const key = saleCustomerIdByCreditSaleId.get(String(row?.creditSaleId || '')) || String(row?.customerId || '');
    if (!key) return;
    if (!repaymentsByCustomerId.has(key)) repaymentsByCustomerId.set(key, []);
    repaymentsByCustomerId.get(key).push(row);
  });
  const rows = customers.map((customer) => {
    const key = String(customer?._id || customer?.clientId || customer?.customerCode || '');
    const summary = summarizeCustomerCreditRows(
      creditSalesByCustomerId.get(key) || [],
      repaymentsByCustomerId.get(key) || []
    );
    return {
      ...customer,
      ...summary
    };
  });
  res.json(rows);
});

r.post('/repayments', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], 'add_sales'), async (req, res) => {
  const body = req.body || {};
  const accessibleBranchIds = getAccessibleBranchIds(req.user);
  const creditSaleId = String(body.creditSaleId || '');
  const amount = Math.max(0, Number(body.amount || 0));
  const paymentMethod = normalizeRepaymentMethod(body.paymentMethod);
  const remark = String(body.remark || '');
  const clientId = String(body.clientId || '').trim() || buildRepaymentClientId({
    creditSaleId,
    amount,
    paymentMethod,
    remark,
    paidDate: body.paidAt || body.createdAt || Date.now()
  });
  if (!creditSaleId) return res.status(400).json({ error: 'Missing creditSaleId' });
  if (amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  const creditSale = await CreditSale.findById(creditSaleId);
  if (!creditSale) return res.status(404).json({ error: 'Credit sale not found' });
  if (accessibleBranchIds !== 'all' && !accessibleBranchIds.includes(String(creditSale.branchId || ''))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await refreshCreditSaleStatus(creditSale);
  if (String(creditSale.status || '') === 'completed') return res.status(400).json({ error: 'Credit sale is already completed' });
  const outstandingAmount = Math.max(0, Number(creditSale.balance || 0) + Number(creditSale.accumulated_penalty || 0));
  const pendingAmount = await getPendingRepaymentAmount(creditSale._id);
  const availableAmount = Math.max(0, outstandingAmount - pendingAmount);
  if (availableAmount <= 0) {
    return res.status(400).json({ error: 'Outstanding balance is already covered by pending repayments' });
  }
  if (amount > availableAmount) {
    return res.status(400).json({ error: `Repayment amount exceeds remaining payable amount of ${availableAmount.toFixed(2)}` });
  }
  const existing = await CreditRepayment.findOne({ clientId });
  if (existing) {
    const approval = existing.approvalId ? await Approval.findById(existing.approvalId).catch(() => null) : null;
    return res.json({ repayment: existing, approval });
  }
  const repayment = await CreditRepayment.create({
    clientId,
    creditSaleId: String(creditSale._id),
    customerId: String(creditSale.customer_id),
    amount,
    paymentMethod,
    remark,
    initiatedByName: req.user?.name || 'unknown',
    initiatedByRole: req.user?.role || '',
    status: 'pending_director'
  });
  const approval = await createApprovalForReference({
    actionType: 'credit_repayment',
    referenceModel: 'CreditRepayment',
    referenceId: String(repayment._id),
    initiatedByName: req.user?.name || 'unknown',
    initiatedByRole: req.user?.role || ''
  });
  const fresh = await CreditRepayment.findById(repayment._id);
  res.json({ repayment: fresh, approval });
});

r.delete('/repayments/:id', async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const id = String(req.params.id || '');
  const query = mongoose.isValidObjectId(id) ? { _id: id } : { clientId: id };
  const row = await CreditRepayment.findOne(query);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const approvals = await Approval.find({ referenceModel: 'CreditRepayment', referenceId: String(row._id) }).lean();
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
  await archiveLiveDocument({
    req,
    tenantId,
    entityType: 'credit_repayment',
    collectionName: 'creditrepayments',
    doc: row,
    meta: {
      relatedApprovals: approvals
    }
  });
  await CreditRepayment.deleteOne({ _id: row._id });
  void Approval.deleteMany({ referenceModel: 'CreditRepayment', referenceId: String(row._id) }).catch(() => {});
  void updateCustomerCreditMetrics(String(row.customerId || '')).catch(() => {});
  res.json({ ok: true });
});

r.post('/repayments/bulk-delete', async (req, res) => {
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
  const rows = await CreditRepayment.find(query).lean();
  const repaymentIds = rows.map((row) => String(row._id)).filter(Boolean);
  const approvals = repaymentIds.length > 0
    ? await Approval.find({ referenceModel: 'CreditRepayment', referenceId: { $in: repaymentIds } }).lean()
    : [];
  const approvalsByRepaymentId = new Map();
  approvals.forEach((row) => {
    const key = String(row.referenceId || '');
    if (!approvalsByRepaymentId.has(key)) approvalsByRepaymentId.set(key, []);
    approvalsByRepaymentId.get(key).push(row);
  });
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
  for (const row of rows) {
    await archiveLiveDocument({
      req,
      tenantId,
      entityType: 'credit_repayment',
      collectionName: 'creditrepayments',
      doc: row,
      meta: {
        relatedApprovals: approvalsByRepaymentId.get(String(row._id)) || []
      }
    });
  }
  const result = await CreditRepayment.deleteMany(query);
  void Approval.deleteMany({ referenceModel: 'CreditRepayment', referenceId: { $in: repaymentIds } }).catch(() => {});
  const customerIds = Array.from(new Set(rows.map(r => String(r.customerId || '')).filter(Boolean)));
  void Promise.all(customerIds.map(id => updateCustomerCreditMetrics(id))).catch(() => {});
  res.json({ ok: true, count: Number(result?.deletedCount || 0) });
});

r.delete('/sales/:id', async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const id = String(req.params.id || '');
  const query = mongoose.isValidObjectId(id) ? { _id: id } : { saleId: id };
  const row = await CreditSale.findOne(query);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const repayments = await CreditRepayment.find({ creditSaleId: String(row._id) }).lean();
  const repaymentIds = repayments.map(item => String(item._id));
  const repaymentApprovals = repaymentIds.length > 0
    ? await Approval.find({ referenceModel: 'CreditRepayment', referenceId: { $in: repaymentIds } }).lean()
    : [];
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
  await archiveLiveDocument({
    req,
    tenantId,
    entityType: 'credit_sale',
    collectionName: 'creditsales',
    doc: row,
    meta: {
      relatedRepayments: repayments,
      relatedRepaymentApprovals: repaymentApprovals
    }
  });
  await CreditSale.deleteOne({ _id: row._id });
  if (repaymentIds.length > 0) {
    void CreditRepayment.deleteMany({ _id: { $in: repaymentIds } }).catch(() => {});
    void Approval.deleteMany({ referenceModel: 'CreditRepayment', referenceId: { $in: repaymentIds } }).catch(() => {});
  }
  void updateCustomerCreditMetrics(String(row.customer_id || '')).catch(() => {});
  res.json({ ok: true });
});

r.post('/sales/bulk-delete', async (req, res) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'superadmin') return res.status(403).json({ error: 'Forbidden' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) return res.json({ ok: true, count: 0 });
  const objectIds = ids.filter(id => mongoose.isValidObjectId(id));
  const salesQuery = {
    $or: [
      { saleId: { $in: ids } },
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : [])
    ]
  };
  const rows = await CreditSale.find(salesQuery).lean();
  const saleIds = rows.map(r => String(r._id));
  const repaymentRows = saleIds.length > 0 ? await CreditRepayment.find({ creditSaleId: { $in: saleIds } }).lean() : [];
  const repaymentIds = repaymentRows.map(r => String(r._id));
  const repaymentApprovals = repaymentIds.length > 0
    ? await Approval.find({ referenceModel: 'CreditRepayment', referenceId: { $in: repaymentIds } }).lean()
    : [];
  const repaymentsBySaleId = new Map();
  repaymentRows.forEach((row) => {
    const key = String(row.creditSaleId || '');
    if (!repaymentsBySaleId.has(key)) repaymentsBySaleId.set(key, []);
    repaymentsBySaleId.get(key).push(row);
  });
  const approvalsByRepaymentId = new Map();
  repaymentApprovals.forEach((row) => {
    const key = String(row.referenceId || '');
    if (!approvalsByRepaymentId.has(key)) approvalsByRepaymentId.set(key, []);
    approvalsByRepaymentId.get(key).push(row);
  });
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
  for (const row of rows) {
    const relatedRepayments = repaymentsBySaleId.get(String(row._id)) || [];
    await archiveLiveDocument({
      req,
      tenantId,
      entityType: 'credit_sale',
      collectionName: 'creditsales',
      doc: row,
      meta: {
        relatedRepayments,
        relatedRepaymentApprovals: relatedRepayments.flatMap((item) => approvalsByRepaymentId.get(String(item._id)) || [])
      }
    });
  }
  const result = await CreditSale.deleteMany(salesQuery);
  if (saleIds.length > 0) void CreditRepayment.deleteMany({ creditSaleId: { $in: saleIds } }).catch(() => {});
  if (repaymentIds.length > 0) void Approval.deleteMany({ referenceModel: 'CreditRepayment', referenceId: { $in: repaymentIds } }).catch(() => {});
  const customerIds = Array.from(new Set(rows.map(r => String(r.customer_id || '')).filter(Boolean)));
  void Promise.all(customerIds.map(id => updateCustomerCreditMetrics(id))).catch(() => {});
  res.json({ ok: true, count: Number(result?.deletedCount || 0) });
});

export default r;
