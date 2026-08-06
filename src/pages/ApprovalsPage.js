import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { approveApproval, listApprovals, rejectApproval } from '../api/approvals';
import { useToast } from '../components/ToastProvider';
import { promptDialog } from '../utils/dialogs';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import LoadingDots from '../components/LoadingDots';
import { getProductDisplayMeta } from '../utils/inventoryFilters';

function ApprovalsPage() {
  const toast = useToast();
  const dispatch = useDispatch();
  const products = useSelector((s) => s.products.products);
  const branches = useSelector((s) => s.branches.branches);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('pending_director');
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState('');

  const branchNameById = useMemo(() => {
    const map = new Map();
    branches.forEach((branch) => map.set(String(branch.id), branch.name || branch.code || branch.id));
    return map;
  }, [branches]);

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

  function formatActor(name = '', role = '') {
    const actorName = String(name || '').trim();
    const actorRole = String(role || '').trim();
    if (!actorName) return '—';
    return actorRole ? `${actorName} (${actorRole})` : actorName;
  }

  function renderProducts(row) {
    const items = Array.isArray(row?.items) ? row.items : [];
    if (items.length > 0) {
      const visible = items.slice(0, 3);
      return (
        <div style={{ display: 'grid', gap: 4 }}>
          {visible.map((item, index) => {
            const meta = getProductDisplayMeta(products, item?.productId, item?.variantId, item);
            return (
              <div key={`${row._id}-item-${item?.lineId || index}`} style={{ color: '#111827' }}>
                {meta.productName || item?.productId || '—'} x{Number(item?.qty || 0)}
                {meta.secondaryLabel ? <div style={{ color: '#64748b', fontSize: 12 }}>{meta.secondaryLabel}</div> : null}
              </div>
            );
          })}
          {items.length > 3 ? <div style={{ color: '#64748b', fontSize: 12 }}>+{items.length - 3} more</div> : null}
        </div>
      );
    }
    const meta = getProductDisplayMeta(products, row?.productId, row?.variantId, row);
    return <span>{meta.productName || row?.productId || '—'}</span>;
  }

  function renderRoute(row) {
    if (String(row?.referenceModel || '') !== 'WholesaleOperation') return '—';
    if (String(row?.operationType || '').toLowerCase() === 'transfer') {
      const fromLabel = branchNameById.get(String(row?.fromBranchId || '')) || row?.fromBranchId || '—';
      const toLabel = branchNameById.get(String(row?.toBranchId || '')) || row?.toBranchId || '—';
      return `${fromLabel} -> ${toLabel}`;
    }
    const branchLabel = branchNameById.get(String(row?.branchId || '')) || row?.branchId || '—';
    return branchLabel;
  }

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
          <button className="btn" onClick={() => load(status)} disabled={loading}>{loading ? <LoadingDots label="Loading approvals" /> : 'Refresh'}</button>
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Action</th>
              <th align="left">Products</th>
              <th align="left">Route</th>
              <th align="left">Type</th>
              <th align="left">Initiated By</th>
              <th align="left">Director</th>
              <th align="left">Manager</th>
              <th align="left">Status</th>
              <th align="left">Created</th>
              <th align="left"></th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(row => (
              <tr key={row._id}>
                <td>{row.actionType}</td>
                <td>{renderProducts(row)}</td>
                <td>{renderRoute(row)}</td>
                <td>{row.referenceModel}</td>
                <td>{formatActor(row.initiatedByName, row.initiatedByRole)}</td>
                <td>{formatActor(row.directorApprovedByName, row.directorApprovedByRole)}</td>
                <td>{formatActor(row.managerApprovedByName, row.managerApprovedByRole)}</td>
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
            {!loading && grouped.length === 0 && <tr><td colSpan="10" style={{ padding: 12, color: '#64748b' }}>No approvals found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ApprovalsPage;
