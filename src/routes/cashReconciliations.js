import { Router } from 'express';
import Audit from '../models/Audit.js';
import Approval from '../models/Approval.js';
import Branch from '../models/Branch.js';
import CashReconciliation from '../models/CashReconciliation.js';
import ReconciliationAccount from '../models/ReconciliationAccount.js';
import Sale from '../models/Sale.js';
import { getMasterConnection } from '../config/tenancy.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { createApprovalForReference } from '../utils/approvalWorkflow.js';
import { canAccessAccount, normalizeBranchIds, resolveAllowedBranchIds } from './reconciliationAccounts.js';

const r = Router();

function normalizeString(value = '') {
  return String(value || '').trim();
}

function normalizeDateKey(value = '') {
  const raw = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function dateKeyFromIso(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function uniqueDateKeys(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [values]).map((value) => normalizeDateKey(value)).filter(Boolean))).sort();
}

function buildRange(from, to, fallbackDays = 90) {
  const today = new Date();
  const start = normalizeDateKey(from) ? new Date(`${normalizeDateKey(from)}T00:00:00.000Z`) : new Date(today.getTime() - fallbackDays * 24 * 3600 * 1000);
  const end = normalizeDateKey(to) ? new Date(`${normalizeDateKey(to)}T23:59:59.999Z`) : new Date(`${today.toISOString().slice(0, 10)}T23:59:59.999Z`);
  return { start, end };
}

function startOfUtcDay(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 0, 0, 0, 0));
}

function minDate(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return a.getTime() <= b.getTime() ? a : b;
}

function sameAmount(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
}

async function resolveScope(req) {
  const grants = Array.isArray(req.user?.grants) ? req.user.grants : [];
  const allowedBranchIds = await resolveAllowedBranchIds(req.user, grants);
  const allBranchesAllowed = String(req.user?.role || '').toLowerCase() === 'superadmin'
    || String(req.user?.role || '').toLowerCase() === 'admin'
    || grants.includes('view_finance_reconciliation_all_branches');
  return {
    grants,
    allowedBranchIds,
    allowedBranchIdSet: new Set(allowedBranchIds),
    allBranchesAllowed
  };
}

async function resolveRequestedBranchIds(req, scope) {
  const requestedBranchId = normalizeString(req.query.branchId || req.body?.branchId);
  if (requestedBranchId) {
    if (!scope.allBranchesAllowed && !scope.allowedBranchIdSet.has(requestedBranchId)) {
      const err = new Error('You cannot access that branch');
      err.status = 403;
      throw err;
    }
    return [requestedBranchId];
  }
  return scope.allowedBranchIds;
}

async function listSalesTotalsByDay(branchIds, start, end) {
  const totals = new Map();
  const [totalRows, paymentRows] = await Promise.all([
    Sale.aggregate([
      { $match: { branchId: { $in: branchIds }, created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            branchId: '$branchId',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }
          },
          total: { $sum: { $ifNull: ['$total', 0] } }
        }
      }
    ]),
    Sale.aggregate([
      { $match: { branchId: { $in: branchIds }, created_at: { $gte: start, $lte: end } } },
      { $unwind: { path: '$payment_methods', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: {
            branchId: '$branchId',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
            paymentMethod: { $toLower: { $ifNull: ['$payment_methods.type', 'other'] } }
          },
          amount: { $sum: { $ifNull: ['$payment_methods.amount', 0] } }
        }
      }
    ])
  ]);
  totalRows.forEach((row) => {
    const branchId = normalizeString(row?._id?.branchId);
    const day = normalizeDateKey(row?._id?.day);
    if (!branchId || !day) return;
    totals.set(`${branchId}:${day}`, {
      branchId,
      date: day,
      total: Number(row?.total || 0),
      paymentBreakdown: {}
    });
  });
  paymentRows.forEach((row) => {
    const branchId = normalizeString(row?._id?.branchId);
    const day = normalizeDateKey(row?._id?.day);
    const paymentMethod = normalizeString(row?._id?.paymentMethod || 'other').toLowerCase() || 'other';
    if (!branchId || !day) return;
    const key = `${branchId}:${day}`;
    if (!totals.has(key)) {
      totals.set(key, {
        branchId,
        date: day,
        total: 0,
        paymentBreakdown: {}
      });
    }
    totals.get(key).paymentBreakdown[paymentMethod] = Number(row?.amount || 0);
  });
  return totals;
}

