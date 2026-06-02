import { Router } from 'express';
import mongoose from 'mongoose';
import CreditRepayment from '../models/CreditRepayment.js';
import CreditSale from '../models/CreditSale.js';
import Customer from '../models/Customer.js';
import Approval from '../models/Approval.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { createApprovalForReference } from '../utils/approvalWorkflow.js';
import { refreshCreditSaleStatus, updateCustomerCreditMetrics } from '../utils/credit.js';
import { archiveLiveDocument } from '../utils/superBin.js';

const r = Router();

r.use(requireAuth);

async function getPendingRepaymentAmount(creditSaleId) {
  if (!creditSaleId) return 0;
  const rows = await CreditRepayment.find({
    creditSaleId: String(creditSaleId),
    status: { $in: ['pending_director', 'pending_manager'] }
  }).select('amount').lean();
  return rows.reduce((sum, row) => sum + Math.max(0, Number(row?.amount || 0)), 0);
}

r.get('/sales', async (req, res) => {
  const query = {};
  if (req.query.customerId) query.customer_id = String(req.query.customerId);
  if (req.query.status) query.status = String(req.query.status);
  const rows = await CreditSale.find(query).sort({ createdAt: -1 }).limit(500).lean();
  res.json(rows);
});

r.get('/repayments', async (req, res) => {
  const query = {};
  if (req.query.customerId) query.customerId = String(req.query.customerId);
  if (req.query.status) query.status = String(req.query.status);
  const rows = await CreditRepayment.find(query).sort({ createdAt: -1 }).limit(500).lean();
  res.json(rows);
});

r.get('/customers/:id/summary', async (req, res) => {
  const customerId = String(req.params.id || '');
  let customer = null;
  if (mongoose.isValidObjectId(customerId)) customer = await Customer.findById(customerId);
  if (!customer) customer = await Customer.findOne({ $or: [{ clientId: customerId }, { customerCode: customerId }] });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const data = await updateCustomerCreditMetrics(String(customer._id));
  res.json(data);
});

r.get('/customers', async (_req, res) => {
  const customers = await Customer.find().sort({ name: 1 }).limit(500).lean();
  res.json(customers);
});

r.post('/repayments', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], 'add_sales'), async (req, res) => {
  const body = req.body || {};
  const creditSaleId = String(body.creditSaleId || '');
  const amount = Math.max(0, Number(body.amount || 0));
  const paymentMethod = ['cash', 'card', 'mobile', 'wallet'].includes(String(body.paymentMethod || '').trim().toLowerCase())
    ? String(body.paymentMethod || '').trim().toLowerCase()
    : 'cash';
  if (!creditSaleId) return res.status(400).json({ error: 'Missing creditSaleId' });
  if (amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  const creditSale = await CreditSale.findById(creditSaleId);
  if (!creditSale) return res.status(404).json({ error: 'Credit sale not found' });
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
  const repayment = await CreditRepayment.create({
    creditSaleId: String(creditSale._id),
    customerId: String(creditSale.customer_id),
    amount,
    paymentMethod,
    remark: String(body.remark || ''),
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
