import { Router } from 'express';
import Expense from '../models/Expense.js';
import ExpenseRequest from '../models/ExpenseRequest.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import mongoose from 'mongoose';
import { archiveLiveDocument } from '../utils/superBin.js';

const r = Router();

r.use(requireAuth);

function findExpenseRequestByKey(id = '') {
  const key = String(id || '').trim();
  if (!key) return null;
  if (mongoose.isValidObjectId(key)) {
    return ExpenseRequest.findOne({ $or: [{ _id: key }, { clientId: key }] });
  }
  return ExpenseRequest.findOne({ clientId: key });
}

r.get('/', async (req, res) => {
  const branchId = String(req.query.branchId || '');
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const q = {};
  if (branchId) q.branchId = branchId;
  if (from || to) {
    q.date = {};
    if (from) q.date.$gte = new Date(from);
    if (to) q.date.$lte = new Date(to);
  }
  const rows = await Expense.find(q).sort({ date: -1, createdAt: -1 }).limit(2000);
  res.json(rows);
});

r.get('/requests', requireRoleOrPerm(['Admin','Manager'], 'approve_expenses'), async (req, res) => {
  const statusRaw = String(req.query.status || '').trim().toLowerCase();
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 200));
  const map = {
    pending: 'pending_approval',
    pending_approval: 'pending_approval',
    approved: 'approved',
    rejected: 'rejected'
  };
  const q = {};
  if (map[statusRaw]) q.status = map[statusRaw];
  const rows = await ExpenseRequest.find(q).sort({ createdAt: -1 }).limit(limit).lean();
  res.json(rows);
});

r.post('/requests', requireRoleOrPerm(['Admin','Manager'], 'add_expenses'), async (req, res) => {
  const { branchId, date, category, amount, note, clientId } = req.body || {};
  if (!branchId || !date || !category) return res.status(400).json({ error: 'Missing branchId/date/category' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
  const cid = String(clientId || '').trim();
  if (cid) {
    const existing = await ExpenseRequest.findOne({ clientId: cid });
    if (existing) return res.json(existing);
  }
  const row = await ExpenseRequest.create({
    clientId: cid || undefined,
    branchId: String(branchId),
    date: new Date(date),
    category: String(category),
    amount: amt,
    note: String(note || ''),
    initiatorName: req.user?.name || '',
    initiatorRole: req.user?.role || ''
  });
  res.json(row);
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'expense_request_create',
    details: { id: String(row._id), branchId: row.branchId, category: row.category, amount: row.amount },
    branchId: row.branchId
  }).catch(() => {});
});

r.post('/approve', requireRoleOrPerm(['Admin','Manager'], 'approve_expenses'), async (req, res) => {
  const { id, remark } = req.body || {};
  const row = await findExpenseRequestByKey(id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  const expenseClientId = `expense-request:${String(row._id)}`;
  if (row.status === 'approved') {
    const existingExpense = await Expense.findOne({ clientId: expenseClientId }).lean().catch(() => null);
    return res.json({ ok: true, alreadyProcessed: true, expense: existingExpense, request: row });
  }
  if (row.status !== 'pending_approval') return res.status(400).json({ error: 'Request not pending' });
  let exp = await Expense.findOne({ clientId: expenseClientId });
  if (!exp) {
    try {
      exp = await Expense.create({
        clientId: expenseClientId,
        branchId: row.branchId,
        date: row.date,
        category: row.category,
        amount: row.amount,
        note: row.note,
        createdBy: req.user?.name || 'unknown'
      });
    } catch (error) {
      if (error?.code === 11000) {
        exp = await Expense.findOne({ clientId: expenseClientId });
      } else {
        throw error;
      }
    }
  }
  row.status = 'approved';
  row.approverName = req.user?.name || '';
  row.approverRole = req.user?.role || '';
  row.approvalRemark = String(remark || '');
  row.approved_at = new Date();
  await row.save();
  res.json({ ok: true, expense: exp, request: row });
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'expense_approve',
    details: { id: String(row._id), expenseId: String(exp._id), branchId: row.branchId, category: row.category, amount: row.amount },
    remark: String(remark || ''),
    branchId: row.branchId
  }).catch(() => {});
});

