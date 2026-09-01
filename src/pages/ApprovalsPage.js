import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { approveApproval, listApprovals, rejectApproval } from '../api/approvals';
import { useToast } from '../components/ToastProvider';
import { promptDialog } from '../utils/dialogs';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import LoadingDots from '../components/LoadingDots';
import { getProductDisplayMeta } from '../utils/inventoryFilters';

function getApprovalStatusMeta(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'approved') return { label: 'Approved', tone: 'success' };
  if (value === 'rejected') return { label: 'Rejected', tone: 'danger' };
  if (value === 'pending_manager') return { label: 'Pending Manager', tone: 'warning' };
  if (value === 'pending_director') return { label: 'Pending Director', tone: 'info' };
  return { label: status || 'Unknown', tone: 'info' };
}

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
    branches.forEach((branch) => {
      const label = branch.name || branch.code || branch.id || branch._id;
      if (branch.id) map.set(String(branch.id), label);
      if (branch._id) map.set(String(branch._id), label);
    });
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
  const summaryCards = useMemo(() => ([
    {
      key: 'total',
      label: 'Queue Size',
      value: grouped.length,
      accent: '#2563eb'
    },
    {
      key: 'director',
      label: 'Pending Director',
      value: grouped.filter((row) => String(row?.status || '').toLowerCase() === 'pending_director').length,
      accent: '#0f766e'
    },
    {
      key: 'manager',
      label: 'Pending Manager',
      value: grouped.filter((row) => String(row?.status || '').toLowerCase() === 'pending_manager').length,
      accent: '#f59e0b'
    },
    {
      key: 'resolved',
      label: 'Resolved',
      value: grouped.filter((row) => ['approved', 'rejected'].includes(String(row?.status || '').toLowerCase())).length,
      accent: '#7c3aed'
    }
  ]), [grouped]);

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
                {(!meta.productName || meta.productName === item?.productId) && (item?.name || item?.sku) ? (
                  <div style={{ color: '#111827' }}>{item?.name || item?.sku}</div>
                ) : null}
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
    const branchLabel = branchNameById.get(String(row?.branchId || '')) || row?.branchName || row?.transactionTitle || row?.branchId || '—';
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
    <div className="sales-page-shell">
      <div className="sales-header">
        <div className="sales-header-copy">
          <div className="ui-eyebrow">Control Center</div>
          <h1 className="sales-title">Approvals</h1>
          <p className="sales-subtitle">
            Director and manager approval queue for stock operations and related approval-controlled workflows.
          </p>
        </div>
        <div className="sales-header-actions">
          <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="pending_director">Pending Director</option>
            <option value="pending_manager">Pending Manager</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <button className="btn" onClick={() => load(status)} disabled={loading}>
            {loading ? <LoadingDots label="Loading approvals" /> : 'Refresh'}
          </button>
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

      <div className="sales-section-card">
        <div className="sales-section-head">
          <div>
            <h2 className="sales-section-title">Approval Queue</h2>
            <p className="sales-section-note">
              Track who initiated, who reviewed, and what still needs action from this screen.
            </p>
          </div>
        </div>
        <div className="sales-table-meta">
          <div className="sales-results-note">
            {loading ? 'Loading approvals...' : `${grouped.length} approval${grouped.length === 1 ? '' : 's'} found`}
          </div>
        </div>
        <div className="table-wrap">
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
                <th align="left">Action</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((row) => {
                const statusMeta = getApprovalStatusMeta(row?.status);
                const busy = workingId === row._id;
                const isPending = row.status === 'pending_director' || row.status === 'pending_manager';
                return (
                  <tr key={row._id}>
                    <td>
                      <div className="sales-ref-cell">
                        <span className="sales-ref-primary">{row.actionType || '—'}</span>
                      </div>
                    </td>
                    <td>{renderProducts(row)}</td>
                    <td>{renderRoute(row)}</td>
                    <td>{row.referenceModel}</td>
                    <td>{formatActor(row.initiatedByName, row.initiatedByRole)}</td>
                    <td>{formatActor(row.directorApprovedByName, row.directorApprovedByRole)}</td>
                    <td>{formatActor(row.managerApprovedByName, row.managerApprovedByRole)}</td>
                    <td>
                      <span className={`status-badge ${statusMeta.tone}`}>{statusMeta.label}</span>
                    </td>
                    <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
                    <td>
                      {isPending ? (
                        <div className="sales-row-actions">
                          <button className="btn btn-primary btn-compact" onClick={() => onApprove(row)} disabled={busy}>
                            {busy ? 'Working…' : 'Approve'}
                          </button>
                          <button className="btn btn-compact" onClick={() => onReject(row)} disabled={busy}>
                            {busy ? 'Working…' : 'Reject'}
                          </button>
                        </div>
                      ) : (
                        <span className={`status-badge ${statusMeta.tone}`}>{statusMeta.label}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && grouped.length === 0 && (
                <tr>
                  <td colSpan="10" style={{ padding: 12, color: '#64748b' }}>No approvals found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ApprovalsPage;
