import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import * as expensesApi from '../api/expenses';
import { useToast } from '../components/ToastProvider';
import { formatCurrency } from '../utils/currency';
import BranchSelect from '../components/BranchSelect';
import Modal from '../components/Modal';
import { enqueueHttp } from '../offline/offlineBackup';
import { promptDialog } from '../utils/dialogs';
import LoadingDots from '../components/LoadingDots';

function ExpenseApprovalsPage() {
  const settings = useSelector(s => s.settings);
  const branches = useSelector(s => s.branches.branches);
  const auth = useSelector(s => s.auth);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const toast = useToast();

  function has(g) {
    if (!g) return false;
    if (roleLower === 'superadmin') return true;
    return grants.includes(g);
  }
  const canApprove = (['admin','manager','superadmin'].includes(roleLower)) || has('approve_expenses');

  const [statusFilter, setStatusFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [branchFilter, setBranchFilter] = useState('');
  const [reloadAt, setReloadAt] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        let list = await expensesApi.listRequests({ status: statusFilter, limit: 300 });
        if ((!Array.isArray(list) || list.length === 0) && (statusFilter === 'pending' || statusFilter === 'approved' || statusFilter === 'rejected')) {
          const all = await expensesApi.listRequests({ limit: 300 });
          const wanted = statusFilter === 'pending' ? ['pending', 'pending_approval'] : [statusFilter];
          list = Array.isArray(all) ? all.filter(r => wanted.includes(String(r.status || ''))) : [];
        }
        if (alive) setRows(Array.isArray(list) ? list : []);
      } catch (e) {
        if (alive) {
          setRows([]);
          try { toast.show(String(e?.message || 'Failed to load requests'), { type: 'error' }); } catch {}
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [statusFilter, reloadAt]);

  const byId = useMemo(() => {
    const map = new Map();
    branches.forEach(b => map.set(b.id, b.name || b.code || b.id));
    return map;
  }, [branches]);

  const filtered = useMemo(() => rows.filter(r => !branchFilter || r.branchId === branchFilter), [rows, branchFilter]);

  async function approve(r) {
    if (!canApprove) { toast.show('Not authorized to approve expenses', { type: 'error' }); return; }
    const id = r._id || r.clientId;
    try {
      const remark = await promptDialog('Enter remark for approval (required)');
      if (!remark || !String(remark).trim()) { toast.show('Remark is required', { type: 'error' }); return; }
      setBusyId(id);
      if (!navigator.onLine) {
        await enqueueHttp({ collection: 'expenserequests', label: 'Expense approve', path: '/api/expenses/approve', method: 'POST', body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark } });
      } else {
        await expensesApi.approve({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
      }
      setRows(prev => prev.map(x => String(x._id || x.clientId) === String(id) ? { ...x, status: 'approved', approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', approvalRemark: remark, approved_at: new Date().toISOString() } : x));
      toast.show('Expense approved', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to approve'), { type: 'error' });
    } finally { setBusyId(null); }
  }
  async function reject(r) {
    if (!canApprove) { toast.show('Not authorized to reject expenses', { type: 'error' }); return; }
    const id = r._id || r.clientId;
    try {
      const remark = await promptDialog('Enter reason for rejection (required)');
      if (!remark || !String(remark).trim()) { toast.show('Remark is required', { type: 'error' }); return; }
      setBusyId(id);
      if (!navigator.onLine) {
        await enqueueHttp({ collection: 'expenserequests', label: 'Expense reject', path: '/api/expenses/reject', method: 'POST', body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark } });
      } else {
        await expensesApi.reject({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
      }
      setRows(prev => prev.map(x => String(x._id || x.clientId) === String(id) ? { ...x, status: 'rejected', approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', rejectionRemark: remark, rejected_at: new Date().toISOString() } : x));
      toast.show('Expense rejected', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to reject'), { type: 'error' });
    } finally { setBusyId(null); }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Expense Approvals</h1>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={statusFilter === 'pending' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending')}>Pending</button>
            <button className={statusFilter === 'approved' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('approved')}>Approved</button>
            <button className={statusFilter === 'rejected' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('rejected')}>Rejected</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="muted small">Branch</span>
            <BranchSelect value={branchFilter} onChange={setBranchFilter} enforceRole={false} includeAll allLabel="All branches" />
            <button className="btn" onClick={() => setReloadAt(Date.now())} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
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
            {loading && <tr><td colSpan="6" style={{ padding: 12, color: '#64748b' }}><LoadingDots label="Loading expense approvals" /></td></tr>}
            {!loading && filtered.map(r => (
              <tr key={String(r._id || r.id || r.clientId)} style={{ borderTop: '1px solid #e2e8f0', cursor: 'pointer' }} onClick={() => setDetail(r)}>
                <td>{new Date(r.date).toLocaleDateString()}</td>
                <td>{byId.get(r.branchId) || r.branchId}</td>
                <td>{r.category}</td>
                <td>{r.note || '—'}</td>
                <td>{formatCurrency(Number(r.amount) || 0, settings)}</td>
                <td>
                  {r.status === 'pending_approval' ? (
                    <>
                      <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); approve(r); }} disabled={!canApprove || busyId === (r._id || r.clientId)}>{busyId === (r._id || r.clientId) ? 'Working…' : 'Approve'}</button>
                      <button className="btn" onClick={(e) => { e.stopPropagation(); reject(r); }} style={{ marginLeft: 6 }} disabled={!canApprove || busyId === (r._id || r.clientId)}>{busyId === (r._id || r.clientId) ? 'Working…' : 'Reject'}</button>
                    </>
                  ) : (
                    <span style={{ color: r.status === 'approved' ? '#10b981' : '#ef4444', fontWeight: 600 }}>{r.status}</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan="6" style={{ padding: 12, color: '#64748b' }}>No items</td></tr>}
          </tbody>
        </table>
      </div>
      {detail && (
        <Modal title="Expense Request" onClose={() => setDetail(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><div style={{ color: '#64748b' }}>Status</div><div>{detail.status}</div></div>
            <div><div style={{ color: '#64748b' }}>Date</div><div>{new Date(detail.date).toLocaleDateString()}</div></div>
            <div><div style={{ color: '#64748b' }}>Branch</div><div>{byId.get(detail.branchId) || detail.branchId}</div></div>
            <div><div style={{ color: '#64748b' }}>Category</div><div>{detail.category}</div></div>
            <div><div style={{ color: '#64748b' }}>Amount</div><div>{formatCurrency(Number(detail.amount) || 0, settings)}</div></div>
            <div style={{ gridColumn: '1 / -1' }}><div style={{ color: '#64748b' }}>Note</div><div>{detail.note || '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Initiator</div><div>{detail.initiatorName || '—'} {detail.initiatorRole ? `(${detail.initiatorRole})` : ''}</div></div>
            <div><div style={{ color: '#64748b' }}>Approver</div><div>{detail.approverName ? `${detail.approverName}${detail.approverRole ? ` (${detail.approverRole})` : ''}` : '—'}</div></div>
            {detail.status === 'approved' && <div><div style={{ color: '#64748b' }}>Approval Remark</div><div>{detail.approvalRemark || '—'}</div></div>}
            {detail.status === 'rejected' && <div><div style={{ color: '#64748b' }}>Rejection Remark</div><div>{detail.rejectionRemark || '—'}</div></div>}
            <div><div style={{ color: '#64748b' }}>Created</div><div>{detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Updated</div><div>{detail.updatedAt ? new Date(detail.updatedAt).toLocaleString() : '—'}</div></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default ExpenseApprovalsPage;