r.post('/reject', requireRoleOrPerm(['Admin','Manager'], 'approve_expenses'), async (req, res) => {
  const { id, remark } = req.body || {};
  const row = await findExpenseRequestByKey(id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.status === 'rejected') return res.json({ ok: true, alreadyProcessed: true, request: row });
  if (row.status !== 'pending_approval') return res.status(400).json({ error: 'Request not pending' });
  row.status = 'rejected';
  row.approverName = req.user?.name || '';
  row.approverRole = req.user?.role || '';
  row.rejectionRemark = String(remark || '');
  row.rejected_at = new Date();
  await row.save();
  res.json({ ok: true, request: row });
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'expense_reject',
    details: { id: String(row._id), branchId: row.branchId, category: row.category, amount: row.amount },
    remark: String(remark || ''),
    branchId: row.branchId
  }).catch(() => {});
});

r.post('/', requireRoleOrPerm(['Admin','Manager'], 'add_expenses'), async (req, res) => {
  const { branchId, date, category, amount, note, clientId } = req.body || {};
  if (!branchId || !date || !category) return res.status(400).json({ error: 'Missing branchId/date/category' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
  const cid = String(clientId || '').trim();
  if (cid) {
    const existing = await Expense.findOne({ clientId: cid });
    if (existing) return res.json(existing);
  }
  const row = await Expense.create({
    clientId: cid || undefined,
    branchId: String(branchId),
    date: new Date(date),
    category: String(category),
    amount: amt,
    note: String(note || ''),
    createdBy: req.user?.name || ''
  });
  res.json(row);
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'expense_create',
    details: { id: String(row._id), branchId: row.branchId, category: row.category, amount: row.amount },
    branchId: row.branchId
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: req.user?.name || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'POST',
    status: 200,
    message: `Expense created: ${row.category} ${row.amount} @ ${row.branchId}`
  }).catch(() => {});
});

r.put('/:id', requireRoleOrPerm(['Admin','Manager'], 'add_expenses'), async (req, res) => {
  const id = String(req.params.id || '');
  const or = [];
  if (mongoose.isValidObjectId(id)) or.push({ _id: id });
  or.push({ clientId: id });
  const { branchId, date, category, amount, note } = req.body || {};
  const patch = {};
  if (branchId) patch.branchId = String(branchId);
  if (date) patch.date = new Date(date);
  if (category) patch.category = String(category);
  if (amount != null) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });
    patch.amount = amt;
  }
  if (note != null) patch.note = String(note || '');
  const row = await Expense.findOneAndUpdate({ $or: or }, patch, { new: true });
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'expense_update',
    details: { id: String(row._id), branchId: row.branchId, category: row.category, amount: row.amount },
    branchId: row.branchId
  }).catch(() => {});
});

r.delete('/:id', requireRoleOrPerm(['Admin','Manager'], 'add_expenses'), async (req, res) => {
  const id = String(req.params.id || '');
  const or = [];
  if (mongoose.isValidObjectId(id)) or.push({ _id: id });
  or.push({ clientId: id });
  const row = await Expense.findOne({ $or: or });
  if (!row) return res.status(404).json({ error: 'Not found' });
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
  await archiveLiveDocument({
    req,
    tenantId,
    entityType: 'expense',
    collectionName: 'expenses',
    doc: row
  });
  await Expense.deleteOne({ _id: row._id });
  res.json({ ok: true });
  void Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'expense_delete',
    details: { id: String(row._id), branchId: row.branchId, category: row.category, amount: row.amount },
    branchId: row.branchId
  }).catch(() => {});
});

export default r;
