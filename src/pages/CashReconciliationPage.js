import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import BranchSelect from '../components/BranchSelect';
import Modal from '../components/Modal';
import { formatCurrency } from '../utils/currency';
import { useToast } from '../components/ToastProvider';
import { promptDialog } from '../utils/dialogs';
import { approveApproval, rejectApproval } from '../api/approvals';
import { createCashReconciliation, getAccountDepositTotals, getCashReconciliationSummary, listCashReconciliationBacklog, listCashReconciliations } from '../api/cashReconciliations';
import { listReconciliationAccounts } from '../api/reconciliationAccounts';
import LoadingDots from '../components/LoadingDots';

const PAYMENT_METHOD_OPTIONS = ['cash', 'card', 'mobile', 'wallet', 'bank', 'other'];
const PROOF_MAX_DIMENSION = 1600;
const PROOF_OUTPUT_QUALITY = 0.82;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function dataUrlFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error('Failed to load image'));
    };
    image.src = imageUrl;
  });
}

async function optimizeProofImage(file) {
  if (!file) return '';
  const type = String(file.type || '').toLowerCase();
  if (!type.startsWith('image/')) {
    return dataUrlFromFile(file);
  }
  const image = await loadImageFromFile(file);
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);
  if (width <= 0 || height <= 0) {
    return dataUrlFromFile(file);
  }
  const scale = Math.min(1, PROOF_MAX_DIMENSION / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrlFromFile(file);
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toDataURL('image/jpeg', PROOF_OUTPUT_QUALITY);
}

function getReconciliationStatusMeta(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'approved') return { label: 'Approved', tone: 'success' };
  if (value === 'rejected') return { label: 'Rejected', tone: 'danger' };
  if (value === 'pending_manager') return { label: 'Pending Manager', tone: 'warning' };
  if (value === 'pending_director' || value === 'pending_approval') return { label: 'Pending', tone: 'info' };
  return { label: status || 'Unknown', tone: 'info' };
}