async function listSalesAmountsByDay(branchIds, start, end) {
  const totals = new Map();
  const rows = await Sale.aggregate([
    { $match: { branchId: { $in: branchIds }, created_at: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: {
          branchId: '$branchId',
          day: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }
        },
        total: { $sum: { $ifNull: ['$total', 0] } }
      }
    }
  ]);
  rows.forEach((row) => {
    const branchId = normalizeString(row?._id?.branchId);
    const day = normalizeDateKey(row?._id?.day);
    if (!branchId || !day) return;
    totals.set(`${branchId}:${day}`, {
      branchId,
      date: day,
      total: Number(row?.total || 0)
    });
  });
  return totals;
}

async function loadCoverageSets(branchIds, start, end) {
  const startKey = start.toISOString().slice(0, 10);
  const endKey = end.toISOString().slice(0, 10);
  const rows = await CashReconciliation.aggregate([
    {
      $match: {
        branchId: { $in: branchIds },
        status: { $in: ['pending_director', 'pending_manager', 'approved'] }
      }
    },
    { $unwind: '$selectedDates' },
    {
      $match: {
        selectedDates: { $gte: startKey, $lte: endKey }
      }
    },
    {
      $project: {
        branchId: 1,
        status: 1,
        day: '$selectedDates'
      }
    }
  ]);
  const coveredAny = new Set();
  const coveredApproved = new Set();
  rows.forEach((row) => {
    const day = normalizeDateKey(row?.day);
    const key = `${normalizeString(row?.branchId)}:${day}`;
    if (!day || !normalizeString(row?.branchId)) return;
    coveredAny.add(key);
    if (String(row.status || '') === 'approved') coveredApproved.add(key);
  });
  return { coveredAny, coveredApproved };
}

async function branchNameMap() {
  const rows = await Branch.find({}).lean();
  return new Map(rows.map((row) => [normalizeString(row.id || row._id), row.name || row.code || row.id || row._id]));
}

async function resolveTenantCreatedStart(req) {
  const tenantId = normalizeString(req.user?.tenantId || req.tenantId);
  if (!tenantId || tenantId.toLowerCase() === 'master') return null;
  try {
    const master = await getMasterConnection();
    const TenantModel = TenantModelFor(master);
    const tenant = await TenantModel.findOne({ tenantId }, { createdAt: 1 }).lean();
    return startOfUtcDay(tenant?.createdAt) || null;
  } catch {
    return null;
  }
}

async function resolveEarliestSaleStart(branchIds) {
  if (!Array.isArray(branchIds) || branchIds.length === 0) return null;
  const row = await Sale.findOne({
    branchId: { $in: branchIds }
  }).sort({ created_at: 1 }).select({ created_at: 1 }).lean();
  return startOfUtcDay(row?.created_at) || null;
}

r.use(requireAuth);

