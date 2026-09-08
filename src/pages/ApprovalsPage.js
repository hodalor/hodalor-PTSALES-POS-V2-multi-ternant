import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { approveApproval, listApprovals, rejectApproval } from '../api/approvals';
import { useToast } from '../components/ToastProvider';
import { promptDialog } from '../utils/dialogs';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import LoadingDots from '../components/LoadingDots';
import { getProductDisplayMeta } from '../utils/inventoryFilters';

function normalizeBranchIds(value) {
  if (value === 'all') return 'all';
  return Array.from(new Set(
    (Array.isArray(value) ? value : [value])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function normalizeRefundArea(value = '') {
  const area = String(value || '').trim().toLowerCase();
  if (area === 'warehouse') return 'warehouse';
  if (area === 'distribution' || area === 'wholesale') return 'distribution';
  return 'retail';
}

function getSaleRefundArea(sale = {}) {
  const inventoryType = String(sale?.inventoryType || sale?.posType || 'retail').trim().toLowerCase();
  if (inventoryType === 'warehouse') return 'warehouse';
  if (inventoryType === 'distribution' || inventoryType === 'wholesale') return 'distribution';
  return 'retail';
}

function inferAreaFromBranch(branch = {}, branchId = '') {
  const text = `${branchId || ''} ${branch?.name || ''} ${branch?.code || ''}`.trim().toLowerCase();
  if (text.includes('warehouse')) return 'warehouse';
  if (text.includes('wholesale') || text.includes('distribution')) return 'distribution';
  return 'retail';
}

function getApprovalStatusMeta(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'approved') return { label: 'Approved', tone: 'success' };
  if (value === 'rejected') return { label: 'Rejected', tone: 'danger' };
  if (value === 'pending_manager') return { label: 'Pending Manager', tone: 'warning' };
  if (value === 'pending_director') return { label: 'Pending Director', tone: 'info' };
  if (value === 'pending_approval') return { label: 'Pending Approval', tone: 'info' };
  return { label: status || 'Unknown', tone: 'info' };
}

function ApprovalsPage() {
  const toast = useToast();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const products = useSelector((s) => s.products.products);
  const branches = useSelector((s) => s.branches.branches);
  const sales = useSelector((s) => s.sales.sales || []);
  const refunds = useSelector((s) => s.refunds.requests || []);
  const auth = useSelector((s) => s.auth);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('pending_director');
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = useMemo(() => (Array.isArray(auth.grants) ? auth.grants : []), [auth.grants]);

  const branchNameById = useMemo(() => {
    const map = new Map();
    branches.forEach((branch) => {
      const label = branch.name || branch.code || branch.id || branch._id;
      if (branch.id) map.set(String(branch.id), label);
      if (branch._id) map.set(String(branch._id), label);
    });
    return map;
  }, [branches]);
  const branchById = useMemo(() => {
    const map = new Map();
    branches.forEach((branch) => {
      if (branch?.id) map.set(String(branch.id), branch);
      if (branch?._id) map.set(String(branch._id), branch);
    });
    return map;
  }, [branches]);
  const salesById = useMemo(() => new Map((sales || []).map((row) => [String(row?.id || row?._id || row?.clientId || ''), row])), [sales]);
  const resolveRefundArea = useCallback((row = {}) => {
    const explicit = String(row?.refundArea || '').trim().toLowerCase();
    if (explicit === 'warehouse' || explicit === 'distribution' || explicit === 'wholesale') return normalizeRefundArea(explicit);
    const linkedSale = salesById.get(String(row?.saleId || ''))
      || (sales || []).find((sale) => (
        String(sale?.invoiceSerial || '').trim().toLowerCase() === String(row?.invoiceSerial || '').trim().toLowerCase()
        || String(sale?.receiptNumber || '').trim().toLowerCase() === String(row?.receiptNumber || '').trim().toLowerCase()
      ));
    if (linkedSale) return getSaleRefundArea(linkedSale);
    const branchArea = inferAreaFromBranch(branchById.get(String(row?.branchId || '')), row?.branchId);
    if (branchArea !== 'retail') return branchArea;
    const refText = `${row?.invoiceSerial || ''} ${row?.receiptNumber || ''}`.trim().toLowerCase();
    if (refText.includes('warehouse')) return 'warehouse';
    if (refText.includes('wholesale') || refText.includes('distribution')) return 'distribution';
    return normalizeRefundArea(explicit);
  }, [branchById, sales, salesById]);
  const canAccessBranch = useCallback((branchId = '') => {
    if (['superadmin', 'admin'].includes(roleLower)) return true;
    const normalizedBranchId = String(branchId || '').trim();
    if (!normalizedBranchId) return false;
    const assigned = normalizeBranchIds(auth.user?.assignedBranches);
    if (assigned === 'all') return true;
    const accessible = normalizeBranchIds([auth.user?.branchId, ...(Array.isArray(assigned) ? assigned : [])]);
    return accessible.includes(normalizedBranchId);
  }, [auth.user, roleLower]);
  const canReviewRefund = useCallback((row = {}) => {
    if (['superadmin', 'admin'].includes(roleLower)) return true;
    if (grants.includes('approve_refunds')) return true;
    const area = resolveRefundArea(row);
    if (area === 'warehouse') return roleLower === 'director' || roleLower === 'manager' || grants.includes('approve_warehouse_director') || grants.includes('approve_warehouse_manager');
    if (area === 'distribution') return roleLower === 'director' || roleLower === 'manager' || grants.includes('approve_distribution_director') || grants.includes('approve_distribution_manager');
    return roleLower === 'manager' || grants.includes('approve_retail_director') || grants.includes('approve_retail_manager');
  }, [grants, roleLower, resolveRefundArea]);

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

  const refundApprovalRows = useMemo(() => (
    (refunds || [])
      .filter((row) => canReviewRefund(row) && canAccessBranch(row?.branchId))
      .filter((row) => {
        const rowStatus = String(row?.status || '').trim().toLowerCase();
        if (status === 'all') return true;
        if (status === 'pending_director' || status === 'pending_manager') return rowStatus === 'pending_approval';
        return rowStatus === status;
      })
      .map((row) => ({
        ...row,
        _id: `refund-${String(row?.id || row?._id || row?.clientId || '')}`,
        referenceModel: 'RefundRequest',
        actionType: `${resolveRefundArea(row)}_refund`,
        createdAt: row?.created_at || row?.createdAt || null
      }))
  ), [refunds, status, canAccessBranch, canReviewRefund, resolveRefundArea]);
  const grouped = useMemo(() => [...rows, ...refundApprovalRows].slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [rows, refundApprovalRows]);
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
    if (String(row?.referenceModel || '') === 'RefundRequest') {
      return (
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ color: '#111827' }}>{row?.invoiceSerial || row?.receiptNumber || row?.saleId || 'Refund Request'}</div>
          <div style={{ color: '#64748b', fontSize: 12 }}>
            {String(row?.type || '').toUpperCase()} refund in {resolveRefundArea(row)}
          </div>
        </div>
      );
    }
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
    if (String(row?.referenceModel || '') === 'RefundRequest') {
      return branchNameById.get(String(row?.branchId || '')) || row?.branchId || '—';
    }
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
            Director and manager approval queue for stock operations, refunds, and related approval-controlled workflows.
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
                const isRefundRow = String(row?.referenceModel || '') === 'RefundRequest';
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
                      {isRefundRow ? (
                        <div className="sales-row-actions">
                          <button className="btn btn-primary btn-compact" onClick={() => navigate(`/refund-approvals?refundId=${encodeURIComponent(String(row?.id || row?.clientId || ''))}`)}>
                            Review
                          </button>
                        </div>
                      ) : isPending ? (
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
