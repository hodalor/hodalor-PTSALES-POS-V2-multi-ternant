import { Router } from 'express';
import mongoose from 'mongoose';
import CreditRepayment from '../models/CreditRepayment.js';
import CreditSale from '../models/CreditSale.js';
import Customer from '../models/Customer.js';
import Approval from '../models/Approval.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { createApprovalForReference } from '../utils/approvalWorkflow.js';
import { refreshCreditSaleStatus, updateCustomerCreditMetrics } from '../utils/credit.js';

const r = Router();

r.use(requireAuth);

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
  if (!creditSaleId) return res.status(400).json({ error: 'Missing creditSaleId' });
  if (amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  const creditSale = await CreditSale.findById(creditSaleId);
  if (!creditSale) return res.status(404).json({ error: 'Credit sale not found' });
  await refreshCreditSaleStatus(creditSale);
  if (String(creditSale.status || '') === 'completed') return res.status(400).json({ error: 'Credit sale is already completed' });
  const repayment = await CreditRepayment.create({
    creditSaleId: String(creditSale._id),
    customerId: String(creditSale.customer_id),
    amount,
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
  const rows = await CreditRepayment.find(query, { _id: 1, customerId: 1 }).lean();
  const result = await CreditRepayment.deleteMany(query);
  void Approval.deleteMany({ referenceModel: 'CreditRepayment', referenceId: { $in: rows.map(r => String(r._id)) } }).catch(() => {});
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
  const repayments = await CreditRepayment.find({ creditSaleId: String(row._id) }, { _id: 1 }).lean();
  const repaymentIds = repayments.map(item => String(item._id));
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
  const rows = await CreditSale.find(salesQuery, { _id: 1, customer_id: 1 }).lean();
  const saleIds = rows.map(r => String(r._id));
  const repaymentRows = saleIds.length > 0 ? await CreditRepayment.find({ creditSaleId: { $in: saleIds } }, { _id: 1 }).lean() : [];
  const repaymentIds = repaymentRows.map(r => String(r._id));
  const result = await CreditSale.deleteMany(salesQuery);
  if (saleIds.length > 0) void CreditRepayment.deleteMany({ creditSaleId: { $in: saleIds } }).catch(() => {});
  if (repaymentIds.length > 0) void Approval.deleteMany({ referenceModel: 'CreditRepayment', referenceId: { $in: repaymentIds } }).catch(() => {});
  const customerIds = Array.from(new Set(rows.map(r => String(r.customer_id || '')).filter(Boolean)));
  void Promise.all(customerIds.map(id => updateCustomerCreditMetrics(id))).catch(() => {});
  res.json({ ok: true, count: Number(result?.deletedCount || 0) });
});

export default r;
