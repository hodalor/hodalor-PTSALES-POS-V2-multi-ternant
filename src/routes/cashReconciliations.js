import { Router } from 'express';
import mongoose from 'mongoose';
import { modelFor as AuditModelFor } from '../models/Audit.js';
import Branch, { modelFor as BranchModelFor } from '../models/Branch.js';
import CashReconciliation, { modelFor as CashReconciliationModelFor } from '../models/CashReconciliation.js';
import { modelFor as ReconciliationAccountModelFor } from '../models/ReconciliationAccount.js';
import Sale from '../models/Sale.js';
import { getMasterConnection } from '../config/tenancy.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';
import { createApprovalForReference } from '../utils/approvalWorkflow.js';
import { uploadMediaString } from '../utils/mediaStorage.js';
import { listRecognizedSalesTotalsByDay } from '../utils/saleAccounting.js';
import { canAccessAccount, resolveAllowedBranchIds } from './reconciliationAccounts.js';

const r = Router();

function normalizeString(value = '') {
  return String(value || '').trim();
}

function normalizeDateKey(value = '') {
  const raw = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function formatLocalDateKey(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value = '') {
  const normalized = normalizeDateKey(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function startOfLocalDay(value) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(value) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999);
}

function uniqueDateKeys(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [values]).map((value) => normalizeDateKey(value)).filter(Boolean))).sort();
}

function buildRange(from, to, fallbackDays = 90) {
  const today = new Date();
  const fallbackStart = new Date(today.getTime() - fallbackDays * 24 * 3600 * 1000);
  const parsedFrom = parseDateKey(from);
  const parsedTo = parseDateKey(to);
  const start = parsedFrom ? startOfLocalDay(parsedFrom) : startOfLocalDay(fallbackStart);
  const end = parsedTo ? endOfLocalDay(parsedTo) : endOfLocalDay(today);
  return { start, end };
}

function minDate(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return a.getTime() <= b.getTime() ? a : b;
}

function sameAmount(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
}

function hasCashActivity(amount) {
  return Math.abs(Number(amount || 0)) >= 0.005;
}

function reconciliationTotalsOptions(extra = {}) {
  return {
    refundAttribution: 'unreconciled_sale_date',
    ...extra
  };
}

function mergeRequiredRefundAdjustmentDates(branchId, selectedDates = [], totals, coverage) {
  const merged = new Set(uniqueDateKeys(selectedDates));
  Array.from(totals.values()).forEach((row) => {
    if (normalizeString(row?.branchId) !== normalizeString(branchId)) return;
    if (Number(row?.total || 0) >= -0.004999) return;
    const key = `${normalizeString(row.branchId)}:${normalizeDateKey(row.date)}`;
    if (coverage?.coveredAny?.has(key)) return;
    const day = normalizeDateKey(row.date);
    if (day) merged.add(day);
  });
  return Array.from(merged).sort();
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

async function uploadAllocationProofs(values = [], req) {
  const allocations = Array.isArray(values) ? values : [];
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').trim();
  return Promise.all(allocations.map(async (item, index) => ({
    ...(item || {}),
    proofImage: await uploadMediaString(item?.proofImage, {
      tenantId,
      folder: 'cash-reconciliation-proofs',
      originalName: item?.proofName || `proof-${index + 1}`
    })
  })));
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

async function listSalesTotalsByDay(branchIds, start, end, options = {}) {
  return listRecognizedSalesTotalsByDay(branchIds, start, end, reconciliationTotalsOptions(options));
}

async function listSalesAmountsByDay(branchIds, start, end, options = {}) {
  return listRecognizedSalesTotalsByDay(branchIds, start, end, reconciliationTotalsOptions(options));
}

async function listReconciliationTotalsWithCoverage(branchIds, start, end, options = {}) {
  const coverage = await loadCoverageSets(branchIds, start, end);
  const totals = await listSalesTotalsByDay(branchIds, start, end, {
    ...options,
    coveredApproved: coverage.coveredApproved
  });
  return { totals, coverage };
}

async function loadCoverageSets(branchIds, start, end) {
  const startKey = formatLocalDateKey(start);
  const endKey = formatLocalDateKey(end);
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
    return startOfLocalDay(tenant?.createdAt) || null;
  } catch {
    return null;
  }
}

async function resolveEarliestSaleStart(branchIds) {
  if (!Array.isArray(branchIds) || branchIds.length === 0) return null;
  const row = await Sale.findOne({
    branchId: { $in: branchIds }
  }).sort({ created_at: 1 }).select({ created_at: 1 }).lean();
  return startOfLocalDay(row?.created_at) || null;
}

r.use(requireAuth);

r.get('/backlog', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['view_finance_reconciliation', 'add_finance_reconciliation']), async (req, res) => {
  const scope = await resolveScope(req);
  const branchIds = await resolveRequestedBranchIds(req, scope);
  const activityFilter = normalizeString(req.query.activityFilter || 'all').toLowerCase() || 'all';
  const [tenantCreatedStart, earliestSaleStart] = await Promise.all([
    resolveTenantCreatedStart(req),
    resolveEarliestSaleStart(branchIds)
  ]);
  const end = normalizeDateKey(req.query.to)
    ? endOfLocalDay(parseDateKey(req.query.to))
    : endOfLocalDay(new Date());
  const explicitFrom = normalizeDateKey(req.query.from)
    ? startOfLocalDay(parseDateKey(req.query.from))
    : null;
  const start = explicitFrom || minDate(tenantCreatedStart, earliestSaleStart) || buildRange(undefined, req.query.to, 120).start;
  const [{ totals, coverage }, branchNames] = await Promise.all([
    listReconciliationTotalsWithCoverage(branchIds, start, end, { activityFilter }),
    branchNameMap()
  ]);
  const rows = Array.from(totals.values())
    .filter((row) => hasCashActivity(row.total) && !coverage.coveredApproved.has(`${row.branchId}:${row.date}`))
    .sort((a, b) => `${a.date}:${a.branchId}`.localeCompare(`${b.date}:${b.branchId}`))
    .map((row) => {
      const expectedAmount = Number(row.total || 0);
      return {
        status: coverage.coveredAny.has(`${row.branchId}:${row.date}`) ? 'pending_approval' : 'awaiting_submission',
        branchId: row.branchId,
        branchName: branchNames.get(row.branchId) || row.branchId,
        date: row.date,
        expectedAmount,
        isRefundAdjustment: expectedAmount < 0,
        paymentBreakdown: Object.entries(row.paymentBreakdown || {}).map(([paymentMethod, amount]) => ({ paymentMethod, amount: Number(amount || 0) }))
      };
    });
  res.json(rows);
});