r.get('/backlog', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['view_finance_reconciliation', 'add_finance_reconciliation']), async (req, res) => {
  const scope = await resolveScope(req);
  const branchIds = await resolveRequestedBranchIds(req, scope);
  const [tenantCreatedStart, earliestSaleStart] = await Promise.all([
    resolveTenantCreatedStart(req),
    resolveEarliestSaleStart(branchIds)
  ]);
  const end = normalizeDateKey(req.query.to)
    ? new Date(`${normalizeDateKey(req.query.to)}T23:59:59.999Z`)
    : new Date(`${new Date().toISOString().slice(0, 10)}T23:59:59.999Z`);
  const explicitFrom = normalizeDateKey(req.query.from)
    ? new Date(`${normalizeDateKey(req.query.from)}T00:00:00.000Z`)
    : null;
  const start = explicitFrom || minDate(tenantCreatedStart, earliestSaleStart) || buildRange(undefined, req.query.to, 120).start;
  const [totals, coverage, branchNames] = await Promise.all([
    listSalesTotalsByDay(branchIds, start, end),
    loadCoverageSets(branchIds, start, end),
    branchNameMap()
  ]);
  const rows = Array.from(totals.values())
    .filter((row) => Number(row.total || 0) > 0 && !coverage.coveredAny.has(`${row.branchId}:${row.date}`))
    .sort((a, b) => `${a.date}:${a.branchId}`.localeCompare(`${b.date}:${b.branchId}`))
    .map((row) => ({
      branchId: row.branchId,
      branchName: branchNames.get(row.branchId) || row.branchId,
      date: row.date,
      expectedAmount: Number(row.total || 0),
      paymentBreakdown: Object.entries(row.paymentBreakdown || {}).map(([paymentMethod, amount]) => ({ paymentMethod, amount: Number(amount || 0) }))
    }));
  res.json(rows);
});

r.get('/summary', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['view_finance_reconciliation', 'add_finance_reconciliation', 'approve_finance_reconciliation_director', 'approve_finance_reconciliation_manager']), async (req, res) => {
  const scope = await resolveScope(req);
  const branchIds = await resolveRequestedBranchIds(req, scope);
  const fromKey = normalizeDateKey(req.query.from);
  const toKey = normalizeDateKey(req.query.to);
  const { start, end } = buildRange(fromKey, toKey, 30);
  const [tenantCreatedStart, earliestSaleStart] = await Promise.all([
    resolveTenantCreatedStart(req),
    resolveEarliestSaleStart(branchIds)
  ]);
  const useFilteredWindowForAwaiting = !!(fromKey || toKey);
  const backlogStart = useFilteredWindowForAwaiting ? start : (minDate(tenantCreatedStart, earliestSaleStart) || start);
  const [totals, coverage, backlogTotals, backlogCoverage] = backlogStart.getTime() === start.getTime()
    ? await Promise.all([
      listSalesAmountsByDay(branchIds, start, end),
      loadCoverageSets(branchIds, start, end),
      Promise.resolve(null),
      Promise.resolve(null)
    ])
    : await Promise.all([
      listSalesAmountsByDay(branchIds, start, end),
      loadCoverageSets(branchIds, start, end),
      listSalesAmountsByDay(branchIds, backlogStart, end),
      loadCoverageSets(branchIds, backlogStart, end)
    ]);
  const awaitingTotals = backlogTotals || totals;
  const awaitingCoverage = backlogCoverage || coverage;
  let depositedAmount = 0;
  let awaitingAmount = 0;
  let pendingApprovalAmount = 0;
  let backlogDays = 0;
  Array.from(totals.values()).forEach((row) => {
    if (Number(row.total || 0) <= 0) return;
    const key = `${row.branchId}:${row.date}`;
    if (coverage.coveredApproved.has(key)) {
      depositedAmount += Number(row.total || 0);
    } else if (coverage.coveredAny.has(key)) {
      pendingApprovalAmount += Number(row.total || 0);
    }
  });
  Array.from(awaitingTotals.values()).forEach((row) => {
    if (Number(row.total || 0) <= 0) return;
    const key = `${row.branchId}:${row.date}`;
    if (!awaitingCoverage.coveredAny.has(key)) {
      awaitingAmount += Number(row.total || 0);
      backlogDays += 1;
    }
  });
  res.json({
    depositedAmount,
    awaitingAmount,
    pendingApprovalAmount,
    backlogDays
  });
});

