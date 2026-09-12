import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { approveApproval, listApprovals, rejectApproval } from '../api/approvals';
import { useToast } from '../components/ToastProvider';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import LoadingDots from '../components/LoadingDots';
import { getProductDisplayMeta } from '../utils/inventoryFilters';
import Modal from '../components/Modal';

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

function normalizeReviewStatus(value) {
  return String(value || '').toLowerCase() === 'cancelled' ? 'cancelled' : 'accepted';
}

function normalizeReviewItemsForCompare(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    lineId: String(item?.lineId || `${index + 1}`),
    productId: String(item?.productId || ''),
    variantId: String(item?.variantId || ''),
    qty: Math.max(0, Number(item?.qty || 0)),
    unitIds: Array.isArray(item?.unitIds) ? item.unitIds.map(String).filter(Boolean) : [],
    selectedUnits: Array.isArray(item?.selectedUnits)
      ? item.selectedUnits.map((unit) => ({
          unitId: String(unit?.unitId || ''),
          imei: String(unit?.imei || '').trim(),
          serialNumber: String(unit?.serialNumber || '').trim()
        }))
      : [],
    serializedEntries: Array.isArray(item?.serializedEntries)
      ? item.serializedEntries.map((entry) => ({
          imei: String(entry?.imei || '').trim(),
          serialNumber: String(entry?.serialNumber || '').trim()
        }))
      : [],
    status: normalizeReviewStatus(item?.status)
  }));
}

function formatAdjustmentTypeLabel(value) {
  return String(value || '').toLowerCase() === 'decrease' ? 'Decrease' : 'Increase';
}

function summarizeAdjustmentType(row, items = []) {
  const itemTypes = Array.from(new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item?.adjustmentType || '').toLowerCase())
      .filter(Boolean)
  ));
  if (itemTypes.length > 1) return 'Mixed Adjustment';
  if (itemTypes.length === 1) return formatAdjustmentTypeLabel(itemTypes[0]);
  return formatAdjustmentTypeLabel(row?.adjustmentType || 'increase');
}

