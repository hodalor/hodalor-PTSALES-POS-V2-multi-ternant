import { useDispatch, useSelector } from 'react-redux';
import { useEffect, useMemo, useState } from 'react';
import { adjustStock } from '../store/productsSlice';
import { useToast } from '../components/ToastProvider';
import BranchSelect from '../components/BranchSelect';
import { promptDialog } from '../utils/dialogs';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import * as transfersApi from '../api/transfers';
import * as wholesaleApi from '../api/wholesale';
import * as productUnitsApi from '../api/productUnits';
import * as auditsApi from '../api/audits';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import Modal from '../components/Modal';
import ProductLiveSearchField from '../components/ProductLiveSearchField';
import { approveTransfer, createTransferRequest, rejectTransfer, setTransferRequests } from '../store/transfersSlice';
import { removeEntries as removeAuditEntries } from '../store/auditSlice';
import InlineSpinner from '../components/InlineSpinner';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import LoadingDots from '../components/LoadingDots';

function TransfersPage() {
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const audit = useSelector(s => s.audit.entries);
  const [productId, setProductId] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [variantId, setVariantId] = useState('');
  const [fromId, setFromId] = useState(currentBranchId || branches[0]?.id || '');
  const [toId, setToId] = useState(branches.find(b => b.id !== currentBranchId)?.id || branches[1]?.id || branches[0]?.id || '');
  const [qty, setQty] = useState(1);
  const [transactionTitle, setTransactionTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [fActor, setFActor] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodMode, setPeriodMode] = useState('range');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [tab, setTab] = useState('initiate');
  const [openModal, setOpenModal] = useState(false);
  const [items, setItems] = useState([]);
  const [serializedUnits, setSerializedUnits] = useState([]);
  const [serializedUnitsQuery, setSerializedUnitsQuery] = useState('');
  const [serializedLoading, setSerializedLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending_director');
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [auditDetail, setAuditDetail] = useState(null);
  const [wholesaleInbound, setWholesaleInbound] = useState([]);
  const dispatch = useDispatch();
  const toast = useToast();
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  useEffect(() => {
    setFromId(currentBranchId);
  }, [currentBranchId]);

  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  function has(g) {
    if (!g) return false;
    if (roleLower === 'superadmin') return true;
    return grants.includes(g);
  }
  const canTransfer = (['admin','manager','inventory staff'].includes(roleLower)) || has('add_transfers');
  const canApprove = (['admin','manager','director','superadmin'].includes(roleLower)) || has('approve_transfers');
  const canWorkflowDirector = roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'director' || has('approve_wholesale_director');
  const canWorkflowManager = roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'manager' || has('approve_wholesale_manager');
  const canDeleteRecords = roleLower === 'superadmin';
  const [selectedRecordIds, setSelectedRecordIds] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const assigned = auth.user?.assignedBranches || 'all';
  const branchOptions = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return branches;
    const ids = new Set(Array.isArray(assigned) ? assigned : [assigned]);
    return branches.filter(b => ids.has(b.id));
  }, [roleLower, assigned, branches]);
  const retailBranchOptions = useMemo(
    () => branchOptions.filter((branch) => String(branch.branchType || 'retail').toLowerCase() === 'retail'),
    [branchOptions]
  );

  const byId = useMemo(() => {
    const map = new Map();
    branches.forEach(b => map.set(b.id, b.name));
    return map;
  }, [branches]);
  const branchTypeById = useMemo(() => {
    const map = new Map();
    branches.forEach(branch => map.set(String(branch.id), String(branch.branchType || 'retail').toLowerCase()));
    return map;
  }, [branches]);
  function inventoryTypeForBranch(branchId) {
    const kind = String(branchTypeById.get(String(branchId)) || 'retail').toLowerCase();
    return kind === 'warehouse' ? 'warehouse' : kind === 'wholesale' ? 'wholesale' : 'retail';
  }
  const selectedProduct = useMemo(() => products.find(p => p.id === productId) || null, [productId, products]);
  useEffect(() => {
    if (!retailBranchOptions.some((branch) => String(branch.id) === String(fromId || ''))) {
      setFromId(retailBranchOptions[0]?.id || '');
    }
  }, [fromId, retailBranchOptions]);
  useEffect(() => {
    if (!branchOptions.some((branch) => String(branch.id) === String(toId || ''))) {
      const nextTo = branchOptions.find((branch) => String(branch.id) !== String(fromId || ''))?.id || branchOptions[0]?.id || '';
      setToId(nextTo);
    }
  }, [branchOptions, fromId, toId]);
  const filteredProducts = useMemo(() => {
    const term = String(productQuery || '').trim().toLowerCase();
    if (!term) return [];
    return products.filter((product) => {
      const variantText = Array.isArray(product.variants)
        ? product.variants.map((variant) => `${variant.label || ''} ${variant.sku || ''} ${variant.barcode || ''}`).join(' ')
        : '';
      const hay = `${product.name || ''} ${product.sku || ''} ${product.barcode || ''} ${product.category || ''} ${variantText}`.toLowerCase();
      return hay.includes(term);
    });
  }, [productQuery, products]);
  const selectedTrackType = String(selectedProduct?.trackType || 'quantity');
  const selectedSerializedUnits = useMemo(() => serializedUnits.filter(unit => unit.selected).map(unit => ({ unitId: unit._id, imei: unit.imei || '', serialNumber: unit.serialNumber || '' })), [serializedUnits]);
  useEffect(() => {
    if (!openModal) return;
    setProductId('');
    setProductQuery('');
    setVariantId('');
    setTransactionTitle('');
  }, [openModal]);
  const baseTransfers = useMemo(() => audit.filter(e => e.actionType === 'stock_transfer'), [audit]);
  const actors = useMemo(() => Array.from(new Set(baseTransfers.map(e => e.actor).filter(Boolean))).sort(), [baseTransfers]);
  const transfers = useMemo(() => {
    const fromTs = periodMode === 'all_time' ? 0 : (dateFrom ? new Date(dateFrom).getTime() : 0);
    const toTs = periodMode === 'all_time' ? Number.MAX_SAFE_INTEGER : (dateTo ? new Date(dateTo).getTime() : Number.MAX_SAFE_INTEGER);
    return baseTransfers.filter(e => {
      const ts = new Date(e.ts).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (fActor && e.actor !== fActor) return false;
      const d = e.details || {};
      if (fFrom && d.from !== fFrom) return false;
      if (fTo && d.to !== fTo) return false;
      return true;
    }).slice().reverse();
  }, [baseTransfers, fActor, fFrom, fTo, dateFrom, dateTo, periodMode]);

  function onExportCsv() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: e => new Date(e.ts).toLocaleString() },
      { key: 'actor', label: 'Actor' },
      { key: 'product', label: 'Product', value: e => (e.details || {}).product || '' },
      { key: 'from', label: 'From', value: e => byId.get((e.details || {}).from) || (e.details || {}).from || '' },
      { key: 'to', label: 'To', value: e => byId.get((e.details || {}).to) || (e.details || {}).to || '' },
      { key: 'qty', label: 'Qty', value: e => (e.details || {}).qty ?? '' },
      { key: 'remark', label: 'Remark', value: e => e.remark || '' }
    ];
    exportCsv('transfers.csv', headers, transfers);
  }
  function onExportPdf() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: e => new Date(e.ts).toLocaleString() },
      { key: 'actor', label: 'Actor' },
      { key: 'product', label: 'Product', value: e => (e.details || {}).product || '' },
      { key: 'route', label: 'From → To', value: e => {
        const d = e.details || {}; return `${byId.get(d.from) || d.from || '—'} → ${byId.get(d.to) || d.to || '—'}`;
      }},
      { key: 'qty', label: 'Qty', value: e => (e.details || {}).qty ?? '' },
      { key: 'remark', label: 'Remark', value: e => e.remark || '' }
    ];
    exportTablePdf('Transfers', headers, transfers);
  }

  async function transfer() {
    if (saving) return;
    if (!canTransfer) {
      toast.show('Not authorized to initiate transfer', { type: 'error' });
      return;
    }
    const nextItems = items.length > 0 ? items : null;
    if (!nextItems && (!productId || !fromId || !toId || fromId === toId || qty <= 0)) {
      toast.show('Check product, branches and quantity', { type: 'error' });
      return;
    }
    if (!nextItems && selectedTrackType === 'serialized' && serializedUnits.filter(unit => unit.selected).length !== Number(qty)) {
      toast.show('Select the exact serialized units to transfer', { type: 'error' });
      return;
    }
    const remark = await promptDialog('Enter reason/remark for this transfer');
    if (!remark || !remark.trim()) {
      toast.show('Remark is required for transfers', { type: 'error' });
      return;
    }
    setSaving(true);
    const clientId = `transfer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      productId: nextItems ? nextItems[0]?.productId : productId,
      from: fromId,
      to: toId,
      qty: nextItems ? nextItems.reduce((sum, item) => sum + Number(item.qty || 0), 0) : Number(qty),
      transactionTitle: transactionTitle.trim() || '',
      remark,
      variantId: nextItems ? (nextItems[0]?.variantId || undefined) : (variantId || undefined),
      initiatorName: auth.user?.name || 'unknown',
      initiatorRole: auth.role || '',
      clientId,
      items: nextItems || (selectedTrackType === 'serialized'
        ? [{
            lineId: '1',
            productId,
            variantId: variantId || '',
            qty: Number(qty),
            unitIds: serializedUnits.filter(unit => unit.selected).map(unit => unit._id),
            selectedUnits: selectedSerializedUnits,
            remark,
            status: 'accepted'
          }]
        : undefined)
    };
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: cannot submit transfer request', { type: 'error' });
        setSaving(false);
        return;
      }
      try {
        await enqueueHttp({ collection: 'transferrequests', label: 'Transfer request', path: '/api/transfers/requests', method: 'POST', body: payload });
      } catch (e) {
        toast.show(String(e?.message || 'Failed to save offline'), { type: 'error' });
        setSaving(false);
        return;
      }
    } else {
      try {
        await transfersApi.createRequest(payload);
      } catch (e) {
        toast.show(String(e?.message || 'Failed to submit request'), { type: 'error' });
        setSaving(false);
        return;
      }
    }
    dispatch(createTransferRequest({
      productId: nextItems ? nextItems[0]?.productId : productId,
      variantId: nextItems ? (nextItems[0]?.variantId || null) : (variantId || null),
      from: fromId,
      to: toId,
      qty: nextItems ? nextItems.reduce((sum, item) => sum + Number(item.qty || 0), 0) : Number(qty),
      transactionTitle: transactionTitle.trim() || '',
      remark,
      initiatorName: auth.user?.name || 'unknown',
      initiatorRole: auth.role || '',
      status: 'pending_director',
      clientId,
      created_at: new Date().toISOString(),
      items: nextItems || (selectedTrackType === 'serialized'
        ? [{
            lineId: '1',
            productId,
            variantId: variantId || '',
            qty: Number(qty),
            unitIds: serializedUnits.filter(unit => unit.selected).map(unit => unit._id),
            selectedUnits: selectedSerializedUnits,
            remark,
            status: 'accepted'
          }]
        : undefined)
    }));
    setQty(1);
    setVariantId('');
    setTransactionTitle('');
    setItems([]);
    setSerializedUnits([]);
    setSerializedUnitsQuery('');
    toast.show(navigator.onLine ? 'Transfer request submitted for approval' : 'Saved offline. Will sync when online.', { type: 'success' });
    setSaving(false);
  }

  async function deleteSelectedRecords() {
    const ids = selectedRecordIds.filter(Boolean);
    if (ids.length === 0) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Delete ${ids.length} selected transfer record(s)?`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await auditsApi.removeMany(ids);
      dispatch(removeAuditEntries(ids));
      setSelectedRecordIds([]);
      setBulkAction('');
      toast.show('Transfer records deleted', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete transfer records'), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }

  function addCurrentItem() {
    if (!productId || !fromId || !toId || fromId === toId || qty <= 0) {
      toast.show('Check product, branches and quantity', { type: 'error' });
      return;
    }
    if (selectedTrackType === 'serialized' && serializedUnits.filter(unit => unit.selected).length !== Number(qty)) {
      toast.show('Select the exact serialized units to transfer', { type: 'error' });
      return;
    }
    setItems(prev => [...prev, {
      lineId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId,
      variantId: variantId || '',
      qty: Number(qty),
      unitIds: selectedTrackType === 'serialized' ? serializedUnits.filter(unit => unit.selected).map(unit => unit._id) : [],
      selectedUnits: selectedTrackType === 'serialized' ? selectedSerializedUnits : [],
      remark: '',
      status: 'accepted'
    }]);
    setQty(1);
    setVariantId('');
    setSerializedUnits([]);
    setSerializedUnitsQuery('');
  }

  function removeItem(lineId) {
    setItems(prev => prev.filter(item => item.lineId !== lineId));
  }

  const requests = useSelector(s => s.transfers?.requests || []);
  const allowedBranches = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return null;
    return new Set(Array.isArray(assigned) ? assigned : [assigned]);
  }, [roleLower, assigned]);
  const pendingRequests = useMemo(() => {
    const legacy = requests.filter(r => {
      const s = r.status === 'pending_approval' ? 'pending_director' : r.status;
      if (s !== statusFilter) return false;
      if (allowedBranches && !allowedBranches.has(r.to)) return false;
      return true;
    });
    const workflow = wholesaleInbound.filter(r => {
      const rawStatus = String(r.status || '').toLowerCase();
      if (rawStatus !== statusFilter) return false;
      const toBranch = r.toBranchId || r.to;
      if (allowedBranches && !allowedBranches.has(toBranch)) return false;
      return true;
    });
    return [...workflow, ...legacy];
  }, [requests, wholesaleInbound, statusFilter, allowedBranches]);
  const summary = useMemo(() => {
    const transferQty = transfers.reduce((sum, row) => sum + (Number(row.details?.qty || 0) || 0), 0);
    const uniqueProducts = new Set(transfers.map((row) => String(row.details?.product || '').trim()).filter(Boolean)).size;
    const uniqueRoutes = new Set(transfers.map((row) => `${row.details?.from || ''}->${row.details?.to || ''}`).filter((value) => value !== '->')).size;
    return {
      historyCount: transfers.length,
      transferQty,
      uniqueProducts,
      uniqueRoutes,
      pendingApprovals: pendingRequests.length
    };
  }, [transfers, pendingRequests]);

  useEffect(() => {
    async function run() {
      if (selectedTrackType !== 'serialized' || !productId || !fromId) {
        setSerializedUnits([]);
        return;
      }
      setSerializedLoading(true);
      try {
        const result = await productUnitsApi.listProductUnits({
          productId,
          variantId,
          branchId: fromId,
          inventoryType: inventoryTypeForBranch(fromId),
          status: 'in_stock',
          query: serializedUnitsQuery,
          pageSize: 50
        });
        setSerializedUnits(prev => {
          const selectedIds = new Set(prev.filter(unit => unit.selected).map(unit => unit._id));
          return (Array.isArray(result?.rows) ? result.rows : []).map(unit => ({ ...unit, selected: selectedIds.has(unit._id) }));
        });
      } catch (e) {
        toast.show(String(e?.message || 'Failed to load serialized units'), { type: 'error' });
        setSerializedUnits([]);
      } finally {
        setSerializedLoading(false);
      }
    }
    run();
  }, [fromId, productId, selectedTrackType, serializedUnitsQuery, toast, variantId, branchTypeById]);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (tab !== 'approvals') return;
      setLoading(true);
      try {
        const rows = await transfersApi.listRequests({ status: statusFilter, limit: 200 });
        if (alive && Array.isArray(rows)) {
          dispatch(setTransferRequests(rows));
        }
      } catch {}
      try {
        const rows = await wholesaleApi.listOperations({
          operationType: 'transfer',
          status: statusFilter
        });
        if (alive && Array.isArray(rows)) {
          const filtered = rows.filter(row => {
            const toInventory = String(row.toInventoryType || '').toLowerCase();
            return toInventory === 'retail';
          });
          setWholesaleInbound(filtered);
        }
      } catch {}
      if (alive) setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [tab, statusFilter, dispatch]);

  async function approve(r) {
    const isWorkflow = String(r.approvalMode || '') === 'workflow';
    const allowed = isWorkflow
      ? ((String(r.status || '') === 'pending_director' && canWorkflowDirector) || (String(r.status || '') === 'pending_manager' && canWorkflowManager))
      : canApprove;
    if (!allowed) { toast.show('Not authorized to approve transfers', { type: 'error' }); return; }
    const id = r._id || r.clientId;
    try {
      const remark = await promptDialog('Enter remark for approval (required)');
      if (!remark || !String(remark).trim()) { toast.show('Remark is required', { type: 'error' }); return; }
      setBusyId(id);
      if (!navigator.onLine && !isWorkflow) {
        await enqueueHttp({ collection: 'transferrequests', label: 'Transfer approve', path: '/api/transfers/approve', method: 'POST', body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark } });
      } else if (isWorkflow) {
        await wholesaleApi.approveOperation(r, { approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
      } else {
        const response = await transfersApi.approve({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
        const nextStatus = String(response?.status || '');
        dispatch(approveTransfer({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, nextStatus }));
        if (nextStatus === 'approved') {
          dispatch(adjustStock({ productId: r.productId, variantId: r.variantId || undefined, branchId: r.from, delta: -Number(r.qty || 0), inventoryType: inventoryTypeForBranch(r.from) }));
          dispatch(adjustStock({ productId: r.productId, variantId: r.variantId || undefined, branchId: r.to, delta: Number(r.qty || 0), inventoryType: inventoryTypeForBranch(r.to) }));
          void refreshAffectedProducts(dispatch, [r.productId]);
          toast.show('Transfer approved and stock updated', { type: 'success' });
        } else {
          toast.show('Director approval recorded. Waiting for manager approval.', { type: 'success' });
        }
        return;
      }
      if (!isWorkflow) {
        dispatch(approveTransfer({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, nextStatus: 'pending_manager' }));
        toast.show('Transfer approval queued offline', { type: 'success' });
      } else {
        await wholesaleApi.listOperations({ operationType: 'transfer', status: statusFilter }).then(rows => setWholesaleInbound((Array.isArray(rows) ? rows : []).filter(row => String(row.toInventoryType || '').toLowerCase() === 'retail')));
        toast.show('Transfer approved and stock updated', { type: 'success' });
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to approve'), { type: 'error' });
    } finally { setBusyId(null); }
  }
  async function reject(r) {
    const isWorkflow = String(r.approvalMode || '') === 'workflow';
    const allowed = isWorkflow
      ? ((String(r.status || '') === 'pending_director' && canWorkflowDirector) || (String(r.status || '') === 'pending_manager' && canWorkflowManager))
      : canApprove;
    if (!allowed) { toast.show('Not authorized to reject transfers', { type: 'error' }); return; }
    const id = r._id || r.clientId;
    try {
      const remark = await promptDialog('Enter reason for rejection (required)');
      if (!remark || !String(remark).trim()) { toast.show('Remark is required', { type: 'error' }); return; }
      setBusyId(id);
      if (!navigator.onLine && !isWorkflow) {
        await enqueueHttp({ collection: 'transferrequests', label: 'Transfer reject', path: '/api/transfers/reject', method: 'POST', body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark } });
      } else if (isWorkflow) {
        await wholesaleApi.rejectOperation(r, { approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, reason: remark });
      } else {
        await transfersApi.reject({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
      }
      if (!isWorkflow) dispatch(rejectTransfer({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark }));
      else await wholesaleApi.listOperations({ operationType: 'transfer', status: statusFilter }).then(rows => setWholesaleInbound((Array.isArray(rows) ? rows : []).filter(row => String(row.toInventoryType || '').toLowerCase() === 'retail')));
      toast.show('Transfer rejected', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to reject'), { type: 'error' });
    } finally { setBusyId(null); }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Transfers</h1>
          <div className="page-subtitle-compact">Move stock between branches with clearer routing, approvals, and inventory segregation.</div>
        </div>
        <div className="page-header-actions">
          {tab === 'initiate' && (
            <button className="btn btn-primary" onClick={() => setOpenModal(true)}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
              Add Transfer
            </button>
          )}
          <OfflineQueueIndicator collection="transferrequests" label="Transfers queued" />
        </div>
      </div>
      <div className="page-tabs">
        <button className={tab === 'initiate' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('initiate')}>Initiate</button>
        <button className={tab === 'approvals' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('approvals')} disabled={!canApprove}>Approvals</button>
      </div>
      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-label">Transfer Records</div><div className="stat-value">{summary.historyCount}</div></div>
        <div className="card stat-card"><div className="stat-label">Units Moved</div><div className="stat-value">{summary.transferQty}</div></div>
        <div className="card stat-card"><div className="stat-label">Products</div><div className="stat-value">{summary.uniqueProducts}</div></div>
        <div className="card stat-card"><div className="stat-label">Routes</div><div className="stat-value">{summary.uniqueRoutes}</div></div>
        <div className="card stat-card"><div className="stat-label">Pending Approvals</div><div className="stat-value">{summary.pendingApprovals}</div></div>
      </div>
      {openModal && (
        <Modal title="Add Transfer" onClose={() => setOpenModal(false)} footer={
          <>
            <button className="btn" onClick={() => setOpenModal(false)}>Cancel</button>
            <button className="btn" onClick={addCurrentItem} disabled={!canTransfer || saving}>Add To List</button>
            <button className="btn btn-primary" onClick={async () => { await transfer(); setOpenModal(false); }} disabled={!canTransfer || saving}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M7 7h10M7 17h10M7 7l-3 3m3-3l-3-3M17 17l3 3m-3-3l3-3" stroke="currentColor" strokeWidth="2"/></svg>
              {saving ? 'Saving…' : 'Submit For Approval'}
            </button>
          </>
        }>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <ProductLiveSearchField
                label="Product"
                query={productQuery}
                onQueryChange={(value) => {
                  setProductQuery(value);
                  if (String(value || '').trim()) {
                    setProductId('');
                    setVariantId('');
                  }
                }}
                products={filteredProducts}
                allProducts={products}
                selectedProductId={productId}
                onSelect={(product) => {
                  setProductId(product.id);
                  setVariantId('');
                  setProductQuery('');
                }}
              />
            </div>
            {(products.find(p => p.id === productId)?.variants || []).length > 0 && (
              <label>
                <div className="field-label">Variant</div>
                <select className="select" value={variantId} onChange={e => setVariantId(e.target.value)} style={{ minWidth: 180 }}>
                  <option value="">Base</option>
                  {(products.find(p => p.id === productId)?.variants || []).map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <div className="field-label">From</div>
              <BranchSelect value={fromId} onChange={setFromId} overrideBranches={retailBranchOptions} />
            </label>
            <label>
              <div className="field-label">To</div>
              <BranchSelect value={toId} onChange={setToId} overrideBranches={branchOptions} />
            </label>
            <label>
              <div className="field-label">Quantity</div>
              <input className="input" type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} disabled={selectedTrackType === 'serialized'} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">Transaction Title</div>
              <input className="input" value={transactionTitle} onChange={e => setTransactionTitle(e.target.value)} placeholder="Optional bulk transfer title" />
            </label>
          </div>
          {selectedTrackType === 'serialized' && (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div className="field-label" style={{ marginBottom: 0 }}>Serialized Units</div>
              <input className="input" placeholder="Search IMEI or serial number" value={serializedUnitsQuery} onChange={e => setSerializedUnitsQuery(e.target.value)} />
              <div style={{ color: '#64748b', fontSize: 12 }}>Selected: {serializedUnits.filter(unit => unit.selected).length}</div>
              <div className="table-wrap" style={{ maxHeight: 220 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th align="left"></th>
                      <th align="left">IMEI</th>
                      <th align="left">Serial</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serializedUnits.map(unit => (
                      <tr key={unit._id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={!!unit.selected}
                            onChange={e => setSerializedUnits(prev => {
                              const next = prev.map(row => row._id === unit._id ? { ...row, selected: e.target.checked } : row);
                              const selectedCount = next.filter(row => row.selected).length;
                              setQty(selectedCount || 1);
                              return next;
                            })}
                          />
                        </td>
                        <td>{unit.imei || '—'}</td>
                        <td>{unit.serialNumber || '—'}</td>
                      </tr>
                    ))}
                    {!serializedLoading && serializedUnits.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>No available serialized units</td></tr>}
                    {serializedLoading && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>Loading serialized units…</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <div className="field-label">Items In This Request</div>
            <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th align="left">Product</th>
                  <th align="left">Qty</th>
                  <th align="left">Units</th>
                  <th align="left"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const product = products.find(p => p.id === item.productId);
                  return (
                    <tr key={item.lineId}>
                      <td>{product?.name || item.productId}</td>
                      <td>{item.qty}</td>
                      <td>{Array.isArray(item.unitIds) && item.unitIds.length > 0 ? item.unitIds.length : '—'}</td>
                      <td><button className="btn" onClick={() => removeItem(item.lineId)}>Remove</button></td>
                    </tr>
                  );
                })}
                {items.length === 0 && <tr><td colSpan="4" style={{ padding: 12, color: '#64748b' }}>No items added yet. You can still submit a single item.</td></tr>}
              </tbody>
            </table>
            </div>
          </div>
        </Modal>
      )}
      {tab === 'approvals' && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="approval-toolbar">
            <h2 className="section-title" style={{ marginBottom: 8 }}>Approvals</h2>
            <div className="card-scroll-x">
            <div className="page-tabs">
              <button className={statusFilter === 'pending_director' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_director')}>Pending Director</button>
              <button className={statusFilter === 'pending_manager' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_manager')}>Pending Manager</button>
              <button className={statusFilter === 'approved' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('approved')}>Approved</button>
              <button className={statusFilter === 'rejected' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('rejected')}>Rejected</button>
            </div>
            </div>
          </div>
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th align="left">Product</th>
                <th align="left">From</th>
                <th align="left">To</th>
                <th align="left">Qty</th>
                <th align="left"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}><LoadingDots label="Loading transfers" /></td></tr>}
              {!loading && pendingRequests.map(r => {
                const p = products.find(x => x.id === r.productId);
                const fromLabel = byId.get(r.fromBranchId || r.from) || r.fromBranchId || r.from;
                const toLabel = byId.get(r.toBranchId || r.to) || r.toBranchId || r.to;
                const qtyValue = Number(r.qty || r.baseUnits || 0);
                const transferKind = String(r.approvalMode || '') === 'workflow'
                  ? (String(r.fromInventoryType || '').toLowerCase() === 'wholesale' || String(r.toInventoryType || '').toLowerCase() === 'wholesale'
                    ? 'Wholesale Incoming'
                    : 'Retail Transfer')
                  : 'Retail Transfer';
                const title = String(r.transactionTitle || '').trim() || (Array.isArray(r.items) && r.items.length > 1 ? `${p?.name || r.productId} +${r.items.length - 1} more` : (p?.name || r.productId));
                const canAct = String(r.approvalMode || '') === 'workflow'
                  ? ((String(r.status || '') === 'pending_director' && canWorkflowDirector) || (String(r.status || '') === 'pending_manager' && canWorkflowManager))
                  : canApprove;
                return (
                  <tr key={r._id || r.clientId} style={{ cursor: 'pointer' }} onClick={() => setDetail(r)}>
                    <td>{title}</td>
                    <td>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <span>{fromLabel}{r.fromInventoryType ? ` (${r.fromInventoryType})` : ''}</span>
                        <span style={{ display: 'inline-flex', width: 'fit-content', padding: '2px 8px', borderRadius: 999, background: transferKind === 'Wholesale Incoming' ? '#dbeafe' : '#dcfce7', color: transferKind === 'Wholesale Incoming' ? '#1d4ed8' : '#166534', fontSize: 11, fontWeight: 700 }}>
                          {transferKind}
                        </span>
                      </div>
                    </td>
                    <td>{toLabel}{r.toInventoryType ? ` (${r.toInventoryType})` : ''}</td>
                    <td>{qtyValue}</td>
                    <td>
                      {(r.status === 'pending_approval' || r.status === 'pending_manager' || r.status === 'pending_director') ? (
                        <div className="approval-row-actions">
                          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); approve(r); }} disabled={!canAct || busyId === (r._id || r.clientId)}>{busyId === (r._id || r.clientId) ? 'Working…' : 'Approve'}</button>
                          <button className="btn" onClick={(e) => { e.stopPropagation(); reject(r); }} disabled={!canAct || busyId === (r._id || r.clientId)}>{busyId === (r._id || r.clientId) ? 'Working…' : 'Reject'}</button>
                        </div>
                      ) : (
                        <span className={`status-pill ${r.status === 'approved' ? 'status-pill-approved' : 'status-pill-rejected'}`}>{r.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && pendingRequests.length === 0 && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>No items</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      )}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-scroll-x">
        <div className="record-filters">
          <label>
            <div className="field-label">Period</div>
            <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
              <option value="range">Custom Range</option>
              <option value="all_time">All Time</option>
            </select>
          </label>
          <label>
            <div className="field-label">From</div>
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div className="field-label">To</div>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div className="field-label">Actor</div>
            <select className="select" value={fActor} onChange={e => setFActor(e.target.value)}>
              <option value="">All</option>
              {actors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>
            <div className="field-label">From Branch</div>
            <select className="select" value={fFrom} onChange={e => setFFrom(e.target.value)}>
              <option value="">All</option>
              {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>
            <div className="field-label">To Branch</div>
            <select className="select" value={fTo} onChange={e => setFTo(e.target.value)}>
              <option value="">All</option>
              {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <div className="record-filters-actions">
            <button className="btn" onClick={onExportCsv}>Export CSV</button>
            <button className="btn" onClick={onExportPdf}>Export PDF</button>
            {canDeleteRecords && (
              <>
                <select className="select" value={bulkAction} onChange={e => setBulkAction(e.target.value)} style={{ width: 180 }} disabled={bulkDeleting}>
                  <option value="">Actions</option>
                  <option value="delete">Delete Selected</option>
                </select>
                <button className="btn" disabled={bulkDeleting || bulkAction !== 'delete' || selectedRecordIds.length === 0} onClick={() => void deleteSelectedRecords()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {bulkDeleting && <InlineSpinner />}
                    {bulkDeleting ? 'Deleting…' : 'Apply'}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
        </div>
        <h2 className="section-title">Recent Transfers</h2>
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Timestamp</th>
              <th align="left">Actor</th>
              <th align="left">Product</th>
              <th align="left">From → To</th>
              <th align="left">Qty</th>
              <th align="left">Remark</th>
              {canDeleteRecords && (
                <th align="left">
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={transfers.length > 0 && transfers.every(entry => selectedRecordIds.includes(String(entry._id || entry.id || '')))}
                    onChange={e => setSelectedRecordIds(e.target.checked ? transfers.map(entry => String(entry._id || entry.id || '')).filter(Boolean) : [])}
                  />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {transfers.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(e => {
              const d = e.details || {};
              const fromName = byId.get(d.from) || d.from || '—';
              const toName = byId.get(d.to) || d.to || '—';
              return (
                <tr key={e.id} style={{ cursor: bulkDeleting ? 'default' : 'pointer', opacity: bulkDeleting && selectedRecordIds.includes(String(e._id || e.id || '')) ? 0.55 : 1 }} onClick={() => { if (!bulkDeleting) setAuditDetail(e); }}>
                  <td>{new Date(e.ts).toLocaleString()}</td>
                  <td>{e.actor}</td>
                  <td>{d.product || '—'}</td>
                  <td>{fromName} → {toName}</td>
                  <td>{d.qty ?? '—'}</td>
                  <td>{e.remark || '—'}</td>
                  {canDeleteRecords && (
                    <td>
                      <input
                        type="checkbox"
                        disabled={bulkDeleting}
                        checked={selectedRecordIds.includes(String(e._id || e.id || ''))}
                        onClick={evt => evt.stopPropagation()}
                        onChange={evt => setSelectedRecordIds(prev => evt.target.checked ? [...new Set([...prev, String(e._id || e.id || '')])] : prev.filter(id => id !== String(e._id || e.id || '')))}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
            {transfers.length === 0 && (
              <tr><td colSpan={canDeleteRecords ? 7 : 6} style={{ padding: 12, color: '#64748b' }}>No transfers yet</td></tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="pagination-row">
          <div className="pagination-controls">
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
            <span className="table-meta">Page {page} of {Math.max(1, Math.ceil(transfers.length / pageSize))}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(transfers.length / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(transfers.length / pageSize))}>Next</button>
          </div>
          <label>
            <span className="field-label" style={{ marginBottom: 0, marginRight: 6 }}>Rows</span>
            <select className="select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>
      {detail && (
        <Modal title="Transfer Details" onClose={() => setDetail(null)} footer={
          <>
            <button className="btn" onClick={() => setDetail(null)}>Close</button>
            {(() => {
              const canAct = String(detail.approvalMode || '') === 'workflow'
                ? ((String(detail.status || '') === 'pending_director' && canWorkflowDirector) || (String(detail.status || '') === 'pending_manager' && canWorkflowManager))
                : (((String(detail.status || '') === 'pending_director' && canWorkflowDirector) || (String(detail.status || '') === 'pending_manager' && canWorkflowManager)) && canApprove);
              if (!canAct) return null;
              return (
                <>
                  <button className="btn" onClick={async () => { await reject(detail); setDetail(null); }} disabled={busyId === (detail._id || detail.clientId)}>Reject</button>
                  <button className="btn btn-primary" onClick={async () => { await approve(detail); setDetail(null); }} disabled={busyId === (detail._id || detail.clientId)}>{busyId === (detail._id || detail.clientId) ? 'Working…' : 'Approve'}</button>
                </>
              );
            })()}
          </>
        }>
          <div className="detail-grid">
            <div className="detail-field"><div className="detail-label">Status</div><div className="detail-value"><span className={`status-pill ${detail.status === 'approved' ? 'status-pill-approved' : detail.status === 'rejected' ? 'status-pill-rejected' : 'status-pill-pending'}`}>{detail.status}</span></div></div>
            <div className="detail-field"><div className="detail-label">Title</div><div className="detail-value">{detail.transactionTitle || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Product</div><div className="detail-value">{products.find(p => p.id === detail.productId)?.name || detail.productId}</div></div>
            {detail.variantId ? <div className="detail-field"><div className="detail-label">Variant</div><div className="detail-value">{(products.find(p => p.id === detail.productId)?.variants || []).find(v => v.id === detail.variantId)?.label || detail.variantId}</div></div> : null}
            <div className="detail-field"><div className="detail-label">From</div><div className="detail-value">{byId.get(detail.fromBranchId || detail.from) || detail.fromBranchId || detail.from}</div></div>
            <div className="detail-field"><div className="detail-label">To</div><div className="detail-value">{byId.get(detail.toBranchId || detail.to) || detail.toBranchId || detail.to}</div></div>
            <div className="detail-field"><div className="detail-label">From Inventory</div><div className="detail-value">{detail.fromInventoryType || 'retail'}</div></div>
            <div className="detail-field"><div className="detail-label">To Inventory</div><div className="detail-value">{detail.toInventoryType || detail.fromInventoryType || 'retail'}</div></div>
            <div className="detail-field"><div className="detail-label">Qty</div><div className="detail-value">{detail.qty || detail.baseUnits}</div></div>
            <div className="detail-field"><div className="detail-label">Initiator</div><div className="detail-value">{detail.initiatedByName || detail.initiatorName} {(detail.initiatedByRole || detail.initiatorRole) ? `(${detail.initiatedByRole || detail.initiatorRole})` : ''}</div></div>
            <div className="detail-field"><div className="detail-label">Initiation Remark</div><div className="detail-value">{detail.remark || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Approver</div><div className="detail-value">{detail.approverName ? `${detail.approverName}${detail.approverRole ? ` (${detail.approverRole})` : ''}` : '—'}</div></div>
            {detail.status === 'approved' && <div className="detail-field"><div className="detail-label">Approval Remark</div><div className="detail-value">{detail.approvalRemark || '—'}</div></div>}
            {detail.status === 'rejected' && <div className="detail-field"><div className="detail-label">Rejection Remark</div><div className="detail-value">{detail.rejectionRemark || '—'}</div></div>}
            <div className="detail-field"><div className="detail-label">Created</div><div className="detail-value">{detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Updated</div><div className="detail-value">{detail.updatedAt ? new Date(detail.updatedAt).toLocaleString() : '—'}</div></div>
          </div>
          {Array.isArray(detail.items) && detail.items.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="field-label">Request Items</div>
              <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Product</th>
                    <th align="left">Qty</th>
                    <th align="left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, index) => {
                    const product = products.find(p => p.id === item.productId);
                    return (
                      <tr key={item.lineId || index}>
                        <td>
                          <div>{product?.name || item.productId}</div>
                          {Array.isArray(item.selectedUnits) && item.selectedUnits.length > 0 && (
                            <div style={{ marginTop: 4, color: '#111827', fontSize: 12 }}>
                              {item.selectedUnits.map(unit => unit.imei || unit.serialNumber || unit.unitId).filter(Boolean).join(', ')}
                            </div>
                          )}
                        </td>
                        <td>{item.qty}</td>
                        <td>{item.status || 'accepted'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </Modal>
      )}
      {auditDetail && (
        <Modal title="Transfer Record" onClose={() => setAuditDetail(null)}>
          <div className="detail-grid">
            <div className="detail-field"><div className="detail-label">Timestamp</div><div className="detail-value">{auditDetail.ts ? new Date(auditDetail.ts).toLocaleString() : '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Actor</div><div className="detail-value">{auditDetail.actor || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Product</div><div className="detail-value">{(auditDetail.details || {}).product || '—'}</div></div>
            {(auditDetail.details || {}).variant ? <div className="detail-field"><div className="detail-label">Variant</div><div className="detail-value">{(auditDetail.details || {}).variant}</div></div> : null}
            <div className="detail-field"><div className="detail-label">From</div><div className="detail-value">{byId.get((auditDetail.details || {}).from) || (auditDetail.details || {}).from || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">To</div><div className="detail-value">{byId.get((auditDetail.details || {}).to) || (auditDetail.details || {}).to || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Qty</div><div className="detail-value">{(auditDetail.details || {}).qty ?? '—'}</div></div>
            <div className="detail-field detail-field-full"><div className="detail-label">Remark</div><div className="detail-value">{auditDetail.remark || '—'}</div></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default TransfersPage;