function CashReconciliationPage() {
  const auth = useSelector((s) => s.auth);
  const settings = useSelector((s) => s.settings);
  const branches = useSelector((s) => s.branches.branches || []);
  const toast = useToast();
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const canViewAllBranches = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_finance_reconciliation_all_branches');
  const canSubmit = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('add_finance_reconciliation');
  const canApproveDirector = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('approve_finance_reconciliation_director');
  const canApproveManager = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('approve_finance_reconciliation_manager');
  const canApproveAnything = canApproveDirector || canApproveManager;
  const [tab, setTab] = useState('submit');
  const [filters, setFilters] = useState(() => ({
    from: monthStartIso(),
    to: todayIso(),
    branchId: canViewAllBranches ? '' : String(settings.currentBranchId || ''),
    accountId: '',
    status: ''
  }));
  const [submitBranchId, setSubmitBranchId] = useState(() => String(settings.currentBranchId || ''));
  const [accounts, setAccounts] = useState([]);
  const [summary, setSummary] = useState({ depositedAmount: 0, awaitingAmount: 0, pendingApprovalAmount: 0, backlogDays: 0 });
  const [allBacklogRows, setAllBacklogRows] = useState([]);
  const [records, setRecords] = useState([]);
  const [accountTotals, setAccountTotals] = useState({ total: 0, items: [] });
  const [selectedDates, setSelectedDates] = useState([]);
  const [allocations, setAllocations] = useState([{ accountId: '', paymentMethod: 'cash', amount: '', proofImage: '', proofName: '', note: '' }]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingBacklog, setLoadingBacklog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workingApprovalId, setWorkingApprovalId] = useState('');
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [approvalDetail, setApprovalDetail] = useState(null);

  useEffect(() => {
    if (!submitBranchId && settings.currentBranchId) setSubmitBranchId(String(settings.currentBranchId || ''));
  }, [settings.currentBranchId, submitBranchId]);

  const allowedSubmitBranches = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || auth.user?.assignedBranches === 'all') return branches;
    const assigned = Array.isArray(auth.user?.assignedBranches) ? auth.user.assignedBranches : [auth.user?.assignedBranches || auth.user?.branchId].filter(Boolean);
    const ids = new Set(assigned.map((item) => String(item || '').trim()).filter(Boolean));
    if (auth.user?.branchId) ids.add(String(auth.user.branchId));
    return branches.filter((branch) => ids.has(String(branch.id || '').trim()));
  }, [auth.user?.assignedBranches, auth.user?.branchId, branches, roleLower]);

  const backlogRows = useMemo(() => (
    submitBranchId
      ? allBacklogRows.filter((row) => String(row.branchId || '') === String(submitBranchId || ''))
      : allBacklogRows
  ), [allBacklogRows, submitBranchId]);
  const visibleAccounts = useMemo(() => accounts.filter((account) => account.sharedAcrossBranches || !submitBranchId || (Array.isArray(account.branchIds) && account.branchIds.some((branchId) => String(branchId) === String(submitBranchId)))), [accounts, submitBranchId]);
  const selectedBacklogRows = useMemo(() => backlogRows.filter((row) => selectedDates.includes(String(row.date))), [backlogRows, selectedDates]);
  const expectedAmount = useMemo(() => selectedBacklogRows.reduce((sum, row) => sum + Number(row.expectedAmount || 0), 0), [selectedBacklogRows]);
  const paymentSummary = useMemo(() => {
    const map = new Map();
    selectedBacklogRows.forEach((row) => {
      (Array.isArray(row.paymentBreakdown) ? row.paymentBreakdown : []).forEach((item) => {
        const key = String(item.paymentMethod || 'other').toLowerCase();
        map.set(key, (map.get(key) || 0) + Number(item.amount || 0));
      });
    });
    return Array.from(map.entries()).map(([paymentMethod, amount]) => ({ paymentMethod, amount }));
  }, [selectedBacklogRows]);
  const enteredAmount = useMemo(() => allocations.reduce((sum, item) => sum + Number(item.amount || 0), 0), [allocations]);
  const canSelectBacklogRows = !!submitBranchId;

  const loadBacklog = useCallback(async (preferredBranchId = '') => {
    setLoadingBacklog(true);
    try {
      const preferred = String(preferredBranchId || '').trim();
      const backlogData = await listCashReconciliationBacklog(preferred ? { branchId: preferred } : {});
      const rows = Array.isArray(backlogData) ? backlogData : [];
      setAllBacklogRows(rows);
      if (rows.length === 0) {
        setSelectedDates([]);
        return;
      }
      const branchIds = Array.from(new Set(rows.map((row) => String(row.branchId || '').trim()).filter(Boolean)));
      const nextBranchId = branchIds.includes(preferred)
        ? preferred
        : (canViewAllBranches ? '' : (branchIds[0] || ''));
      if (nextBranchId) {
        setSubmitBranchId(nextBranchId);
        setSelectedDates(rows.filter((row) => String(row.branchId || '') === nextBranchId).map((row) => String(row.date)).sort());
      } else {
        setSubmitBranchId('');
        setSelectedDates([]);
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load unreconciled sales dates'), { type: 'error' });
    } finally {
      setLoadingBacklog(false);
    }
  }, [canViewAllBranches, toast]);

  const loadPage = useCallback(async () => {
    setLoading(true);
    try {
      const [accountRows, summaryData, recordRows, totalsData] = await Promise.all([
        listReconciliationAccounts({ active: true }),
        getCashReconciliationSummary({ branchId: filters.branchId, from: filters.from, to: filters.to }),
        listCashReconciliations({ branchId: filters.branchId, accountId: filters.accountId, status: filters.status, from: filters.from, to: filters.to }),
        getAccountDepositTotals({ branchId: filters.branchId, accountId: filters.accountId, from: filters.from, to: filters.to })
      ]);
      setAccounts(Array.isArray(accountRows) ? accountRows : []);
      setSummary(summaryData || { depositedAmount: 0, awaitingAmount: 0, pendingApprovalAmount: 0, backlogDays: 0 });
      setRecords(Array.isArray(recordRows) ? recordRows : []);
      setAccountTotals(totalsData || { total: 0, items: [] });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load reconciliation data'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [filters.accountId, filters.branchId, filters.from, filters.status, filters.to, toast]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    setSelectedDates((prev) => prev.filter((date) => backlogRows.some((row) => String(row.date) === String(date))));
  }, [backlogRows]);

  useEffect(() => {
    if (!submitModalOpen) return;
    if (backlogRows.length === 0) {
      setSelectedDates([]);
      return;
    }
    setSelectedDates((prev) => {
      if (prev.length > 0 && prev.every((date) => backlogRows.some((row) => String(row.date) === String(date)))) return prev;
      return backlogRows.map((row) => String(row.date)).sort();
    });
  }, [backlogRows, submitModalOpen]);

  useEffect(() => {
    if (!submitModalOpen) return;
    loadBacklog(submitBranchId);
  }, [loadBacklog, submitBranchId, submitModalOpen]);

  function toggleDate(date) {
    setSelectedDates((prev) => prev.includes(date) ? prev.filter((item) => item !== date) : [...prev, date].sort());
  }

  function updateAllocation(index, patch) {
    setAllocations((prev) => prev.map((item, idx) => idx === index ? { ...item, ...patch } : item));
  }

  function addAllocation() {
    setAllocations((prev) => [...prev, { accountId: '', paymentMethod: 'cash', amount: '', proofImage: '', proofName: '', note: '' }]);
  }

  function removeAllocation(index) {
    setAllocations((prev) => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== index));
  }

  async function onAllocationFileChange(index, file) {
    if (!file) return;
    try {
      // #region debug-point A:proof-file-selected
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'A', location: 'CashReconciliationPage.js:onAllocationFileChange:start', msg: '[DEBUG] Reconciliation proof file selected', data: { index, name: String(file?.name || ''), type: String(file?.type || ''), size: Number(file?.size || 0) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      const proofImage = await optimizeProofImage(file);
      const proofName = String(file.name || 'deposit-proof').replace(/\.[^.]+$/,'') + '.jpg';
      updateAllocation(index, { proofImage, proofName });
      // #region debug-point A:proof-file-optimized
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'A', location: 'CashReconciliationPage.js:onAllocationFileChange:done', msg: '[DEBUG] Reconciliation proof image optimized', data: { index, proofName, proofLength: Number(String(proofImage || '').length || 0) }, ts: Date.now() }) }).catch(() => {});
      // #endregion
    } catch (e) {
      // #region debug-point A:proof-file-error
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'A', location: 'CashReconciliationPage.js:onAllocationFileChange:error', msg: '[DEBUG] Reconciliation proof image optimization failed', data: { index, error: String(e?.message || e || '') }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      toast.show(String(e?.message || 'Failed to load proof image'), { type: 'error' });
    }
  }

  async function submitReconciliation() {
    if (!canSubmit) {
      toast.show('You do not have permission to submit reconciliation', { type: 'error' });
      return;
    }
    if (!submitBranchId) {
      toast.show('Select the branch to reconcile', { type: 'error' });
      return;
    }
    if (selectedDates.length === 0) {
      toast.show('Select at least one backlog day', { type: 'error' });
      return;
    }
    if (Math.abs(enteredAmount - expectedAmount) > 0.005) {
      toast.show('Entered allocation total must match expected amount exactly', { type: 'error' });
      return;
    }
    const normalizedAllocations = allocations.map((item) => ({
      accountId: String(item.accountId || '').trim(),
      paymentMethod: String(item.paymentMethod || 'cash').trim().toLowerCase() || 'cash',
      amount: Number(item.amount || 0),
      proofImage: String(item.proofImage || '').trim(),
      proofName: String(item.proofName || '').trim(),
      note: String(item.note || '').trim()
    })).filter((item) => item.accountId || item.amount > 0 || item.proofImage);
    if (normalizedAllocations.length === 0) {
      toast.show('Add at least one deposit allocation before submitting', { type: 'error' });
      return;
    }
    const firstInvalidAllocation = normalizedAllocations.find((item) => (
      !item.accountId || item.amount <= 0 || !item.proofImage
    ));
    if (firstInvalidAllocation) {
      toast.show('Every allocation must have an account, positive amount, and proof image', { type: 'error' });
      return;
    }
    const payload = {
      branchId: submitBranchId,
      selectedDates,
      note: String(note || '').trim(),
      allocations: normalizedAllocations
    };
    setSaving(true);
    // #region debug-point A:reconciliation-submit-start
    fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'A', location: 'CashReconciliationPage.js:submitReconciliation:start', msg: '[DEBUG] Reconciliation submit started', data: { branchId: String(submitBranchId || ''), selectedDates, expectedAmount: Number(expectedAmount || 0), enteredAmount: Number(enteredAmount || 0), allocationCount: normalizedAllocations.length, proofLengths: normalizedAllocations.map((item) => Number(String(item?.proofImage || '').length || 0)) }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    try {
      await createCashReconciliation(payload);
      // #region debug-point B:reconciliation-submit-success
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'B', location: 'CashReconciliationPage.js:submitReconciliation:success', msg: '[DEBUG] Reconciliation submit request resolved successfully', data: { branchId: String(submitBranchId || ''), selectedDates, allocationCount: normalizedAllocations.length }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      toast.show('Reconciliation submitted for approval', { type: 'success' });
      setSelectedDates([]);
      setAllocations([{ accountId: '', paymentMethod: 'cash', amount: '', proofImage: '', proofName: '', note: '' }]);
      setNote('');
      setSubmitModalOpen(false);
      setTab('records');
      await loadBacklog(submitBranchId);
      await loadPage();
    } catch (e) {
      // #region debug-point B:reconciliation-submit-error
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'B', location: 'CashReconciliationPage.js:submitReconciliation:error', msg: '[DEBUG] Reconciliation submit request failed', data: { branchId: String(submitBranchId || ''), selectedDates, error: String(e?.message || e || ''), status: Number(e?.status || 0) || null }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      toast.show(String(e?.message || 'Failed to submit reconciliation'), { type: 'error' });
    } finally {
      // #region debug-point B:reconciliation-submit-finally
      fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'B', location: 'CashReconciliationPage.js:submitReconciliation:finally', msg: '[DEBUG] Reconciliation submit finished finally block', data: { branchId: String(submitBranchId || ''), selectedDates, savingWillReset: true }, ts: Date.now() }) }).catch(() => {});
      // #endregion
      setSaving(false);
    }
  }

  async function onApproveRecord(record) {
    if (!record?.approvalId) return;
    const remark = await promptDialog('Approval remark (required)');
    if (remark == null) return;
    if (!String(remark || '').trim()) {
      toast.show('Approval remark is required', { type: 'error' });
      return;
    }
    setWorkingApprovalId(String(record.approvalId));
    try {
      await approveApproval(record.approvalId, { remark: String(remark || '').trim() });
      toast.show('Approval updated', { type: 'success' });
      setApprovalDetail(null);
      await loadPage();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to approve reconciliation'), { type: 'error' });
    } finally {
      setWorkingApprovalId('');
    }
  }

  async function onRejectRecord(record) {
    if (!record?.approvalId) return;
    const reason = await promptDialog('Reason for rejection (required)');
    if (reason == null) return;
    if (!String(reason || '').trim()) {
      toast.show('Reason is required', { type: 'error' });
      return;
    }
    setWorkingApprovalId(String(record.approvalId));
    try {
      await rejectApproval(record.approvalId, { reason: String(reason || '').trim() });
      toast.show('Reconciliation rejected', { type: 'success' });
      setApprovalDetail(null);
      await loadPage();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to reject reconciliation'), { type: 'error' });
    } finally {
      setWorkingApprovalId('');
    }
  }

  const approvalRows = useMemo(() => records.filter((row) => {
    const status = String(row.status || '');
    if (status === 'pending_director') return canApproveDirector;
    if (status === 'pending_manager') return canApproveManager;
    return false;
  }), [canApproveDirector, canApproveManager, records]);
  const summaryCards = useMemo(() => ([
    {
      key: 'deposited',
      label: 'Deposited',
      value: loading ? <LoadingDots label="Loading deposited total" /> : formatCurrency(summary.depositedAmount || 0, settings),
      accent: '#0f766e'
    },
    {
      key: 'awaiting',
      label: 'Awaiting Deposit',
      value: loading ? <LoadingDots label="Loading awaiting amount" /> : formatCurrency(summary.awaitingAmount || 0, settings),
      accent: '#2563eb'
    },
    {
      key: 'pending',
      label: 'Pending Approval',
      value: loading ? <LoadingDots label="Loading pending amount" /> : formatCurrency(summary.pendingApprovalAmount || 0, settings),
      accent: '#f59e0b'
    },
    {
      key: 'backlog',
      label: 'Backlog Days',
      value: loading ? <LoadingDots label="Loading backlog days" /> : (summary.backlogDays || 0),
      accent: '#7c3aed'
    }
  ]), [loading, settings, summary.awaitingAmount, summary.backlogDays, summary.depositedAmount, summary.pendingApprovalAmount]);

  function openSubmitModal() {
    setSelectedDates([]);
    setAllocations([{ accountId: '', paymentMethod: 'cash', amount: '', proofImage: '', proofName: '', note: '' }]);
    setNote('');
    setSubmitModalOpen(true);
  }

  function handleSubmitBranchChange(value) {
    const nextBranchId = String(value || '').trim();
    setSubmitBranchId(nextBranchId);
    if (!nextBranchId) {
      setSelectedDates([]);
      return;
    }
    const nextRows = allBacklogRows.filter((row) => String(row.branchId || '') === nextBranchId);
    if (nextRows.length > 0) {
      setSelectedDates(nextRows.map((row) => String(row.date)).sort());
      return;
    }
    setSelectedDates([]);
  }

  return (
    <div className="sales-page-shell">
      <div className="sales-header">
        <div className="sales-header-copy">
          <div className="ui-eyebrow">Finance Controls</div>
          <h1 className="sales-title">Cash Reconciliation</h1>
          <p className="sales-subtitle">
            Reconcile branch sales to company accounts, track backlog days, and review deposit approvals from one screen.
          </p>
        </div>
        <div className="sales-header-actions">
          <div className="sales-tabbar">
            <button className={tab === 'submit' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('submit')}>Backlog & Submit</button>
            <button className={tab === 'records' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('records')}>Deposit Records</button>
            {canApproveAnything && (
              <button className={tab === 'approvals' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('approvals')}>Approvals</button>
            )}
          </div>
        </div>
      </div>

      <div className="sales-filter-card">
        <div className="sales-filter-grid">
          <label className="sales-filter-field">
            <div className="sales-filter-label">From</div>
            <input className="input" type="date" value={filters.from} onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))} />
          </label>
          <label className="sales-filter-field">
            <div className="sales-filter-label">To</div>
            <input className="input" type="date" value={filters.to} onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))} />
          </label>
          <label className="sales-filter-field">
            <div className="sales-filter-label">Records Branch</div>
            <BranchSelect
              value={filters.branchId}
              onChange={(value) => setFilters((prev) => ({ ...prev, branchId: value }))}
              includeAll={canViewAllBranches}
              allLabel="All Branches"
              enforceRole={false}
            />
          </label>
          <label className="sales-filter-field">
            <div className="sales-filter-label">Account</div>
            <select className="select" value={filters.accountId} onChange={(e) => setFilters((prev) => ({ ...prev, accountId: e.target.value }))}>
              <option value="">All Accounts</option>
              {accounts.map((account) => (
                <option key={account._id} value={account._id}>{account.name}{account.bankName ? ` - ${account.bankName}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="sales-filter-field">
            <div className="sales-filter-label">Status</div>
            <select className="select" value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="">All Statuses</option>
              <option value="pending_director">Pending Director</option>
              <option value="pending_manager">Pending Manager</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
        </div>
      </div>

      <div className="sales-summary-grid">
        {summaryCards.map((card) => (
          <div key={card.key} className="sales-summary-card" style={{ '--accent': card.accent }}>
            <div className="sales-summary-label">{card.label}</div>
            <div className="sales-summary-value">{card.value}</div>
          </div>
        ))}
      </div>

      {tab === 'submit' && (
        <div className="sales-section-card">
          <div className="sales-section-head">
            <div>
              <h2 className="sales-section-title">Branch Reconciliation</h2>
              <p className="sales-section-note">
                Open the submission modal only when needed. It will load sales dates that still have revenue awaiting deposit.
              </p>
            </div>
            <button className="btn btn-primary" onClick={openSubmitModal} disabled={!canSubmit}>Add Reconciliation</button>
          </div>
          <div className="sales-table-meta">
            <div className="sales-results-note">
              {summary.backlogDays || 0} backlog day{Number(summary.backlogDays || 0) === 1 ? '' : 's'} currently need attention.
            </div>
          </div>
          <div className="stats-grid">
            <div className="surface-panel"><div className="stat-label">Awaiting Deposit</div><div className="stat-value-compact">{loading ? <LoadingDots /> : formatCurrency(summary.awaitingAmount || 0, settings)}</div></div>
            <div className="surface-panel"><div className="stat-label">Pending Approval</div><div className="stat-value-compact">{loading ? <LoadingDots /> : formatCurrency(summary.pendingApprovalAmount || 0, settings)}</div></div>
            <div className="surface-panel"><div className="stat-label">Backlog Days</div><div className="stat-value">{loading ? <LoadingDots /> : (summary.backlogDays || 0)}</div></div>
          </div>
        </div>
      )}

      {tab === 'records' && (
        <div className="sales-section-card">
          <div className="sales-section-head">
            <div>
              <h2 className="sales-section-title">Deposit Records</h2>
              <p className="sales-section-note">
                Review all submitted reconciliations for the current filter set and account selection.
              </p>
            </div>
            <div className="sales-summary-value" style={{ fontSize: 24 }}>{formatCurrency(accountTotals.total || 0, settings)}</div>
          </div>
          <div className="sales-table-meta">
            <div className="sales-results-note">
              {loading ? 'Loading deposit records...' : `${records.length} reconciliation record${records.length === 1 ? '' : 's'} found`}
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th align="left">No.</th>
                  <th align="left">Branch</th>
                  <th align="left">Dates</th>
                  <th align="right">Expected</th>
                  <th align="right">Deposited</th>
                  <th align="left">Status</th>
                  <th align="left">Allocations</th>
                </tr>
              </thead>
              <tbody>
                {records.map((row) => {
                  const statusMeta = getReconciliationStatusMeta(row?.status);
                  return (
                    <tr key={row._id}>
                      <td>{row.reconciliationNumber || row._id}</td>
                      <td>{row.branchName || row.branchId}</td>
                      <td>{(row.selectedDates || []).join(', ') || '—'}</td>
                      <td align="right">{formatCurrency(row.expectedAmount || 0, settings)}</td>
                      <td align="right">{formatCurrency(row.depositedAmount || 0, settings)}</td>
                      <td><span className={`status-badge ${statusMeta.tone}`}>{statusMeta.label}</span></td>
                      <td>
                        <div className="options-grid" style={{ gap: 6 }}>
                          {(row.allocations || []).map((item, index) => (
                            <div key={`${row._id}-alloc-${index}`} className="mini-record-subtle">
                              {item.accountName} • {item.paymentMethod} • {formatCurrency(item.amount || 0, settings)}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && records.length === 0 && <tr><td colSpan="7" style={{ padding: 12, color: '#64748b' }}>No reconciliation records found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'approvals' && canApproveAnything && (
        <div className="sales-section-card">
          <div className="sales-section-head">
            <div>
              <h2 className="sales-section-title">Pending Approvals</h2>
              <p className="sales-section-note">
                Review deposit proofs and confirm the submitted amount still matches the selected sales days.
              </p>
            </div>
          </div>
          <div className="sales-table-meta">
            <div className="sales-results-note">
              {loading ? 'Loading approval queue...' : `${approvalRows.length} approval${approvalRows.length === 1 ? '' : 's'} in your queue`}
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th align="left">No.</th>
                  <th align="left">Branch</th>
                  <th align="left">Dates</th>
                  <th align="right">Expected</th>
                  <th align="right">Deposited</th>
                  <th align="left">Proofs</th>
                  <th align="left">Status</th>
                  <th align="left"></th>
                </tr>
              </thead>
              <tbody>
                {approvalRows.map((row) => (
                  <tr
                    key={row._id}
                    onClick={() => setApprovalDetail(row)}
                    style={{ cursor: 'pointer' }}
                    title="Open reconciliation details"
                  >
                    <td>{row.reconciliationNumber || row._id}</td>
                    <td>{row.branchName || row.branchId}</td>
                    <td>{(row.selectedDates || []).join(', ')}</td>
                    <td align="right">{formatCurrency(row.expectedAmount || 0, settings)}</td>
                    <td align="right">{formatCurrency(row.depositedAmount || 0, settings)}</td>
                    <td>
                      <div className="inline-actions">
                        {(row.allocations || []).map((item, index) => item.proofImage ? (
                          <a key={`${row._id}-proof-${index}`} href={item.proofImage} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            <img src={item.proofImage} alt={item.proofName || 'proof'} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
                          </a>
                        ) : null)}
                      </div>
                    </td>
                    <td>
                      {(() => {
                        const statusMeta = getReconciliationStatusMeta(row?.status);
                        return <span className={`status-badge ${statusMeta.tone}`}>{statusMeta.label}</span>;
                      })()}
                    </td>
                    <td>
                      {(row.status === 'pending_director' && canApproveDirector) || (row.status === 'pending_manager' && canApproveManager) ? (
                        <div className="approval-row-actions">
                          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); onApproveRecord(row); }} disabled={workingApprovalId === row.approvalId}>
                            {workingApprovalId === row.approvalId ? 'Working…' : 'Approve'}
                          </button>
                          <button className="btn" onClick={(e) => { e.stopPropagation(); onRejectRecord(row); }} disabled={workingApprovalId === row.approvalId}>
                            {workingApprovalId === row.approvalId ? 'Working…' : 'Reject'}
                          </button>
                        </div>
                      ) : (
                        <span className="status-pill status-pill-neutral">Waiting</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && approvalRows.length === 0 && <tr><td colSpan="8" style={{ padding: 12, color: '#64748b' }}>No reconciliation approvals in your queue.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {submitModalOpen && (
        <Modal
          title="Add Reconciliation"
          variant="light"
          onClose={() => setSubmitModalOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setSubmitModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitReconciliation} disabled={saving || loadingBacklog || !submitBranchId}>
                {saving ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
                <label style={{ display: 'grid', gap: 6, minWidth: 260 }}>
                  <span>Branch</span>
                  <BranchSelect
                    value={submitBranchId}
                    onChange={handleSubmitBranchChange}
                    enforceRole={false}
                    overrideBranches={allowedSubmitBranches}
                    includeAll={canViewAllBranches}
                    allLabel="All Branches"
                  />
                </label>
                <button className="btn" onClick={() => loadBacklog(submitBranchId)} disabled={loadingBacklog}>
                  {loadingBacklog ? <LoadingDots label="Loading dates" /> : 'Refresh Dates'}
                </button>
              </div>
              <div style={{ color: '#64748b', fontSize: 13 }}>
                {submitBranchId
                  ? 'The system loads only dates with sales that are not yet deposited for the selected branch.'
                  : 'The system is showing unreconciled sales dates across all branches you are allowed to see. Select one branch to tick dates and submit a deposit.'}
              </div>
              {loadingBacklog ? (
                <div className="surface-panel-muted" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <LoadingDots label="Loading deposit backlog" />
                  <span className="table-meta">Loading unreconciled sales dates...</span>
                </div>
              ) : null}
            </div>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th align="left"></th>
                    <th align="left">Date</th>
                    <th align="left">Branch</th>
                    <th align="right">Expected</th>
                    <th align="left">Payment Mix</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingBacklog ? (
                    <tr>
                      <td colSpan="5" style={{ padding: 14, color: '#64748b' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <LoadingDots label="Loading backlog rows" />
                          <span>Loading deposit backlog rows...</span>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {backlogRows.map((row) => (
                    <tr key={`${row.branchId}:${row.date}`}>
                      <td><input type="checkbox" checked={selectedDates.includes(String(row.date))} onChange={() => toggleDate(String(row.date))} disabled={!canSelectBacklogRows || String(row.status || '') === 'pending_approval'} /></td>
                      <td>{row.date}</td>
                      <td>{row.branchName}</td>
                      <td align="right">{formatCurrency(row.expectedAmount || 0, settings)}</td>
                      <td>
                        {(row.paymentBreakdown || []).map((item) => `${item.paymentMethod}: ${formatCurrency(item.amount || 0, settings)}`).join(' • ') || '—'}
                        {String(row.status || '') === 'pending_approval' ? ' • Pending approval' : ''}
                      </td>
                    </tr>
                  ))}
                  {!loadingBacklog && backlogRows.length === 0 && (
                    <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>No unreconciled sales days found for the selected branch scope.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="stats-grid">
              <div className="surface-panel">
                <div className="stat-label">Selected Sales Days</div>
                <div className="stat-value">{loadingBacklog ? <LoadingDots label="Loading selected days" /> : selectedDates.length}</div>
              </div>
              <div className="surface-panel">
                <div className="stat-label">Expected Amount</div>
                <div className="stat-value-compact">{loadingBacklog ? <LoadingDots label="Loading expected amount" /> : formatCurrency(expectedAmount || 0, settings)}</div>
              </div>
              <div className="surface-panel">
                <div className="stat-label">Entered Amount</div>
                <div className="stat-value-compact" style={{ color: loadingBacklog ? '#0f172a' : (Math.abs(enteredAmount - expectedAmount) < 0.005 ? '#16a34a' : '#dc2626') }}>
                  {loadingBacklog ? <LoadingDots label="Loading entered amount" /> : formatCurrency(enteredAmount || 0, settings)}
                </div>
              </div>
            </div>

            {paymentSummary.length > 0 && (
              <div style={{ color: '#475569', fontSize: 13 }}>
                Payment breakdown:
                {' '}
                {paymentSummary.map((item) => `${item.paymentMethod}: ${formatCurrency(item.amount || 0, settings)}`).join(' • ')}
              </div>
            )}

            <div style={{ display: 'grid', gap: 12 }}>
              {allocations.map((item, index) => (
                <div key={`alloc-${index}`} className="surface-panel" style={{ display: 'grid', gap: 12 }}>
                  <div className="section-header">
                    <strong>Allocation {index + 1}</strong>
                    <button className="btn" onClick={() => removeAllocation(index)} disabled={allocations.length === 1}>Remove</button>
                  </div>
                  <div className="record-filters">
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="field-label">Account</span>
                      <select className="select" value={item.accountId} onChange={(e) => updateAllocation(index, { accountId: e.target.value })}>
                        <option value="">Select account</option>
                        {visibleAccounts.map((account) => (
                          <option key={account._id} value={account._id}>{account.name}{account.bankName ? ` - ${account.bankName}` : ''}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="field-label">Payment Method</span>
                      <select className="select" value={item.paymentMethod} onChange={(e) => updateAllocation(index, { paymentMethod: e.target.value })}>
                        {PAYMENT_METHOD_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="field-label">Amount</span>
                      <input className="input" type="number" min="0" step="0.01" value={item.amount} onChange={(e) => updateAllocation(index, { amount: e.target.value })} />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="field-label">Proof of Deposit</span>
                      <input className="input" type="file" accept="image/*" onChange={(e) => onAllocationFileChange(index, e.target.files?.[0] || null)} />
                    </label>
                  </div>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span className="field-label">Allocation Note</span>
                    <input className="input" value={item.note} onChange={(e) => updateAllocation(index, { note: e.target.value })} placeholder="Slip reference, teller, or payment note" />
                  </label>
                  {item.proofImage && (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <img src={item.proofImage} alt={item.proofName || 'deposit proof'} style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 12, border: '1px solid #e2e8f0' }} />
                      <div style={{ color: '#475569', fontSize: 13 }}>{item.proofName || 'Proof uploaded'}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={addAllocation}>Add Another Allocation</button>
              <label style={{ display: 'grid', gap: 6, flex: '1 1 280px' }}>
                <span>General Note</span>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for this reconciliation" />
              </label>
            </div>
          </div>
        </Modal>
      )}
      {approvalDetail && (
        <Modal
          title={approvalDetail.reconciliationNumber || 'Reconciliation Details'}
          variant="light"
          onClose={() => setApprovalDetail(null)}
          footer={
            <>
              <button className="btn" onClick={() => setApprovalDetail(null)}>Close</button>
              {(((approvalDetail.status === 'pending_director') && canApproveDirector) || ((approvalDetail.status === 'pending_manager') && canApproveManager)) && (
                <>
                  <button className="btn btn-primary" onClick={() => onApproveRecord(approvalDetail)} disabled={workingApprovalId === approvalDetail.approvalId}>
                    {workingApprovalId === approvalDetail.approvalId ? 'Working…' : 'Approve'}
                  </button>
                  <button className="btn" onClick={() => onRejectRecord(approvalDetail)} disabled={workingApprovalId === approvalDetail.approvalId}>
                    {workingApprovalId === approvalDetail.approvalId ? 'Working…' : 'Reject'}
                  </button>
                </>
              )}
            </>
          }
        >
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Branch</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{approvalDetail.branchName || approvalDetail.branchId || '—'}</div>
              </div>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Expected</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{formatCurrency(approvalDetail.expectedAmount || 0, settings)}</div>
              </div>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Deposited</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{formatCurrency(approvalDetail.depositedAmount || 0, settings)}</div>
              </div>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Status</div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{approvalDetail.status || '—'}</div>
              </div>
            </div>
            <div className="card" style={{ background: '#f8fafc' }}>
              <div style={{ color: '#64748b', marginBottom: 6 }}>Selected Sales Dates</div>
              <div style={{ fontWeight: 700 }}>{(approvalDetail.selectedDates || []).join(', ') || '—'}</div>
            </div>
            <div className="card" style={{ background: '#f8fafc' }}>
              <div style={{ color: '#64748b', marginBottom: 8 }}>Deposit Allocations</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {(approvalDetail.allocations || []).map((item, index) => (
                  <div key={`${approvalDetail._id}-detail-${index}`} style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', display: 'grid', gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>{item.accountName || 'Account'} • {formatCurrency(item.amount || 0, settings)}</div>
                    <div style={{ color: '#475569', fontSize: 13 }}>Payment Method: {item.paymentMethod || '—'}</div>
                    <div style={{ color: '#475569', fontSize: 13 }}>Note: {item.note || '—'}</div>
                    {item.proofImage ? (
                      <a href={item.proofImage} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', width: 'fit-content' }}>
                        <img src={item.proofImage} alt={item.proofName || 'proof'} style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 12, border: '1px solid #e2e8f0' }} />
                      </a>
                    ) : null}
                  </div>
                ))}
                {(!approvalDetail.allocations || approvalDetail.allocations.length === 0) && (
                  <div style={{ color: '#64748b' }}>No allocations recorded.</div>
                )}
              </div>
            </div>
            <div className="card" style={{ background: '#f8fafc' }}>
              <div style={{ color: '#64748b', marginBottom: 6 }}>General Note</div>
              <div>{approvalDetail.note || '—'}</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default CashReconciliationPage;