function getAdjustmentTypePillStyle(label) {
  const lower = String(label || '').toLowerCase();
  if (lower.includes('decrease')) {
    return { background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' };
  }
  if (lower.includes('mixed')) {
    return { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' };
  }
  return { background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857' };
}

function computeApprovalValue(row = {}) {
  const items = Array.isArray(row?.items) ? row.items : [];
  if (items.length > 0) {
    const summed = items.reduce((sum, item) => sum + (Number(item?.qty || 0) * Number(item?.cost || 0)), 0);
    if (summed > 0) return summed;
  }
  if (String(row?.operationType || '').toLowerCase() === 'refund') return Number(row?.requestedAmount || 0);
  return Number(row?.cost || 0) * Math.max(1, Number(row?.qty || 0));
}

function buildReviewConflict(error) {
  const data = error?.data && typeof error.data === 'object' ? error.data : {};
  const unavailableUnitCodes = Array.isArray(data?.unavailableUnitCodes) ? data.unavailableUnitCodes.map(String).filter(Boolean) : [];
  if (unavailableUnitCodes.length === 0 && !Number.isFinite(Number(data?.availableQty)) && !Number.isFinite(Number(data?.lockedQty))) return null;
  return {
    message: String(data?.error || error?.message || '').trim(),
    unavailableUnitCodes,
    currentStock: Number.isFinite(Number(data?.currentStock)) ? Number(data.currentStock) : null,
    lockedQty: Number.isFinite(Number(data?.lockedQty)) ? Number(data.lockedQty) : null,
    availableQty: Number.isFinite(Number(data?.availableQty)) ? Number(data.availableQty) : null
  };
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
  const [selectedRow, setSelectedRow] = useState(null);
  const [reviewItems, setReviewItems] = useState([]);
  const [decisionRemark, setDecisionRemark] = useState('');
  const [reviewConflict, setReviewConflict] = useState(null);
  const [reviewing, setReviewing] = useState(false);
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
  const canApproveAreaStage = useCallback((area = 'distribution', stage = 'director') => {
    const normalizedArea = String(area || '').toLowerCase() === 'warehouse'
      ? 'warehouse'
      : String(area || '').toLowerCase() === 'retail'
        ? 'retail'
        : 'distribution';
    if (stage === 'director') {
      if (['superadmin', 'admin', 'director'].includes(roleLower)) return true;
      if (normalizedArea === 'warehouse') return grants.includes('approve_warehouse_director');
      if (normalizedArea === 'distribution') return grants.includes('approve_distribution_director');
      return grants.includes('approve_retail_director') || grants.includes('approve_transfers');
    }
    if (['superadmin', 'admin', 'manager'].includes(roleLower)) return true;
    if (normalizedArea === 'warehouse') return grants.includes('approve_warehouse_manager');
    if (normalizedArea === 'distribution') return grants.includes('approve_distribution_manager');
    return grants.includes('approve_retail_manager') || grants.includes('approve_transfers');
  }, [grants, roleLower]);

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

  useEffect(() => {
    if (!selectedRow || String(selectedRow?.referenceModel || '') !== 'WholesaleOperation') {
      setReviewItems([]);
      setDecisionRemark('');
      setReviewConflict(null);
      return;
    }
    setReviewItems(
      Array.isArray(selectedRow.items) && selectedRow.items.length > 0
        ? selectedRow.items.map((item, index) => ({
            lineId: item.lineId || `${index + 1}`,
            productId: item.productId,
            variantId: item.variantId || '',
            qty: Number(item.qty || 0),
            unitIds: Array.isArray(item.unitIds) ? item.unitIds.map(String) : [],
            selectedUnits: Array.isArray(item.selectedUnits) ? item.selectedUnits.map((unit) => ({ unitId: unit?.unitId || '', imei: unit?.imei || '', serialNumber: unit?.serialNumber || '' })) : [],
            serializedEntries: Array.isArray(item.serializedEntries) ? item.serializedEntries.map((entry) => ({ imei: entry?.imei || '', serialNumber: entry?.serialNumber || '' })) : [],
            adjustmentType: item.adjustmentType || 'increase',
            status: normalizeReviewStatus(item.status),
            reason: item.reason || '',
            remark: item.remark || ''
          }))
        : [{
            lineId: '1',
            productId: selectedRow.productId,
            variantId: selectedRow.variantId || '',
            qty: Number(selectedRow.qty || 0),
            unitIds: Array.isArray(selectedRow.unitIds) ? selectedRow.unitIds.map(String) : [],
            selectedUnits: Array.isArray(selectedRow.selectedUnits) ? selectedRow.selectedUnits.map((unit) => ({ unitId: unit?.unitId || '', imei: unit?.imei || '', serialNumber: unit?.serialNumber || '' })) : [],
            serializedEntries: Array.isArray(selectedRow.serializedEntries) ? selectedRow.serializedEntries.map((entry) => ({ imei: entry?.imei || '', serialNumber: entry?.serialNumber || '' })) : [],
            adjustmentType: selectedRow.adjustmentType || 'increase',
            status: 'accepted',
            reason: selectedRow.reason || '',
            remark: selectedRow.remark || ''
          }]
    );
  }, [selectedRow]);

  const selectedAdjustmentLabel = useMemo(
    () => summarizeAdjustmentType(selectedRow, reviewItems),
    [reviewItems, selectedRow]
  );
  const canActOnSelectedRow = useMemo(() => {
    if (!selectedRow || String(selectedRow?.referenceModel || '') !== 'WholesaleOperation') return false;
    const stage = String(selectedRow?.status || '').toLowerCase();
    if (!['pending_director', 'pending_manager'].includes(stage)) return false;
    const candidateAreas = Array.from(new Set([
      String(selectedRow?.operationArea || '').toLowerCase(),
      String(selectedRow?.fromInventoryType || '').toLowerCase(),
      String(selectedRow?.toInventoryType || '').toLowerCase()
    ].filter(Boolean).map((area) => area === 'wholesale' ? 'distribution' : area)));
    return candidateAreas.some((area) => canApproveAreaStage(area, stage === 'pending_director' ? 'director' : 'manager'));
  }, [canApproveAreaStage, selectedRow]);
  const hasManagerTransferReviewChanges = useMemo(() => {
    if (!selectedRow) return false;
    if (String(selectedRow?.referenceModel || '') !== 'WholesaleOperation') return false;
    if (String(selectedRow?.operationType || '').toLowerCase() !== 'transfer') return false;
    if (String(selectedRow?.status || '').toLowerCase() !== 'pending_manager') return false;
    const originalSource = Array.isArray(selectedRow?.items) && selectedRow.items.length > 0
      ? selectedRow.items
      : [{
          lineId: '1',
          productId: selectedRow.productId,
          variantId: selectedRow.variantId || '',
          qty: Number(selectedRow.qty || 0),
          unitIds: Array.isArray(selectedRow.unitIds) ? selectedRow.unitIds.map(String) : [],
          selectedUnits: Array.isArray(selectedRow.selectedUnits) ? selectedRow.selectedUnits : [],
          serializedEntries: Array.isArray(selectedRow.serializedEntries) ? selectedRow.serializedEntries : [],
          status: 'accepted'
        }];
    return JSON.stringify(normalizeReviewItemsForCompare(originalSource)) !== JSON.stringify(normalizeReviewItemsForCompare(reviewItems));
  }, [reviewItems, selectedRow]);

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

  function openReview(row) {
    if (String(row?.referenceModel || '') === 'RefundRequest') {
      navigate(`/refund-approvals?refundId=${encodeURIComponent(String(row?.id || row?.clientId || ''))}`);
      return;
    }
    setSelectedRow(row);
    setDecisionRemark('');
    setReviewConflict(null);
  }

  function closeReview() {
    if (reviewing) return;
    setSelectedRow(null);
    setReviewConflict(null);
    setDecisionRemark('');
  }

  async function reviewAction(action) {
    if (!selectedRow || !canActOnSelectedRow || reviewing) return;
    const remark = String(decisionRemark || '').trim();
    if (!remark) {
      toast.show(action === 'approve' ? 'Approval remark is required' : 'Reason is required', { type: 'error' });
      return;
    }
    setReviewing(true);
    setWorkingId(selectedRow._id || '');
    try {
      const normalizedItems = reviewItems.map((item) => ({ ...item, status: normalizeReviewStatus(item.status) }));
      if (action === 'approve') {
        const response = await approveApproval(selectedRow._id, {
          remark,
          items: normalizedItems,
          resubmitToDirector: hasManagerTransferReviewChanges
        });
        const nextStatus = String(response?.status || '').toLowerCase();
        if (nextStatus === 'pending_director') {
          toast.show('Transfer changes were sent back for director approval', { type: 'success' });
        } else if (nextStatus === 'pending_manager') {
          toast.show('Director approval recorded. Waiting for manager approval.', { type: 'success' });
        } else {
          toast.show('Approval updated', { type: 'success' });
        }
        if (nextStatus === 'approved') {
          const affectedProductIds = Array.from(new Set(
            (Array.isArray(selectedRow?.items) && selectedRow.items.length > 0 ? selectedRow.items : [{ productId: selectedRow?.productId }])
              .map((item) => String(item?.productId || ''))
              .filter(Boolean)
          ));
          void refreshAffectedProducts(dispatch, affectedProductIds);
        }
      } else {
        await rejectApproval(selectedRow._id, { reason: remark });
        toast.show('Approval rejected', { type: 'success' });
      }
      closeReview();
      void load(status, { force: true });
    } catch (e) {
      const msg = String(e?.message || '');
      if (/404|not found/i.test(msg)) {
        closeReview();
        void load(status, { force: true });
        toast.show('Approval was already processed. List refreshed.', { type: 'warning' });
      } else {
        setReviewConflict(buildReviewConflict(e));
        toast.show(msg || `Failed to ${action}`, { type: 'error' });
      }
    } finally {
      setReviewing(false);
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
                const isRefundRow = String(row?.referenceModel || '') === 'RefundRequest';
                return (
                  <tr key={row._id} onClick={() => openReview(row)} style={{ cursor: 'pointer' }}>
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
                      <div className="sales-row-actions">
                        <button className="btn btn-primary btn-compact" onClick={(e) => { e.stopPropagation(); openReview(row); }} disabled={busy}>
                          {busy ? 'Working…' : (isRefundRow ? 'Review' : 'Open')}
                        </button>
                      </div>
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
      {selectedRow && String(selectedRow?.referenceModel || '') === 'WholesaleOperation' && (
        <Modal
          title="Approval Review"
          onClose={closeReview}
          footer={(
            <>
              <button className="btn" onClick={closeReview} disabled={reviewing}>Close</button>
              {canActOnSelectedRow && (
                <>
                  <button className="btn" onClick={() => reviewAction('reject')} disabled={reviewing}>{reviewing ? 'Working…' : 'Reject'}</button>
                  <button className="btn btn-primary" onClick={() => reviewAction('approve')} disabled={reviewing}>
                    {reviewing ? 'Working…' : (hasManagerTransferReviewChanges ? 'Resubmit' : 'Approve')}
                  </button>
                </>
              )}
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            {String(selectedRow.operationType || '').toLowerCase() === 'adjustment' && (
              <div style={{ padding: 12, borderRadius: 12, ...getAdjustmentTypePillStyle(selectedAdjustmentLabel) }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>Adjustment Type</div>
                <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{selectedAdjustmentLabel}</div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Status</div><strong>{getApprovalStatusMeta(selectedRow.status).label}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Action</div><strong>{selectedRow.actionType || '—'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Title</div><strong>{selectedRow.transactionTitle || '—'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Value</div><strong>{computeApprovalValue(selectedRow)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Initiated By</div><strong>{formatActor(selectedRow.initiatedByName, selectedRow.initiatedByRole)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Director</div><strong>{formatActor(selectedRow.directorApprovedByName, selectedRow.directorApprovedByRole)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Manager</div><strong>{formatActor(selectedRow.managerApprovedByName, selectedRow.managerApprovedByRole)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Route</div><strong>{renderRoute(selectedRow)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Created</div><strong>{selectedRow.createdAt ? new Date(selectedRow.createdAt).toLocaleString() : '—'}</strong></div>
            </div>
            <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Reason</div><strong>{selectedRow.reason || '—'}</strong></div>
            <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Remark</div><strong>{selectedRow.remark || selectedRow.approvalRemark || selectedRow.rejectionRemark || '—'}</strong></div>
            {reviewConflict && (
              <div style={{ padding: 12, borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
                <div style={{ fontWeight: 700 }}>{reviewConflict.message || 'Some items are no longer available for approval'}</div>
                {reviewConflict.unavailableUnitCodes.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 13 }}>Unavailable serials: {reviewConflict.unavailableUnitCodes.join(', ')}</div>
                )}
                {reviewConflict.availableQty != null && (
                  <div style={{ marginTop: 6, fontSize: 13 }}>
                    Available now: {reviewConflict.availableQty}
                    {reviewConflict.lockedQty != null ? ` | Locked: ${reviewConflict.lockedQty}` : ''}
                    {reviewConflict.currentStock != null ? ` | Current stock: ${reviewConflict.currentStock}` : ''}
                  </div>
                )}
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Product</th>
                    {String(selectedRow.operationType || '').toLowerCase() === 'adjustment' && <th align="left">Adjustment Type</th>}
                    <th align="left">Qty</th>
                    <th align="left">Units</th>
                    <th align="left">Status</th>
                    <th align="left">Reason</th>
                    <th align="left">Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewItems.map((item, index) => {
                    const meta = getProductDisplayMeta(products, item.productId, item.variantId, item);
                    return (
                      <tr key={item.lineId || index}>
                        <td>
                          <div style={{ color: '#111827' }}>{meta.productName || item.productId || '—'}</div>
                          {meta.secondaryLabel ? <div style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>{meta.secondaryLabel}</div> : null}
                        </td>
                        {String(selectedRow.operationType || '').toLowerCase() === 'adjustment' && <td>{formatAdjustmentTypeLabel(item.adjustmentType || selectedRow.adjustmentType || 'increase')}</td>}
                        <td>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            value={item.qty}
                            onChange={(e) => setReviewItems((prev) => prev.map((row, rowIndex) => rowIndex === index ? { ...row, qty: Number(e.target.value) || 0 } : row))}
                            style={{ width: 90 }}
                            disabled={(Array.isArray(item.unitIds) && item.unitIds.length > 0) || (Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0) || !canActOnSelectedRow || reviewing}
                          />
                        </td>
                        <td>{Array.isArray(item.unitIds) && item.unitIds.length > 0 ? item.unitIds.length : (Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 ? item.serializedEntries.length : '—')}</td>
                        <td>
                          <select
                            className="select"
                            value={normalizeReviewStatus(item.status)}
                            onChange={(e) => setReviewItems((prev) => prev.map((row, rowIndex) => rowIndex === index ? { ...row, status: e.target.value } : row))}
                            disabled={!canActOnSelectedRow || reviewing}
                          >
                            <option value="accepted">Accepted</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </td>
                        <td>{item.reason || '—'}</td>
                        <td>{item.remark || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <label>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>Approval / Rejection Remark</div>
              <textarea className="input" value={decisionRemark} onChange={(e) => setDecisionRemark(e.target.value)} rows={4} style={{ width: '100%', resize: 'vertical' }} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default ApprovalsPage;
