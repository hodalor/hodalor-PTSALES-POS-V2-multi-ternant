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

const PAYMENT_METHOD_OPTIONS = ['cash', 'card', 'mobile', 'wallet', 'bank', 'other'];

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

  const backlogRows = useMemo(() => allBacklogRows.filter((row) => String(row.branchId || '') === String(submitBranchId || '')), [allBacklogRows, submitBranchId]);
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

  const loadBacklog = useCallback(async (preferredBranchId = '') => {
    setLoadingBacklog(true);
    try {
      const backlogData = await listCashReconciliationBacklog({ from: filters.from, to: filters.to });
      const rows = Array.isArray(backlogData) ? backlogData : [];
      setAllBacklogRows(rows);
      if (rows.length === 0) {
        setSelectedDates([]);
        return;
      }
      const preferred = String(preferredBranchId || '').trim();
      const branchIds = Array.from(new Set(rows.map((row) => String(row.branchId || '').trim()).filter(Boolean)));
      const nextBranchId = branchIds.includes(preferred) ? preferred : branchIds[0] || '';
      if (nextBranchId) {
        setSubmitBranchId(nextBranchId);
        setSelectedDates(rows.filter((row) => String(row.branchId || '') === nextBranchId).map((row) => String(row.date)).sort());
      } else {
        setSelectedDates([]);
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load unreconciled sales dates'), { type: 'error' });
    } finally {
      setLoadingBacklog(false);
    }
  }, [filters.from, filters.to, toast]);

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
  }, [loadBacklog, submitModalOpen]);

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
      const proofImage = await dataUrlFromFile(file);
      updateAllocation(index, { proofImage, proofName: file.name || 'deposit-proof' });
    } catch (e) {
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
    const payload = {
      branchId: submitBranchId,
      selectedDates,
      note: String(note || '').trim(),
      allocations: allocations.map((item) => ({
        accountId: item.accountId,
        paymentMethod: item.paymentMethod,
        amount: Number(item.amount || 0),
        proofImage: item.proofImage,
        proofName: item.proofName,
        note: item.note
      }))
    };
    setSaving(true);
    try {
      await createCashReconciliation(payload);
      toast.show('Reconciliation submitted for approval', { type: 'success' });
      setSelectedDates([]);
      setAllocations([{ accountId: '', paymentMethod: 'cash', amount: '', proofImage: '', proofName: '', note: '' }]);
      setNote('');
      setSubmitModalOpen(false);
      setTab('records');
      await loadPage();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to submit reconciliation'), { type: 'error' });
    } finally {
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

  function openSubmitModal() {
    setSelectedDates([]);
    setAllocations([{ accountId: '', paymentMethod: 'cash', amount: '', proofImage: '', proofName: '', note: '' }]);
    setNote('');
    setSubmitModalOpen(true);
  }

  function handleSubmitBranchChange(value) {
    const nextBranchId = String(value || '').trim();
    setSubmitBranchId(nextBranchId);
    const nextRows = allBacklogRows.filter((row) => String(row.branchId || '') === nextBranchId);
    setSelectedDates(nextRows.map((row) => String(row.date)).sort());
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0 }}>Cash Reconciliation</h1>
            <div className="page-subtitle-compact">
              Reconcile branch sales to company accounts, track backlog days, and approve deposits safely.
            </div>
          </div>
          <div className="filter-actions">
            <button className={tab === 'submit' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('submit')}>Backlog & Submit</button>
            <button className={tab === 'records' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('records')}>Deposit Records</button>
            {canApproveAnything && (
              <button className={tab === 'approvals' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('approvals')}>Approvals</button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div className="responsive-filter-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(160px, 1fr))', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>From</span>
            <input className="input" type="date" value={filters.from} onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>To</span>
            <input className="input" type="date" value={filters.to} onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Records Branch</span>
            <BranchSelect
              value={filters.branchId}
              onChange={(value) => setFilters((prev) => ({ ...prev, branchId: value }))}
              includeAll={canViewAllBranches}
              allLabel="All Branches"
              enforceRole={false}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Account</span>
            <select className="select" value={filters.accountId} onChange={(e) => setFilters((prev) => ({ ...prev, accountId: e.target.value }))}>
              <option value="">All Accounts</option>
              {accounts.map((account) => (
                <option key={account._id} value={account._id}>{account.name}{account.bankName ? ` - ${account.bankName}` : ''}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Status</span>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'start' }}>
        <div className="card">
          <div style={{ color: '#64748b' }}>Deposited (Approved)</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{formatCurrency(summary.depositedAmount || 0, settings)}</div>
        </div>
        <div className="card">
          <div style={{ color: '#64748b' }}>Awaiting Deposit</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{formatCurrency(summary.awaitingAmount || 0, settings)}</div>
        </div>
        <div className="card">
          <div style={{ color: '#64748b' }}>Pending Approval</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{formatCurrency(summary.pendingApprovalAmount || 0, settings)}</div>
        </div>
        <div className="card">
          <div style={{ color: '#64748b' }}>Backlog Days</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{summary.backlogDays || 0}</div>
        </div>
      </div>

      {tab === 'submit' && (
        <>
          <div className="card" style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0 }}>Branch Reconciliation</h2>
                <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
                  Create a transfer only when needed. The add modal loads sales dates that have revenue but are not yet deposited.
                </div>
              </div>
              <button className="btn btn-primary" onClick={openSubmitModal} disabled={!canSubmit}>Add Reconciliation</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Awaiting Deposit</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{formatCurrency(summary.awaitingAmount || 0, settings)}</div>
              </div>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Pending Approval</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{formatCurrency(summary.pendingApprovalAmount || 0, settings)}</div>
              </div>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Backlog Days</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{summary.backlogDays || 0}</div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'records' && (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0 }}>Deposits into Selected Account</h2>
                <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
                  Total for the current filters and account selection.
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{formatCurrency(accountTotals.total || 0, settings)}</div>
            </div>
          </div>
          <div className="card">
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
                  {records.map((row) => (
                    <tr key={row._id}>
                      <td>{row.reconciliationNumber || row._id}</td>
                      <td>{row.branchName || row.branchId}</td>
                      <td>{(row.selectedDates || []).join(', ') || '—'}</td>
                      <td align="right">{formatCurrency(row.expectedAmount || 0, settings)}</td>
                      <td align="right">{formatCurrency(row.depositedAmount || 0, settings)}</td>
                      <td>{row.status}</td>
                      <td>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {(row.allocations || []).map((item, index) => (
                            <div key={`${row._id}-alloc-${index}`} style={{ fontSize: 13 }}>
                              {item.accountName} • {item.paymentMethod} • {formatCurrency(item.amount || 0, settings)}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && records.length === 0 && <tr><td colSpan="7" style={{ padding: 12, color: '#64748b' }}>No reconciliation records found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'approvals' && canApproveAnything && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>Pending Approvals</h2>
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
                Review deposit proofs and confirm the total matches the sales days before approval.
              </div>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
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
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {(row.allocations || []).map((item, index) => item.proofImage ? (
                          <a key={`${row._id}-proof-${index}`} href={item.proofImage} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                            <img src={item.proofImage} alt={item.proofName || 'proof'} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
                          </a>
                        ) : null)}
                      </div>
                    </td>
                    <td>{row.status}</td>
                    <td>
                      {(row.status === 'pending_director' && canApproveDirector) || (row.status === 'pending_manager' && canApproveManager) ? (
                        <>
                          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); onApproveRecord(row); }} disabled={workingApprovalId === row.approvalId}>
                            {workingApprovalId === row.approvalId ? 'Working…' : 'Approve'}
                          </button>
                          <button className="btn" onClick={(e) => { e.stopPropagation(); onRejectRecord(row); }} disabled={workingApprovalId === row.approvalId} style={{ marginLeft: 6 }}>
                            {workingApprovalId === row.approvalId ? 'Working…' : 'Reject'}
                          </button>
                        </>
                      ) : (
                        <span style={{ color: '#64748b' }}>Waiting</span>
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
              <button className="btn btn-primary" onClick={submitReconciliation} disabled={saving || loadingBacklog}>
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
                  <BranchSelect value={submitBranchId} onChange={handleSubmitBranchChange} enforceRole={false} overrideBranches={allowedSubmitBranches} />
                </label>
                <button className="btn" onClick={() => loadBacklog(submitBranchId)} disabled={loadingBacklog}>
                  {loadingBacklog ? 'Loading…' : 'Refresh Dates'}
                </button>
              </div>
              <div style={{ color: '#64748b', fontSize: 13 }}>
                The system loads only dates with sales that are not yet deposited for the selected branch.
              </div>
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
                  {backlogRows.map((row) => (
                    <tr key={`${row.branchId}:${row.date}`}>
                      <td><input type="checkbox" checked={selectedDates.includes(String(row.date))} onChange={() => toggleDate(String(row.date))} /></td>
                      <td>{row.date}</td>
                      <td>{row.branchName}</td>
                      <td align="right">{formatCurrency(row.expectedAmount || 0, settings)}</td>
                      <td>{(row.paymentBreakdown || []).map((item) => `${item.paymentMethod}: ${formatCurrency(item.amount || 0, settings)}`).join(' • ') || '—'}</td>
                    </tr>
                  ))}
                  {!loadingBacklog && backlogRows.length === 0 && (
                    <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>No unreconciled sales days found for this branch and date range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Selected Sales Days</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{selectedDates.length}</div>
              </div>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Expected Amount</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{formatCurrency(expectedAmount || 0, settings)}</div>
              </div>
              <div className="card" style={{ background: '#f8fafc' }}>
                <div style={{ color: '#64748b' }}>Entered Amount</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: Math.abs(enteredAmount - expectedAmount) < 0.005 ? '#16a34a' : '#dc2626' }}>{formatCurrency(enteredAmount || 0, settings)}</div>
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
                <div key={`alloc-${index}`} className="card" style={{ background: '#f8fafc', display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <strong>Allocation {index + 1}</strong>
                    <button className="btn" onClick={() => removeAllocation(index)} disabled={allocations.length === 1}>Remove</button>
                  </div>
                  <div className="responsive-filter-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 12 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>Account</span>
                      <select className="select" value={item.accountId} onChange={(e) => updateAllocation(index, { accountId: e.target.value })}>
                        <option value="">Select account</option>
                        {visibleAccounts.map((account) => (
                          <option key={account._id} value={account._id}>{account.name}{account.bankName ? ` - ${account.bankName}` : ''}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>Payment Method</span>
                      <select className="select" value={item.paymentMethod} onChange={(e) => updateAllocation(index, { paymentMethod: e.target.value })}>
                        {PAYMENT_METHOD_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>Amount</span>
                      <input className="input" type="number" min="0" step="0.01" value={item.amount} onChange={(e) => updateAllocation(index, { amount: e.target.value })} />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span>Proof of Deposit</span>
                      <input className="input" type="file" accept="image/*" onChange={(e) => onAllocationFileChange(index, e.target.files?.[0] || null)} />
                    </label>
                  </div>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span>Allocation Note</span>
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