r.get('/', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['view_finance_reconciliation', 'add_finance_reconciliation', 'approve_finance_reconciliation_director', 'approve_finance_reconciliation_manager']), async (req, res) => {
  const scope = await resolveScope(req);
  const branchIds = await resolveRequestedBranchIds(req, scope);
  const accountId = normalizeString(req.query.accountId);
  const status = normalizeString(req.query.status);
  const fromKey = normalizeDateKey(req.query.from);
  const toKey = normalizeDateKey(req.query.to);
  const query = { branchId: { $in: branchIds } };
  if (status) query.status = status;
  const rows = await CashReconciliation.find(query).sort({ createdAt: -1 }).limit(1000).lean();
  const filtered = rows.filter((row) => {
    const dates = uniqueDateKeys(row.selectedDates);
    if (accountId && !(Array.isArray(row.allocations) && row.allocations.some((item) => normalizeString(item.accountId) === accountId))) return false;
    if (fromKey || toKey) {
      const hasInRange = dates.some((day) => (!fromKey || day >= fromKey) && (!toKey || day <= toKey));
      if (!hasInRange) return false;
    }
    return true;
  });
  res.json(filtered);
});

r.post('/', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['add_finance_reconciliation']), async (req, res) => {
  const scope = await resolveScope(req);
  const branchId = normalizeString(req.body?.branchId);
  if (!branchId) return res.status(400).json({ error: 'Branch is required' });
  if (!scope.allBranchesAllowed && !scope.allowedBranchIdSet.has(branchId)) return res.status(403).json({ error: 'You cannot submit reconciliation for that branch' });
  const selectedDates = uniqueDateKeys(req.body?.selectedDates);
  if (selectedDates.length === 0) return res.status(400).json({ error: 'Select at least one sales day to reconcile' });
  const range = {
    start: new Date(`${selectedDates[0]}T00:00:00.000Z`),
    end: new Date(`${selectedDates[selectedDates.length - 1]}T23:59:59.999Z`)
  };
  const [totals, coverage, accounts, branches] = await Promise.all([
    listSalesTotalsByDay([branchId], range.start, range.end),
    loadCoverageSets([branchId], range.start, range.end),
    ReconciliationAccount.find({ active: true }).lean(),
    Branch.find({}).lean()
  ]);
  for (const day of selectedDates) {
    const totalRow = totals.get(`${branchId}:${day}`);
    if (!totalRow || Number(totalRow.total || 0) <= 0) {
      return res.status(400).json({ error: `No sales found for ${day} on the selected branch` });
    }
    if (coverage.coveredAny.has(`${branchId}:${day}`)) {
      return res.status(400).json({ error: `${day} already has a submitted or approved reconciliation` });
    }
  }
  const expectedAmount = selectedDates.reduce((sum, day) => sum + Number(totals.get(`${branchId}:${day}`)?.total || 0), 0);
  const paymentMap = new Map();
  selectedDates.forEach((day) => {
    const row = totals.get(`${branchId}:${day}`);
    Object.entries(row?.paymentBreakdown || {}).forEach(([paymentMethod, amount]) => {
      paymentMap.set(paymentMethod, (paymentMap.get(paymentMethod) || 0) + Number(amount || 0));
    });
  });
  const allocations = (Array.isArray(req.body?.allocations) ? req.body.allocations : []).map((item) => ({
    accountId: normalizeString(item.accountId),
    paymentMethod: normalizeString(item.paymentMethod || 'cash').toLowerCase() || 'cash',
    amount: Number(item.amount || 0),
    proofImage: normalizeString(item.proofImage),
    proofName: normalizeString(item.proofName),
    note: normalizeString(item.note)
  })).filter((item) => item.accountId && item.amount > 0);
  if (allocations.length === 0) return res.status(400).json({ error: 'Add at least one deposit allocation' });
  if (allocations.some((item) => !item.proofImage)) return res.status(400).json({ error: 'Upload proof of deposit for every allocation' });
  const accountMap = new Map(accounts.map((account) => [String(account._id), account]));
  for (const allocation of allocations) {
    const account = accountMap.get(allocation.accountId);
    if (!account) return res.status(400).json({ error: 'Selected account no longer exists' });
    if (!canAccessAccount(account, branchId)) return res.status(400).json({ error: `Account ${account.name} is not available for this branch` });
    allocation.accountName = account.name || '';
  }
  const depositedAmount = allocations.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (!sameAmount(depositedAmount, expectedAmount)) {
    return res.status(400).json({ error: 'Deposited total must match expected sales exactly' });
  }
  const branchLookup = new Map(branches.map((branch) => [normalizeString(branch.id || branch._id), branch.name || branch.code || branch.id || branch._id]));
  const branchName = branchLookup.get(branchId) || branchId;
  const reconciliationNumber = `REC-${branchId}-${Date.now()}`;
  const doc = await CashReconciliation.create({
    reconciliationNumber,
    branchId,
    branchName,
    selectedDates,
    expectedAmount,
    depositedAmount,
    variance: 0,
    paymentBreakdown: Array.from(paymentMap.entries()).map(([paymentMethod, amount]) => ({ paymentMethod, amount })),
    allocations,
    note: normalizeString(req.body?.note),
    initiatedByName: req.user?.name || 'unknown',
    initiatedByRole: req.user?.role || '',
    status: 'pending_director'
  });
  const approval = await createApprovalForReference({
    actionType: 'cash_reconciliation',
    referenceModel: 'CashReconciliation',
    referenceId: String(doc._id),
    initiatedByName: req.user?.name || 'unknown',
    initiatedByRole: req.user?.role || ''
  });
  doc.approvalId = String(approval?._id || '');
  await doc.save();
  await Audit.create({
    actor: req.user?.name || 'unknown',
    actionType: 'cash_reconciliation_submit',
    details: { reconciliationId: String(doc._id), branchId, selectedDates, expectedAmount, depositedAmount },
    branchId
  }).catch(() => {});
  const fresh = await CashReconciliation.findById(doc._id).lean();
  res.status(201).json(fresh);
});