r.get('/summary', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['view_finance_reconciliation', 'add_finance_reconciliation', 'approve_finance_reconciliation_director', 'approve_finance_reconciliation_manager']), async (req, res) => {
  const scope = await resolveScope(req);
  const branchIds = await resolveRequestedBranchIds(req, scope);
  const activityFilter = normalizeString(req.query.activityFilter || 'all').toLowerCase() || 'all';
  const fromKey = normalizeDateKey(req.query.from);
  const toKey = normalizeDateKey(req.query.to);
  const { start, end } = buildRange(fromKey, toKey, 30);
  const [tenantCreatedStart, earliestSaleStart] = await Promise.all([
    resolveTenantCreatedStart(req),
    resolveEarliestSaleStart(branchIds)
  ]);
  const useFilteredWindowForAwaiting = !!(fromKey || toKey);
  const backlogStart = useFilteredWindowForAwaiting ? start : (minDate(tenantCreatedStart, earliestSaleStart) || start);
  const [windowResult, backlogResult] = backlogStart.getTime() === start.getTime()
    ? await Promise.all([
      listReconciliationTotalsWithCoverage(branchIds, start, end, { activityFilter }),
      Promise.resolve(null)
    ])
    : await Promise.all([
      listReconciliationTotalsWithCoverage(branchIds, start, end, { activityFilter }),
      listReconciliationTotalsWithCoverage(branchIds, backlogStart, end, { activityFilter })
    ]);
  const { totals, coverage } = windowResult;
  const awaitingTotals = backlogResult?.totals || totals;
  const awaitingCoverage = backlogResult?.coverage || coverage;
  let depositedAmount = 0;
  let awaitingAmount = 0;
  let pendingApprovalAmount = 0;
  let backlogDays = 0;
  Array.from(totals.values()).forEach((row) => {
    const amount = Number(row.total || 0);
    if (!hasCashActivity(amount)) return;
    const key = `${row.branchId}:${row.date}`;
    if (coverage.coveredApproved.has(key)) {
      depositedAmount += amount;
    } else if (coverage.coveredAny.has(key)) {
      pendingApprovalAmount += amount;
    }
  });
  Array.from(awaitingTotals.values()).forEach((row) => {
    const amount = Number(row.total || 0);
    if (!hasCashActivity(amount)) return;
    const key = `${row.branchId}:${row.date}`;
    if (!awaitingCoverage.coveredApproved.has(key)) {
      // Include negative refund days so approved refunds always reduce pending deposit.
      awaitingAmount += amount;
      backlogDays += 1;
    }
  });
  res.json({
    depositedAmount,
    // Never report a negative "amount still to deposit" — over-refunded cash shows as 0 pending.
    awaitingAmount: Math.max(0, awaitingAmount),
    pendingApprovalAmount: Math.max(0, pendingApprovalAmount),
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
  const CashReconciliationModel = CashReconciliationModelFor(req.db);
  const ReconciliationAccountModel = ReconciliationAccountModelFor(req.db);
  const BranchModel = BranchModelFor(req.db);
  const AuditModel = AuditModelFor(req.db);
  const branchId = normalizeString(req.body?.branchId);
  const activityFilter = normalizeString(req.body?.activityFilter || 'all').toLowerCase() || 'all';
  if (!branchId) return res.status(400).json({ error: 'Branch is required' });
  if (!scope.allBranchesAllowed && !scope.allowedBranchIdSet.has(branchId)) return res.status(403).json({ error: 'You cannot submit reconciliation for that branch' });
  const requestedDates = uniqueDateKeys(req.body?.selectedDates);
  if (requestedDates.length === 0) return res.status(400).json({ error: 'Select at least one sales day to reconcile' });
  const rangeStart = startOfLocalDay(parseDateKey(requestedDates[0]));
  // Extend through today so later-approved refunds still reduce expected deposit for selected sales days.
  const rangeEnd = endOfLocalDay(new Date());
  if (!rangeStart || !rangeEnd) return res.status(400).json({ error: 'Select at least one sales day to reconcile' });
  const [{ totals, coverage }, accounts, branches] = await Promise.all([
    listReconciliationTotalsWithCoverage([branchId], rangeStart, rangeEnd, { activityFilter }),
    ReconciliationAccountModel.find({ active: true }).lean(),
    BranchModel.find({}).lean()
  ]);
  // Force-include uncovered refund adjustment days so cashiers cannot omit approved refunds.
  const selectedDates = mergeRequiredRefundAdjustmentDates(branchId, requestedDates, totals, coverage);
  if (selectedDates.length === 0) return res.status(400).json({ error: 'Select at least one sales day to reconcile' });
  for (const day of selectedDates) {
    const totalRow = totals.get(`${branchId}:${day}`);
    if (!totalRow || !hasCashActivity(totalRow.total)) {
      return res.status(400).json({ error: `No sales or refund activity found for ${day} on the selected branch` });
    }
    if (coverage.coveredAny.has(`${branchId}:${day}`)) {
      return res.status(400).json({ error: `${day} already has a submitted or approved reconciliation` });
    }
  }
  const expectedAmount = selectedDates.reduce((sum, day) => sum + Number(totals.get(`${branchId}:${day}`)?.total || 0), 0);
  if (expectedAmount <= 0.005) {
    return res.status(400).json({ error: 'Net amount to deposit must be greater than zero after refunds' });
  }
  const paymentMap = new Map();
  selectedDates.forEach((day) => {
    const row = totals.get(`${branchId}:${day}`);
    Object.entries(row?.paymentBreakdown || {}).forEach(([paymentMethod, amount]) => {
      paymentMap.set(paymentMethod, (paymentMap.get(paymentMethod) || 0) + Number(amount || 0));
    });
  });
  const uploadedAllocations = await uploadAllocationProofs(req.body?.allocations, req);
  const allocations = uploadedAllocations.map((item) => ({
    accountId: normalizeString(item.accountId),
    paymentMethod: normalizeString(item.paymentMethod || 'cash').toLowerCase() || 'cash',
    amount: Number(item.amount || 0),
    proofImage: normalizeString(item.proofImage),
    proofName: normalizeString(item.proofName),
    note: normalizeString(item.note)
  })).filter((item) => item.accountId && item.amount > 0);
  if (allocations.length === 0) {
    return res.status(400).json({ error: 'Add at least one deposit allocation' });
  }
  if (allocations.some((item) => !item.proofImage)) {
    return res.status(400).json({ error: 'Upload proof of deposit for every allocation' });
  }
  const accountMap = new Map(accounts.map((account) => [String(account._id), account]));
  for (const allocation of allocations) {
    const account = accountMap.get(allocation.accountId);
    if (!account) {
      return res.status(400).json({ error: 'Selected account no longer exists' });
    }
    if (!canAccessAccount(account, branchId)) {
      return res.status(400).json({ error: `Account ${account.name} is not available for this branch` });
    }
    allocation.accountName = account.name || '';
  }
  const depositedAmount = allocations.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  if (!sameAmount(depositedAmount, expectedAmount)) {
    return res.status(400).json({ error: 'Deposited total must match expected sales exactly' });
  }
  const branchLookup = new Map(branches.map((branch) => [normalizeString(branch.id || branch._id), branch.name || branch.code || branch.id || branch._id]));
  const branchName = branchLookup.get(branchId) || branchId;
  const reconciliationNumber = `REC-${branchId}-${Date.now()}`;
  const reconciliationId = new mongoose.Types.ObjectId();
  const writeTs = new Date();
  await CashReconciliationModel.collection.insertOne({
    _id: reconciliationId,
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
    approvalId: '',
    initiatedByName: req.user?.name || 'unknown',
    initiatedByRole: req.user?.role || '',
    status: 'pending_director',
    executed: false,
    createdAt: writeTs,
    updatedAt: writeTs
  });
  const approval = await createApprovalForReference({
    actionType: 'cash_reconciliation',
    referenceModel: 'CashReconciliation',
    referenceId: String(reconciliationId),
    initiatedByName: req.user?.name || 'unknown',
    initiatedByRole: req.user?.role || '',
    db: req.db
  });
  await CashReconciliationModel.updateOne({ _id: reconciliationId }, { $set: { approvalId: String(approval?._id || ''), updatedAt: new Date() } });
  await AuditModel.create({
    actor: req.user?.name || 'unknown',
    actionType: 'cash_reconciliation_submit',
    details: { reconciliationId: String(reconciliationId), branchId, selectedDates, expectedAmount, depositedAmount },
    branchId
  }).catch(() => {});
  const fresh = await CashReconciliationModel.findById(reconciliationId).lean();
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
