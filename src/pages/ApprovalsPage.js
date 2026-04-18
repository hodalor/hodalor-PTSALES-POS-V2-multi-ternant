import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { approveApproval, listApprovals, rejectApproval } from '../api/approvals';
import { useToast } from '../components/ToastProvider';
import { promptDialog } from '../utils/dialogs';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';

function ApprovalsPage() {
  const toast = useToast();
  const dispatch = useDispatch();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('pending_director');
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState('');

  const load = useCallback(async (nextStatus = status, options = {}) => {
    setLoading(true);
    try {
      const data = await listApprovals(nextStatus === 'all' ? { force: !!options.force } : { status: nextStatus, force: !!options.force });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load approvals'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [status, toast]);

  useEffect(() => {
    load(status);
  }, [load, status]);

  const grouped = useMemo(() => rows.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [rows]);

  async function onApprove(row) {
    const remark = await promptDialog('Approval remark (optional)');
    setWorkingId(row._id || '');
    try {
      await approveApproval(row._id, { remark: String(remark || '') });
      setRows(prev => prev.filter(item => String(item._id) !== String(row._id)));
      toast.show('Approval updated', { type: 'success' });
      void load(status, { force: true });
      if (String(row.referenceModel || '') === 'WholesaleOperation' && String(row.status || '').toLowerCase() === 'pending_manager') {
        void refreshAffectedProducts(dispatch, [row.productId].filter(Boolean));
      }
    } catch (e) {
      const msg = String(e?.message || '');
      if (/404|not found/i.test(msg)) {
        void load(status, { force: true });
        toast.show('Approval was already processed. List refreshed.', { type: 'warning' });
      } else {
        toast.show(msg || 'Failed to approve', { type: 'error' });
      }
    } finally {
      setWorkingId('');
    }
  }

  async function onReject(row) {
    const reason = await promptDialog('Reason for rejection');
    if (!reason || !String(reason).trim()) {
      toast.show('Reason is required', { type: 'error' });
      return;
    }
    setWorkingId(row._id || '');
    try {
      await rejectApproval(row._id, { reason: String(reason || '') });
      setRows(prev => prev.filter(item => String(item._id) !== String(row._id)));
      toast.show('Approval rejected', { type: 'success' });
      void load(status, { force: true });
    } catch (e) {
      const msg = String(e?.message || '');
      if (/404|not found/i.test(msg)) {
        void load(status, { force: true });
        toast.show('Approval was already processed. List refreshed.', { type: 'warning' });
      } else {
        toast.show(msg || 'Failed to reject', { type: 'error' });
      }
    } finally {
      setWorkingId('');
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Approvals Center</h1>
          <div style={{ color: '#64748b', fontSize: 13 }}>Director and manager approval queue for wholesale operations and credit repayments.</div>
        </div>
        <div className="filter-actions">
          <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="pending_director">Pending Director</option>
            <option value="pending_manager">Pending Manager</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <button className="btn" onClick={() => load(status)} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Action</th>
              <th align="left">Type</th>
              <th align="left">Initiated By</th>
              <th align="left">Status</th>
              <th align="left">Created</th>
              <th align="left"></th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(row => (
              <tr key={row._id}>
                <td>{row.actionType}</td>
                <td>{row.referenceModel}</td>
                <td>{row.initiatedByName || '—'} {row.initiatedByRole ? `(${row.initiatedByRole})` : ''}</td>
                <td>{row.status}</td>
                <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
                <td>
                  {(row.status === 'pending_director' || row.status === 'pending_manager') ? (
                    <>
                      <button className="btn btn-primary" onClick={() => onApprove(row)} disabled={workingId === row._id}>{workingId === row._id ? 'Working…' : 'Approve'}</button>
                      <button className="btn" onClick={() => onReject(row)} disabled={workingId === row._id} style={{ marginLeft: 6 }}>{workingId === row._id ? 'Working…' : 'Reject'}</button>
                    </>
                  ) : (
                    <span style={{ color: row.status === 'approved' ? '#16a34a' : '#ef4444', fontWeight: 700 }}>{row.status}</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && grouped.length === 0 && <tr><td colSpan="6" style={{ padding: 12, color: '#64748b' }}>No approvals found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ApprovalsPage;