r.get('/accounts/deposits', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['view_finance_reconciliation', 'add_finance_reconciliation', 'approve_finance_reconciliation_director', 'approve_finance_reconciliation_manager']), async (req, res) => {
  const scope = await resolveScope(req);
  const branchIds = await resolveRequestedBranchIds(req, scope);
  const accountId = normalizeString(req.query.accountId);
  const fromKey = normalizeDateKey(req.query.from);
  const toKey = normalizeDateKey(req.query.to);
  const rows = await CashReconciliation.find({ branchId: { $in: branchIds }, status: 'approved' }).lean();
  let total = 0;
  const items = [];
  rows.forEach((row) => {
    const inRange = uniqueDateKeys(row.selectedDates).some((day) => (!fromKey || day >= fromKey) && (!toKey || day <= toKey));
    if (!inRange) return;
    (Array.isArray(row.allocations) ? row.allocations : []).forEach((allocation) => {
      if (accountId && normalizeString(allocation.accountId) !== accountId) return;
      total += Number(allocation.amount || 0);
      items.push({
        reconciliationId: String(row._id),
        reconciliationNumber: row.reconciliationNumber || '',
        branchId: row.branchId,
        branchName: row.branchName,
        dates: row.selectedDates || [],
        accountId: allocation.accountId,
        accountName: allocation.accountName,
        paymentMethod: allocation.paymentMethod,
        amount: Number(allocation.amount || 0),
        approvedAt: row.approvedAt || row.updatedAt || row.createdAt
      });
    });
  });
  res.json({ total, items: items.sort((a, b) => new Date(b.approvedAt || 0).getTime() - new Date(a.approvedAt || 0).getTime()) });
});

export default r;
