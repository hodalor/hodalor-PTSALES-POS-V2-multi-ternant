import { Router } from 'express';
import Branch from '../models/Branch.js';
import ReconciliationAccount from '../models/ReconciliationAccount.js';
import Audit from '../models/Audit.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';

const r = Router();

function normalizeString(value = '') {
  return String(value || '').trim();
}

function normalizeBranchIds(value) {
  if (value === 'all') return 'all';
  return Array.from(new Set(
    (Array.isArray(value) ? value : [value])
      .map((item) => normalizeString(item))
      .filter(Boolean)
  ));
}

async function resolveAllowedBranchIds(user, grants = []) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'superadmin' || role === 'admin' || grants.includes('view_finance_reconciliation_all_branches')) {
    const rows = await Branch.find({}).lean();
    return rows.map((row) => normalizeString(row.id || row._id)).filter(Boolean);
  }
  const assigned = normalizeBranchIds(user?.assignedBranches);
  if (assigned === 'all') {
    const rows = await Branch.find({}).lean();
    return rows.map((row) => normalizeString(row.id || row._id)).filter(Boolean);
  }
  return Array.from(new Set([
    normalizeString(user?.branchId),
    ...(Array.isArray(assigned) ? assigned : [])
  ].filter(Boolean)));
}

function canAccessAccount(account, branchId) {
  if (!account) return false;
  if (account.sharedAcrossBranches) return true;
  const key = normalizeString(branchId);
  return (Array.isArray(account.branchIds) ? account.branchIds : []).some((item) => normalizeString(item) === key);
}

r.use(requireAuth);

r.get('/', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['view_finance_reconciliation', 'add_finance_reconciliation', 'manage_finance_accounts', 'approve_finance_reconciliation_director', 'approve_finance_reconciliation_manager']), async (req, res) => {
  const grants = Array.isArray(req.user?.grants) ? req.user.grants : [];
  const allowedBranchIds = new Set(await resolveAllowedBranchIds(req.user, grants));
  const activeOnly = String(req.query.active || '').toLowerCase() === 'true';
  const rows = await ReconciliationAccount.find(activeOnly ? { active: true } : {}).sort({ name: 1 }).lean();
  const filtered = rows.filter((row) => row.sharedAcrossBranches || (Array.isArray(row.branchIds) && row.branchIds.some((branchId) => allowedBranchIds.has(normalizeString(branchId)))));
  res.json(filtered);
});

r.post('/', requireRoleOrPerm(['Admin', 'Manager'], ['manage_finance_accounts']), async (req, res) => {
  const payload = req.body || {};
  const grants = Array.isArray(req.user?.grants) ? req.user.grants : [];
  const allowedBranchIds = new Set(await resolveAllowedBranchIds(req.user, grants));
  const branchIds = normalizeBranchIds(payload.branchIds);
  const sharedAcrossBranches = !!payload.sharedAcrossBranches;
  if (!sharedAcrossBranches && branchIds.length === 0) return res.status(400).json({ error: 'Select at least one branch or mark the account as shared' });
  if (!sharedAcrossBranches && branchIds.some((branchId) => !allowedBranchIds.has(branchId))) {
    return res.status(403).json({ error: 'You cannot assign this account to that branch' });
  }
  const doc = await ReconciliationAccount.create({
    name: normalizeString(payload.name),
    bankName: normalizeString(payload.bankName),
    accountName: normalizeString(payload.accountName),
    accountNumber: normalizeString(payload.accountNumber),
    branchIds: sharedAcrossBranches ? [] : branchIds,
    sharedAcrossBranches,
    active: payload.active !== false,
    createdByName: req.user?.name || 'unknown',
    updatedByName: req.user?.name || 'unknown'
  });
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'reconciliation_account_create',
    details: { accountId: String(doc._id), name: doc.name, branchIds: doc.branchIds, sharedAcrossBranches: doc.sharedAcrossBranches },
    branchId: doc.branchIds?.[0] || ''
  }).catch(() => {});
  res.status(201).json(doc);
});

r.put('/:id', requireRoleOrPerm(['Admin', 'Manager'], ['manage_finance_accounts']), async (req, res) => {
  const doc = await ReconciliationAccount.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Account not found' });
  const payload = req.body || {};
  const grants = Array.isArray(req.user?.grants) ? req.user.grants : [];
  const allowedBranchIds = new Set(await resolveAllowedBranchIds(req.user, grants));
  const branchIds = normalizeBranchIds(payload.branchIds);
  const sharedAcrossBranches = !!payload.sharedAcrossBranches;
  if (!sharedAcrossBranches && branchIds.length === 0) return res.status(400).json({ error: 'Select at least one branch or mark the account as shared' });
  if (!sharedAcrossBranches && branchIds.some((branchId) => !allowedBranchIds.has(branchId))) {
    return res.status(403).json({ error: 'You cannot assign this account to that branch' });
  }
  doc.name = normalizeString(payload.name);
  doc.bankName = normalizeString(payload.bankName);
  doc.accountName = normalizeString(payload.accountName);
  doc.accountNumber = normalizeString(payload.accountNumber);
  doc.sharedAcrossBranches = sharedAcrossBranches;
  doc.branchIds = sharedAcrossBranches ? [] : branchIds;
  doc.active = payload.active !== false;
  doc.updatedByName = req.user?.name || 'unknown';
  await doc.save();
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'reconciliation_account_update',
    details: { accountId: String(doc._id), name: doc.name, branchIds: doc.branchIds, sharedAcrossBranches: doc.sharedAcrossBranches, active: doc.active },
    branchId: doc.branchIds?.[0] || ''
  }).catch(() => {});
  res.json(doc);
});

r.delete('/:id', requireRoleOrPerm(['Admin', 'Manager'], ['manage_finance_accounts']), async (req, res) => {
  const doc = await ReconciliationAccount.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Account not found' });
  await ReconciliationAccount.deleteOne({ _id: doc._id });
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'reconciliation_account_delete',
    details: { accountId: String(doc._id), name: doc.name },
    branchId: doc.branchIds?.[0] || ''
  }).catch(() => {});
  res.json({ ok: true });
});

export { canAccessAccount, normalizeBranchIds, resolveAllowedBranchIds };
export default r;
