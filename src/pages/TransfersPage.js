import { useDispatch, useSelector } from 'react-redux';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/ToastProvider';
import BranchSelect from '../components/BranchSelect';
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
import { useAppLanguage } from '../utils/localization';

function normalizeTransferReviewStatus(value) {
  return String(value || '').toLowerCase() === 'cancelled' ? 'cancelled' : 'accepted';
}

function normalizeTransferReviewItemsForCompare(items = []) {
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
    status: normalizeTransferReviewStatus(item?.status)
  }));
}

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
  const [requestRemark, setRequestRemark] = useState('');
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
  const [reviewItems, setReviewItems] = useState([]);
  const [decisionRemark, setDecisionRemark] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [auditDetail, setAuditDetail] = useState(null);
  const [wholesaleInbound, setWholesaleInbound] = useState([]);
  const dispatch = useDispatch();
  const toast = useToast();
  const { t } = useAppLanguage();
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  useEffect(() => {
    setFromId(currentBranchId);
  }, [currentBranchId]);

  const roleLower = String(auth.role || '').toLowerCase();
  const grants = useMemo(() => (Array.isArray(auth.grants) ? auth.grants : []), [auth.grants]);
  const branchTypeById = useMemo(() => {
    const map = new Map();
    branches.forEach(branch => map.set(String(branch.id), String(branch.branchType || 'retail').toLowerCase()));
    return map;
  }, [branches]);
  const inventoryTypeForBranch = useCallback((branchId) => {
    const kind = String(branchTypeById.get(String(branchId)) || 'retail').toLowerCase();
    return kind === 'warehouse' ? 'warehouse' : kind === 'wholesale' ? 'wholesale' : 'retail';
  }, [branchTypeById]);
  const has = useCallback((g) => {
    if (!g) return false;
    if (roleLower === 'superadmin') return true;
    return grants.includes(g);
  }, [grants, roleLower]);
  const canTransfer = (['admin','manager','inventory staff'].includes(roleLower)) || has('add_transfers');
  const canApprove = (['admin','manager','director','superadmin'].includes(roleLower)) || has('approve_transfers');
  const canWorkflowDirector = useCallback((row = {}) => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'director') return true;
    const toInventory = String(row?.toInventoryType || inventoryTypeForBranch(row?.to) || 'retail').toLowerCase();
    if (toInventory === 'warehouse') return has('approve_warehouse_director');
    if (toInventory === 'wholesale') return has('approve_distribution_director');
    return has('approve_transfers');
  }, [has, inventoryTypeForBranch, roleLower]);
  const canWorkflowManager = useCallback((row = {}) => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'manager') return true;
    const toInventory = String(row?.toInventoryType || inventoryTypeForBranch(row?.to) || 'retail').toLowerCase();
    if (toInventory === 'warehouse') return has('approve_warehouse_manager');
    if (toInventory === 'wholesale') return has('approve_distribution_manager');
    return has('approve_transfers');
  }, [has, inventoryTypeForBranch, roleLower]);
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
      { key: 'ts', label: t('Timestamp'), value: e => new Date(e.ts).toLocaleString() },
      { key: 'actor', label: t('Actor') },
      { key: 'product', label: t('Product'), value: e => (e.details || {}).product || '' },
      { key: 'from', label: t('From'), value: e => byId.get((e.details || {}).from) || (e.details || {}).from || '' },
      { key: 'to', label: t('To'), value: e => byId.get((e.details || {}).to) || (e.details || {}).to || '' },
      { key: 'qty', label: t('Qty'), value: e => (e.details || {}).qty ?? '' },
      { key: 'remark', label: t('Remark'), value: e => e.remark || '' }
    ];
    exportCsv('transfers.csv', headers, transfers);
  }
  function onExportPdf() {
    const headers = [
      { key: 'ts', label: t('Timestamp'), value: e => new Date(e.ts).toLocaleString() },
      { key: 'actor', label: t('Actor') },
      { key: 'product', label: t('Product'), value: e => (e.details || {}).product || '' },
      { key: 'route', label: t('From → To'), value: e => {
        const d = e.details || {}; return `${byId.get(d.from) || d.from || '—'} → ${byId.get(d.to) || d.to || '—'}`;
      }},
      { key: 'qty', label: t('Qty'), value: e => (e.details || {}).qty ?? '' },
      { key: 'remark', label: t('Remark'), value: e => e.remark || '' }
    ];
    exportTablePdf(t('Transfers'), headers, transfers);
  }

  async function transfer() {
    if (saving) return;
    if (!canTransfer) {
      toast.show(t('Not authorized to initiate transfer'), { type: 'error' });
      return;
    }
    const nextItems = items.length > 0 ? items : null;
    if (!nextItems && (!productId || !fromId || !toId || fromId === toId || qty <= 0)) {
      toast.show(t('Check product, branches and quantity'), { type: 'error' });
      return;
    }
    if (!nextItems && selectedTrackType === 'serialized' && serializedUnits.filter(unit => unit.selected).length !== Number(qty)) {
      toast.show(t('Select the exact serialized units to transfer'), { type: 'error' });
      return;
    }
    const remark = String(requestRemark || '').trim();
    if (!remark) {
      toast.show(t('Remark is required for transfers'), { type: 'error' });
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
        toast.show(t('Offline: cannot submit transfer request'), { type: 'error' });
        setSaving(false);
        return;
      }
      try {
        await enqueueHttp({ collection: 'transferrequests', label: t('Transfer request'), path: '/api/transfers/requests', method: 'POST', body: payload });
      } catch (e) {
        toast.show(String(e?.message || t('Failed to save offline')), { type: 'error' });
        setSaving(false);
        return;
      }
    } else {
      try {
        await transfersApi.createRequest(payload);
      } catch (e) {
        toast.show(String(e?.message || t('Failed to submit request')), { type: 'error' });
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
    setRequestRemark('');
    setItems([]);
    setSerializedUnits([]);
    setSerializedUnitsQuery('');
    toast.show(navigator.onLine ? t('Transfer request submitted for approval') : t('Saved offline. Will sync when online.'), { type: 'success' });
    setOpenModal(false);
    setSaving(false);
  }

  async function deleteSelectedRecords() {
    const ids = selectedRecordIds.filter(Boolean);
    if (ids.length === 0) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(t('Delete {count} selected transfer record(s)?', { count: ids.length }));
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await auditsApi.removeMany(ids);
      dispatch(removeAuditEntries(ids));
      setSelectedRecordIds([]);
      setBulkAction('');
      toast.show(t('Transfer records deleted'), { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || t('Failed to delete transfer records')), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }

  function addCurrentItem() {
    if (!productId || !fromId || !toId || fromId === toId || qty <= 0) {
      toast.show(t('Check product, branches and quantity'), { type: 'error' });
      return;
    }
    if (selectedTrackType === 'serialized' && serializedUnits.filter(unit => unit.selected).length !== Number(qty)) {
      toast.show(t('Select the exact serialized units to transfer'), { type: 'error' });
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

  function openDetail(row) {
    setDetail(row);
    setDecisionRemark('');
    setReviewItems(
      Array.isArray(row.items) && row.items.length > 0
        ? row.items.map((item, index) => ({
            lineId: item.lineId || `${index + 1}`,
            productId: item.productId,
            variantId: item.variantId || '',
            qty: Number(item.qty || 0),
            unitIds: Array.isArray(item.unitIds) ? item.unitIds.map(String) : [],
            selectedUnits: Array.isArray(item.selectedUnits) ? item.selectedUnits.map(unit => ({ unitId: unit?.unitId || '', imei: unit?.imei || '', serialNumber: unit?.serialNumber || '' })) : [],
            remark: item.remark || '',
            reason: item.reason || '',
            status: normalizeTransferReviewStatus(item.status)
          }))
        : [{
            lineId: '1',
            productId: row.productId,
            variantId: row.variantId || '',
            qty: Number(row.qty || row.baseUnits || 0),
            unitIds: Array.isArray(row.unitIds) ? row.unitIds.map(String) : [],
            selectedUnits: Array.isArray(row.selectedUnits) ? row.selectedUnits.map(unit => ({ unitId: unit?.unitId || '', imei: unit?.imei || '', serialNumber: unit?.serialNumber || '' })) : [],
            remark: row.remark || '',
            reason: row.reason || '',
            status: 'accepted'
          }]
    );
  }

  const requests = useSelector(s => s.transfers?.requests || []);
  const allowedBranches = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return null;
    return new Set(Array.isArray(assigned) ? assigned : [assigned]);
  }, [roleLower, assigned]);
  const canActOnRetailRequest = useCallback((row) => {
    if (!row) return false;
    const status = String(row.status || '').toLowerCase();
    const sourceBranch = String(row.from || row.fromBranchId || '');
    const destinationBranch = String(row.to || row.toBranchId || '');
    const canSeeDirectorStage = !allowedBranches || allowedBranches.has(sourceBranch) || allowedBranches.has(destinationBranch);
    const canSeeManagerStage = !allowedBranches || allowedBranches.has(destinationBranch);
    if (status === 'pending_approval' || status === 'pending_director') {
      return canWorkflowDirector(detail) && canSeeDirectorStage;
    }
    if (status === 'pending_manager') {
      return canWorkflowManager(detail) && canSeeManagerStage;
    }
    return false;
  }, [allowedBranches, canWorkflowDirector, canWorkflowManager, detail]);
  const pendingRequests = useMemo(() => {
    const legacy = requests.filter(r => {
      const s = r.status === 'pending_approval' ? 'pending_director' : r.status;
      if (s !== statusFilter) return false;
      if (allowedBranches && !allowedBranches.has(r.to) && !allowedBranches.has(r.from)) return false;
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

  const canActOnDetail = useMemo(() => {
    if (!detail) return false;
    return String(detail.approvalMode || '') === 'workflow'
      ? ((String(detail.status || '') === 'pending_director' && canWorkflowDirector(detail)) || (String(detail.status || '') === 'pending_manager' && canWorkflowManager(detail)))
      : canApprove && ((String(detail.status || '') === 'pending_director' && canWorkflowDirector(detail)) || (String(detail.status || '') === 'pending_manager' && canWorkflowManager(detail)) || String(detail.status || '') === 'pending_approval');
  }, [canApprove, canWorkflowDirector, canWorkflowManager, detail]);

  const hasWorkflowManagerReviewChanges = useMemo(() => {
    if (!detail) return false;
    if (String(detail.approvalMode || '').toLowerCase() !== 'workflow') return false;
    if (String(detail.status || '').toLowerCase() !== 'pending_manager') return false;
    const originalSource = Array.isArray(detail.items) && detail.items.length > 0
      ? detail.items
      : [{
          lineId: '1',
          productId: detail.productId,
          variantId: detail.variantId || '',
          qty: Number(detail.qty || detail.baseUnits || 0),
          unitIds: Array.isArray(detail.unitIds) ? detail.unitIds.map(String) : [],
          selectedUnits: Array.isArray(detail.selectedUnits) ? detail.selectedUnits : [],
          status: 'accepted'
        }];
    return JSON.stringify(normalizeTransferReviewItemsForCompare(originalSource)) !== JSON.stringify(normalizeTransferReviewItemsForCompare(reviewItems));
  }, [detail, reviewItems]);

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
        toast.show(String(e?.message || t('Failed to load serialized units')), { type: 'error' });
        setSerializedUnits([]);
      } finally {
        setSerializedLoading(false);
      }
    }
    run();
  }, [fromId, productId, selectedTrackType, serializedUnitsQuery, toast, variantId, inventoryTypeForBranch, t]);

  const reloadApprovals = useCallback(async () => {
    try {
      const rows = await transfersApi.listRequests({ status: statusFilter, limit: 200 });
      dispatch(setTransferRequests(Array.isArray(rows) ? rows : []));
    } catch {}
    try {
      const rows = await wholesaleApi.listOperations({
        operationType: 'transfer',
        status: statusFilter
      });
      const filtered = Array.isArray(rows)
        ? rows.filter(row => String(row.toInventoryType || '').toLowerCase() === 'retail')
        : [];
      setWholesaleInbound(filtered);
    } catch {}
  }, [dispatch, statusFilter]);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (tab !== 'approvals') return;
      if (requests.length === 0 && wholesaleInbound.length === 0) setLoading(true);
      try {
        const rows = await transfersApi.listRequests({ status: statusFilter, limit: 200 });
        if (alive) dispatch(setTransferRequests(Array.isArray(rows) ? rows : []));
      } catch {}
      try {
        const rows = await wholesaleApi.listOperations({
          operationType: 'transfer',
          status: statusFilter
        });
        if (alive) {
          const filtered = Array.isArray(rows)
            ? rows.filter(row => String(row.toInventoryType || '').toLowerCase() === 'retail')
            : [];
          setWholesaleInbound(filtered);
        }
      } catch {}
      if (alive) setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [tab, statusFilter, dispatch, requests.length, wholesaleInbound.length]);

  async function reviewAction(type) {
    if (!detail || reviewing) return;
    const isWorkflow = String(detail.approvalMode || '') === 'workflow';
    const allowed = isWorkflow
      ? ((String(detail.status || '') === 'pending_director' && canWorkflowDirector) || (String(detail.status || '') === 'pending_manager' && canWorkflowManager))
      : canActOnRetailRequest(detail);
    if (!allowed) {
      toast.show(type === 'approve' ? t('Not authorized to approve transfers') : t('Not authorized to reject transfers'), { type: 'error' });
      return;
    }
    const remark = String(decisionRemark || '').trim();
    if (!remark) {
      toast.show(type === 'approve' ? t('Approval remark is required') : t('Rejection remark is required'), { type: 'error' });
      return;
    }
    const reviewedPayloadItems = reviewItems.map(item => ({ ...item, status: normalizeTransferReviewStatus(item.status) }));
    const affectedProductIds = Array.from(new Set(reviewItems.map(item => String(item.productId || '')).filter(Boolean)));
    const id = detail._id || detail.clientId;
    setReviewing(true);
    setBusyId(id);
    try {
      if (type === 'approve') {
        if (!navigator.onLine && !isWorkflow) {
          await enqueueHttp({
            collection: 'transferrequests',
            label: t('Transfer approve'),
            path: '/api/transfers/approve',
            method: 'POST',
            body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, items: reviewedPayloadItems }
          });
          dispatch(approveTransfer({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, nextStatus: 'pending_manager' }));
          toast.show(t('Transfer approval queued offline'), { type: 'success' });
        } else if (isWorkflow) {
          const response = await wholesaleApi.approveOperation(detail, {
            approverName: auth.user?.name || 'unknown',
            approverRole: auth.role || '',
            remark,
            reason: remark,
            items: reviewedPayloadItems,
            resubmitToDirector: hasWorkflowManagerReviewChanges
          });
          const nextStatus = String(response?.status || '').toLowerCase();
          if (nextStatus === 'pending_director') {
            toast.show(t('Transfer changes resubmitted for director approval'), { type: 'success' });
          } else if (nextStatus === 'pending_manager') {
            toast.show(t('Director approval recorded. Waiting for manager approval.'), { type: 'success' });
          } else {
            toast.show(t('Transfer approved and stock updated'), { type: 'success' });
            void refreshAffectedProducts(dispatch, affectedProductIds);
          }
        } else {
          const response = await transfersApi.approve({
            id,
            approverName: auth.user?.name || 'unknown',
            approverRole: auth.role || '',
            remark,
            items: reviewedPayloadItems
          });
          const nextStatus = String(response?.status || '');
          dispatch(approveTransfer({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, nextStatus }));
          if (nextStatus === 'approved') {
            void refreshAffectedProducts(dispatch, affectedProductIds);
            toast.show(t('Transfer approved and stock updated'), { type: 'success' });
          } else {
            toast.show(t('Director approval recorded. Waiting for manager approval.'), { type: 'success' });
          }
        }
      } else {
        if (!navigator.onLine && !isWorkflow) {
          await enqueueHttp({
            collection: 'transferrequests',
            label: t('Transfer reject'),
            path: '/api/transfers/reject',
            method: 'POST',
            body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark }
          });
        } else if (isWorkflow) {
          await wholesaleApi.rejectOperation(detail, { approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, reason: remark });
        } else {
          await transfersApi.reject({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
        }
        if (!isWorkflow) dispatch(rejectTransfer({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark }));
        toast.show(t('Transfer rejected'), { type: 'success' });
      }
      setDetail(null);
      setDecisionRemark('');
      await reloadApprovals();
    } catch (e) {
      toast.show(String(e?.message || (type === 'approve' ? t('Failed to approve') : t('Failed to reject'))), { type: 'error' });
    } finally {
      setReviewing(false);
      setBusyId(null);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>{t('Transfers')}</h1>
          <div className="page-subtitle-compact">{t('Move stock between branches with clearer routing, approvals, and inventory segregation.')}</div>
        </div>
        <div className="page-header-actions">
          {tab === 'initiate' && (
            <button className="btn btn-primary" onClick={() => setOpenModal(true)}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
              {t('Add Transfer')}
            </button>
          )}
          <OfflineQueueIndicator collection="transferrequests" label={t('Transfers queued')} />
        </div>
      </div>
      <div className="page-tabs">
        <button className={tab === 'initiate' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('initiate')}>{t('Initiate')}</button>
        <button className={tab === 'approvals' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('approvals')} disabled={!canApprove}>{t('Approvals')}</button>
      </div>
      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-label">{t('Transfer Records')}</div><div className="stat-value">{summary.historyCount}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Units Moved')}</div><div className="stat-value">{summary.transferQty}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Products')}</div><div className="stat-value">{summary.uniqueProducts}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Routes')}</div><div className="stat-value">{summary.uniqueRoutes}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Pending Approvals')}</div><div className="stat-value">{summary.pendingApprovals}</div></div>
      </div>
      {openModal && (
        <Modal title={t('Retail Transfer')} onClose={() => setOpenModal(false)} footer={
          <>
            <button className="btn" onClick={() => setOpenModal(false)}>{t('Close')}</button>
            <button className="btn" onClick={addCurrentItem} disabled={!canTransfer || saving}>{t('Add To List')}</button>
            <button className="btn btn-primary" onClick={transfer} disabled={!canTransfer || saving}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M7 7h10M7 17h10M7 7l-3 3m3-3l-3-3M17 17l3 3m-3-3l3-3" stroke="currentColor" strokeWidth="2"/></svg>
              {saving ? t('Saving…') : t('Submit For Approval')}
            </button>
          </>
        }>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <ProductLiveSearchField
                label={t('Product')}
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
                <div className="field-label">{t('Variant')}</div>
                <select className="select" value={variantId} onChange={e => setVariantId(e.target.value)} style={{ minWidth: 180 }}>
                  <option value="">{t('Base')}</option>
                  {(products.find(p => p.id === productId)?.variants || []).map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <div className="field-label">{t('From Branch')}</div>
              <BranchSelect value={fromId} onChange={setFromId} overrideBranches={retailBranchOptions} />
            </label>
            <label>
              <div className="field-label">{t('To Branch')}</div>
              <BranchSelect value={toId} onChange={setToId} overrideBranches={branchOptions} />
            </label>
            <label>
              <div className="field-label">{t('Quantity')}</div>
              <input className="input" type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} disabled={selectedTrackType === 'serialized'} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">{t('Transaction Title')}</div>
              <input className="input" value={transactionTitle} onChange={e => setTransactionTitle(e.target.value)} placeholder={t('Optional transfer title for grouped items')} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">{t('Remark')}</div>
              <input className="input" value={requestRemark} onChange={e => setRequestRemark(e.target.value)} placeholder={t('Additional details for approvers')} />
            </label>
          </div>
          {selectedTrackType === 'serialized' && (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div className="field-label" style={{ marginBottom: 0 }}>{t('Serialized Units')}</div>
              <input className="input" placeholder={t('Search IMEI or serial number')} value={serializedUnitsQuery} onChange={e => setSerializedUnitsQuery(e.target.value)} />
              <div style={{ color: '#64748b', fontSize: 12 }}>{t('Selected: {count}', { count: serializedUnits.filter(unit => unit.selected).length })}</div>
              <div className="table-wrap" style={{ maxHeight: 220 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th align="left"></th>
                      <th align="left">{t('IMEI')}</th>
                      <th align="left">{t('Serial')}</th>
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
                    {!serializedLoading && serializedUnits.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>{t('No available serialized units')}</td></tr>}
                    {serializedLoading && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>{t('Loading serialized units…')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <div className="field-label">{t('Items In This Request')}</div>
            <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th align="left">{t('Product')}</th>
                  <th align="left">{t('Qty')}</th>
                  <th align="left">{t('Units')}</th>
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
                      <td><button className="btn" onClick={() => removeItem(item.lineId)}>{t('Remove')}</button></td>
                    </tr>
                  );
                })}
                {items.length === 0 && <tr><td colSpan="4" style={{ padding: 12, color: '#64748b' }}>{t('No items added yet. You can still submit a single item.')}</td></tr>}
              </tbody>
            </table>
            </div>
          </div>
        </Modal>
      )}
      {tab === 'approvals' && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="approval-toolbar">
            <h2 className="section-title" style={{ marginBottom: 8 }}>{t('Approvals')}</h2>
            <div className="card-scroll-x">
            <div className="page-tabs">
              <button className={statusFilter === 'pending_director' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_director')}>{t('Pending Director')}</button>
              <button className={statusFilter === 'pending_manager' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_manager')}>{t('Pending Manager')}</button>
              <button className={statusFilter === 'approved' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('approved')}>{t('Approved')}</button>
              <button className={statusFilter === 'rejected' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('rejected')}>{t('Rejected')}</button>
            </div>
            </div>
          </div>
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th align="left">{t('Product')}</th>
                <th align="left">{t('From')}</th>
                <th align="left">{t('To')}</th>
                <th align="left">{t('Qty')}</th>
                <th align="left"></th>
              </tr>
            </thead>
            <tbody>
              {loading && pendingRequests.length === 0 && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}><LoadingDots label={t('Loading transfers')} /></td></tr>}
              {!loading && pendingRequests.map(r => {
                const p = products.find(x => x.id === r.productId);
                const fromLabel = byId.get(r.fromBranchId || r.from) || r.fromBranchId || r.from;
                const toLabel = byId.get(r.toBranchId || r.to) || r.toBranchId || r.to;
                const qtyValue = Number(r.qty || r.baseUnits || 0);
                const transferKind = String(r.approvalMode || '') === 'workflow'
                  ? (String(r.fromInventoryType || '').toLowerCase() === 'wholesale' || String(r.toInventoryType || '').toLowerCase() === 'wholesale'
                    ? t('Wholesale Incoming')
                    : t('Retail Transfer'))
                  : t('Retail Transfer');
                const title = String(r.transactionTitle || '').trim() || (Array.isArray(r.items) && r.items.length > 1 ? `${p?.name || r.productId} +${r.items.length - 1} ${t('more')}` : (p?.name || r.productId));
                const canAct = String(r.approvalMode || '') === 'workflow'
                  ? ((String(r.status || '') === 'pending_director' && canWorkflowDirector(r)) || (String(r.status || '') === 'pending_manager' && canWorkflowManager(r)))
                  : canActOnRetailRequest(r);
                return (
                  <tr key={r._id || r.clientId} style={{ cursor: 'pointer' }} onClick={() => openDetail(r)}>
                    <td>{title}</td>
                    <td>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <span>{fromLabel}{r.fromInventoryType ? ` (${t(r.fromInventoryType)})` : ''}</span>
                        <span style={{ display: 'inline-flex', width: 'fit-content', padding: '2px 8px', borderRadius: 999, background: transferKind === t('Wholesale Incoming') ? '#dbeafe' : '#dcfce7', color: transferKind === t('Wholesale Incoming') ? '#1d4ed8' : '#166534', fontSize: 11, fontWeight: 700 }}>
                          {transferKind}
                        </span>
                      </div>
                    </td>
                    <td>{toLabel}{r.toInventoryType ? ` (${t(r.toInventoryType)})` : ''}</td>
                    <td>{qtyValue}</td>
                    <td>
                      {(r.status === 'pending_approval' || r.status === 'pending_manager' || r.status === 'pending_director') ? (
                        <div className="approval-row-actions">
                          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); openDetail(r); }} disabled={!canAct || busyId === (r._id || r.clientId)}>{busyId === (r._id || r.clientId) ? t('Working…') : t('Review')}</button>
                        </div>
                      ) : (
                        <span className={`status-pill ${r.status === 'approved' ? 'status-pill-approved' : 'status-pill-rejected'}`}>{r.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && pendingRequests.length === 0 && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>{t('No items')}</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      )}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-scroll-x">
        <div className="record-filters">
          <label>
            <div className="field-label">{t('Period')}</div>
            <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
              <option value="range">{t('Custom Range')}</option>
              <option value="all_time">{t('All Time')}</option>
            </select>
          </label>
          <label>
            <div className="field-label">{t('From')}</div>
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div className="field-label">{t('To')}</div>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div className="field-label">{t('Actor')}</div>
            <select className="select" value={fActor} onChange={e => setFActor(e.target.value)}>
              <option value="">{t('All')}</option>
              {actors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>
            <div className="field-label">{t('From Branch')}</div>
            <select className="select" value={fFrom} onChange={e => setFFrom(e.target.value)}>
              <option value="">{t('All')}</option>
              {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>
            <div className="field-label">{t('To Branch')}</div>
            <select className="select" value={fTo} onChange={e => setFTo(e.target.value)}>
              <option value="">{t('All')}</option>
              {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <div className="record-filters-actions">
            <button className="btn" onClick={onExportCsv}>{t('Export CSV')}</button>
            <button className="btn" onClick={onExportPdf}>{t('Export PDF')}</button>
            {canDeleteRecords && (
              <>
                <select className="select" value={bulkAction} onChange={e => setBulkAction(e.target.value)} style={{ width: 180 }} disabled={bulkDeleting}>
                  <option value="">{t('Actions')}</option>
                  <option value="delete">{t('Delete Selected')}</option>
                </select>
                <button className="btn" disabled={bulkDeleting || bulkAction !== 'delete' || selectedRecordIds.length === 0} onClick={() => void deleteSelectedRecords()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {bulkDeleting && <InlineSpinner />}
                    {bulkDeleting ? t('Deleting…') : t('Apply')}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
        </div>
        <h2 className="section-title">{t('Recent Transfers')}</h2>
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th align="left">{t('Timestamp')}</th>
              <th align="left">{t('Actor')}</th>
              <th align="left">{t('Product')}</th>
              <th align="left">{t('From → To')}</th>
              <th align="left">{t('Qty')}</th>
              <th align="left">{t('Remark')}</th>
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
              <tr><td colSpan={canDeleteRecords ? 7 : 6} style={{ padding: 12, color: '#64748b' }}>{t('No transfers yet')}</td></tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="pagination-row">
          <div className="pagination-controls">
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>{t('Prev')}</button>
            <span className="table-meta">{t('Page')} {page} {t('of')} {Math.max(1, Math.ceil(transfers.length / pageSize))}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(transfers.length / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(transfers.length / pageSize))}>{t('Next')}</button>
          </div>
          <label>
            <span className="field-label" style={{ marginBottom: 0, marginRight: 6 }}>{t('Rows')}</span>
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
        <Modal title={canActOnDetail ? t('Request Review') : t('Transfer Details')} onClose={() => { if (!reviewing) { setDetail(null); setDecisionRemark(''); } }} footer={
          <>
            <button className="btn" onClick={() => { setDetail(null); setDecisionRemark(''); }} disabled={reviewing}>{t('Close')}</button>
            {canActOnDetail && (
              <>
                <button className="btn" onClick={() => reviewAction('reject')} disabled={reviewing}>{reviewing ? t('Working…') : t('Reject')}</button>
                <button className="btn btn-primary" onClick={() => reviewAction('approve')} disabled={reviewing}>{reviewing ? t('Working…') : hasWorkflowManagerReviewChanges ? t('Resubmit') : t('Approve')}</button>
              </>
            )}
          </>
        }>
          <div className="detail-grid">
            <div className="detail-field"><div className="detail-label">{t('Status')}</div><div className="detail-value"><span className={`status-pill ${detail.status === 'approved' ? 'status-pill-approved' : detail.status === 'rejected' ? 'status-pill-rejected' : 'status-pill-pending'}`}>{detail.status}</span></div></div>
            <div className="detail-field"><div className="detail-label">{t('Title')}</div><div className="detail-value">{detail.transactionTitle || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Product')}</div><div className="detail-value">{products.find(p => p.id === detail.productId)?.name || detail.productId}</div></div>
            {detail.variantId ? <div className="detail-field"><div className="detail-label">{t('Variant')}</div><div className="detail-value">{(products.find(p => p.id === detail.productId)?.variants || []).find(v => v.id === detail.variantId)?.label || detail.variantId}</div></div> : null}
            <div className="detail-field"><div className="detail-label">{t('From')}</div><div className="detail-value">{byId.get(detail.fromBranchId || detail.from) || detail.fromBranchId || detail.from}</div></div>
            <div className="detail-field"><div className="detail-label">{t('To')}</div><div className="detail-value">{byId.get(detail.toBranchId || detail.to) || detail.toBranchId || detail.to}</div></div>
            <div className="detail-field"><div className="detail-label">{t('From Inventory')}</div><div className="detail-value">{t(detail.fromInventoryType || 'retail')}</div></div>
            <div className="detail-field"><div className="detail-label">{t('To Inventory')}</div><div className="detail-value">{t(detail.toInventoryType || detail.fromInventoryType || 'retail')}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Qty')}</div><div className="detail-value">{detail.qty || detail.baseUnits}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Initiator')}</div><div className="detail-value">{detail.initiatedByName || detail.initiatorName} {(detail.initiatedByRole || detail.initiatorRole) ? `(${detail.initiatedByRole || detail.initiatorRole})` : ''}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Initiation Remark')}</div><div className="detail-value">{detail.remark || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Approver')}</div><div className="detail-value">{detail.approverName ? `${detail.approverName}${detail.approverRole ? ` (${detail.approverRole})` : ''}` : '—'}</div></div>
            {detail.status === 'approved' && <div className="detail-field"><div className="detail-label">{t('Approval Remark')}</div><div className="detail-value">{detail.approvalRemark || '—'}</div></div>}
            {detail.status === 'rejected' && <div className="detail-field"><div className="detail-label">{t('Rejection Remark')}</div><div className="detail-value">{detail.rejectionRemark || '—'}</div></div>}
            <div className="detail-field"><div className="detail-label">{t('Created')}</div><div className="detail-value">{detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '—'}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Updated')}</div><div className="detail-value">{detail.updatedAt ? new Date(detail.updatedAt).toLocaleString() : '—'}</div></div>
          </div>
          {Array.isArray(reviewItems) && reviewItems.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="field-label">{t('Request Items')}</div>
              <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">{t('Product')}</th>
                    <th align="left">{t('Qty')}</th>
                    <th align="left">{t('Units')}</th>
                    <th align="left">{t('Status')}</th>
                    <th align="left">{t('Reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewItems.map((item, index) => {
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
                        <td>
                          {canActOnDetail ? (
                            <input
                              className="input"
                              type="number"
                              min="0"
                              value={item.qty}
                              onChange={e => setReviewItems(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, qty: Number(e.target.value) || 0 } : row))}
                              style={{ width: 90, color: '#111827' }}
                              disabled={(Array.isArray(item.unitIds) && item.unitIds.length > 0) || !canActOnDetail || reviewing}
                            />
                          ) : item.qty}
                        </td>
                        <td>{Array.isArray(item.unitIds) && item.unitIds.length > 0 ? item.unitIds.length : '—'}</td>
                        <td>
                          {canActOnDetail ? (
                            <select
                              className="select"
                              value={normalizeTransferReviewStatus(item.status)}
                              onChange={e => setReviewItems(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, status: e.target.value } : row))}
                              style={{ color: '#111827' }}
                              disabled={!canActOnDetail || reviewing}
                            >
                              <option value="accepted">{t('Accepted')}</option>
                              <option value="cancelled">{t('Cancelled')}</option>
                            </select>
                          ) : (item.status || t('accepted'))}
                        </td>
                        <td>{item.reason || item.remark || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
          {canActOnDetail && (
            <label style={{ marginTop: 12, display: 'block' }}>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Approval / Rejection Remark')}</div>
              <textarea className="input" value={decisionRemark} onChange={e => setDecisionRemark(e.target.value)} rows={4} style={{ width: '100%', resize: 'vertical' }} />
            </label>
          )}
        </Modal>
      )}
      {auditDetail && (
        <Modal title={t('Transfer Record')} onClose={() => setAuditDetail(null)}>
          <div className="detail-grid">
            <div className="detail-field"><div className="detail-label">{t('Timestamp')}</div><div className="detail-value">{auditDetail.ts ? new Date(auditDetail.ts).toLocaleString() : '—'}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Actor')}</div><div className="detail-value">{auditDetail.actor || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Product')}</div><div className="detail-value">{(auditDetail.details || {}).product || '—'}</div></div>
            {(auditDetail.details || {}).variant ? <div className="detail-field"><div className="detail-label">{t('Variant')}</div><div className="detail-value">{(auditDetail.details || {}).variant}</div></div> : null}
            <div className="detail-field"><div className="detail-label">{t('From')}</div><div className="detail-value">{byId.get((auditDetail.details || {}).from) || (auditDetail.details || {}).from || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">{t('To')}</div><div className="detail-value">{byId.get((auditDetail.details || {}).to) || (auditDetail.details || {}).to || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Qty')}</div><div className="detail-value">{(auditDetail.details || {}).qty ?? '—'}</div></div>
            <div className="detail-field detail-field-full"><div className="detail-label">{t('Remark')}</div><div className="detail-value">{auditDetail.remark || '—'}</div></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default TransfersPage;
