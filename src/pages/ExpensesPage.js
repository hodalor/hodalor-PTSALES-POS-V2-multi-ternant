import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import BranchSelect from '../components/BranchSelect';
import { useToast } from '../components/ToastProvider';
import { formatCurrency } from '../utils/currency';
import * as expensesApi from '../api/expenses';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import Modal from '../components/Modal';
import InlineSpinner from '../components/InlineSpinner';
import LoadingDots from '../components/LoadingDots';

function ExpensesPage() {
  const settings = useSelector(s => s.settings);
  const branches = useSelector(s => s.branches.branches);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const auth = useSelector(s => s.auth);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const toast = useToast();

  const canManage = (['admin','manager','superadmin'].includes(roleLower)) || grants.includes('add_expenses');
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodMode, setPeriodMode] = useState('range');
  const [branchId, setBranchId] = useState(currentBranchId);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [expenseBranchId, setExpenseBranchId] = useState(currentBranchId);
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expenseCategory, setExpenseCategory] = useState('General');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const [removingId, setRemovingId] = useState('');

  useEffect(() => setBranchId(currentBranchId), [currentBranchId]);
  useEffect(() => setExpenseBranchId(currentBranchId), [currentBranchId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const list = await expensesApi.list({ branchId, from: periodMode === 'all_time' ? undefined : (dateFrom || undefined), to: periodMode === 'all_time' ? undefined : (dateTo || undefined) });
        if (!alive) return;
        setRows(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!alive) return;
        setRows([]);
        toast.show(String(e?.message || 'Failed to load expenses'), { type: 'error' });
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [branchId, dateFrom, dateTo, toast, periodMode]);

  const byId = useMemo(() => {
    const map = new Map();
    branches.forEach(b => map.set(b.id, b.name || b.code || b.id));
    return map;
  }, [branches]);

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows]);
  const summary = useMemo(() => ({
    totalRecords: rows.length,
    totalAmount: total,
    averageAmount: rows.length ? total / rows.length : 0,
    categories: new Set(rows.map(r => String(r.category || '').trim()).filter(Boolean)).size
  }), [rows, total]);

  async function addExpense() {
    if (!canManage) {
      toast.show('Not authorized to add expenses', { type: 'error' });
      return;
    }
    if (saving) return;
    const amt = Number(expenseAmount);
    if (!expenseBranchId || !expenseDate || !expenseCategory || !Number.isFinite(amt) || amt <= 0) {
      toast.show('Enter valid branch/date/category/amount', { type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        branchId: expenseBranchId,
        date: expenseDate,
        category: expenseCategory,
        amount: amt,
        note: expenseNote
      };
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: cannot save expense', { type: 'error' });
          return;
        }
        const clientId = `expense-req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await enqueueHttp({ collection: 'expenserequests', label: 'Expense request', path: '/api/expenses/requests', method: 'POST', body: { ...payload, clientId } });
        setExpenseAmount('');
        setExpenseNote('');
        toast.show('Saved offline (request). Will sync when online.', { type: 'success' });
        return;
      }
      await expensesApi.createRequest({ ...payload, clientId: crypto.randomUUID() });
      setExpenseAmount('');
      setExpenseNote('');
      toast.show('Expense request submitted for approval', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to save expense'), { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteExpense(id) {
    if (!canManage) {
      toast.show('Not authorized to delete expenses', { type: 'error' });
      return;
    }
    try {
      setRemovingId(String(id));
      await expensesApi.remove(id);
      setRows(prev => prev.filter(r => String(r._id || r.id) !== String(id)));
      toast.show('Expense deleted', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete expense'), { type: 'error' });
    } finally {
      setRemovingId('');
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Expenses</h1>
        <div className="filter-actions">
          <button className="btn btn-primary" onClick={() => setOpenModal(true)} disabled={!canManage}>
            Add Expense
          </button>
          <OfflineQueueIndicator collection="expenserequests" label="Expenses queued" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Expense Records</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.totalRecords}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Total Spent</div><div style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(summary.totalAmount, settings)}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Average Expense</div><div style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(summary.averageAmount, settings)}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Categories</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.categories}</div></div>
      </div>

      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
        <label>
          Period
          <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
            <option value="range">Custom Range</option>
            <option value="all_time">All Time</option>
          </select>
        </label>
        <label>
          From
          <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
        </label>
        <label>
          To
          <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
        </label>
        <label>
          Branch
          <BranchSelect value={branchId} onChange={setBranchId} />
        </label>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div className="muted small">Total</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{formatCurrency(total, settings)}</div>
          </div>
          <div>
            <div className="muted small">Records</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{rows.length}</div>
          </div>
        </div>
      </div>

      {openModal && (
        <Modal title="Submit Expense Request" onClose={() => setOpenModal(false)} footer={
          <>
            <button className="btn" onClick={() => setOpenModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={async () => { await addExpense(); setOpenModal(false); }} disabled={saving || !canManage}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {saving && <InlineSpinner />}
                {saving ? 'Saving…' : 'Submit For Approval'}
              </span>
            </button>
          </>
        }>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
            <label>
              Branch
              <BranchSelect value={expenseBranchId} onChange={setExpenseBranchId} />
            </label>
            <label>
              Date
              <input className="input" type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} />
            </label>
            <label>
              Category
              <input className="input" value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)} placeholder="e.g. Rent, Fuel, Salary" />
            </label>
            <label>
              Amount
              <input className="input" type="number" min="0" step="0.01" value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} />
            </label>
            <label style={{ gridColumn: '1 / span 3' }}>
              Note
              <input className="input" value={expenseNote} onChange={e => setExpenseNote(e.target.value)} placeholder="Optional note" />
            </label>
          </div>
        </Modal>
      )}

      <div className="card">
        <h2 className="section-title">Expense Records</h2>
        <table className="table">
          <thead>
            <tr>
              <th align="left">Date</th>
              <th align="left">Branch</th>
              <th align="left">Category</th>
              <th align="left">Note</th>
              <th align="left">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={String(r._id || r.id)}>
                <td>{new Date(r.date).toLocaleDateString()}</td>
                <td>{byId.get(r.branchId) || r.branchId}</td>
                <td>{r.category}</td>
                <td>{r.note || '—'}</td>
                <td>{formatCurrency(Number(r.amount) || 0, settings)}</td>
                <td>
                  {canManage && (
                    <button className="btn" onClick={() => deleteExpense(String(r._id || r.id))} disabled={loading || removingId === String(r._id || r.id)}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {removingId === String(r._id || r.id) && <InlineSpinner />}
                        {removingId === String(r._id || r.id) ? 'Deleting…' : 'Delete'}
                      </span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan="6" style={{ padding: 12, color: '#64748b' }}>No expenses found</td></tr>
            )}
            {loading && (
              <tr><td colSpan="6" style={{ padding: 12, color: '#64748b' }}><LoadingDots label="Loading expenses" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ExpensesPage;
