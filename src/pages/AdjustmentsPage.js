import { useDispatch, useSelector } from 'react-redux';
import { useEffect, useMemo, useRef, useState } from 'react';
import { adjustStock } from '../store/productsSlice';
import { useToast } from '../components/ToastProvider';
import BranchSelect from '../components/BranchSelect';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import * as adjustmentsApi from '../api/adjustments';
import * as productUnitsApi from '../api/productUnits';
import * as auditsApi from '../api/audits';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import Modal from '../components/Modal';
import { promptDialog } from '../utils/dialogs';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import ProductLiveSearchField from '../components/ProductLiveSearchField';
import { removeEntries as removeAuditEntries } from '../store/auditSlice';
import InlineSpinner from '../components/InlineSpinner';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';

function inventoryTypeForBranch(branches, targetBranchId) {
  const branch = Array.isArray(branches)
    ? branches.find((item) => String(item.id) === String(targetBranchId))
    : null;
  const kind = String(branch?.branchType || 'retail').toLowerCase();
  return kind === 'warehouse' ? 'warehouse' : kind === 'wholesale' ? 'wholesale' : 'retail';
}

function isRetailBranch(branch) {
  const kind = String(branch?.branchType || 'retail').toLowerCase();
  return kind !== 'warehouse' && kind !== 'wholesale';
}

function getAdjustmentDisplay(entry) {
  const rawDelta = Number(entry?.delta || 0);
  const type = String(entry?.adjustmentType || (rawDelta < 0 ? 'decrease' : 'increase'));
  const quantity = Math.abs(Number(entry?.quantity || rawDelta || 0));
  return {
    type,
    typeLabel: type === 'decrease' ? 'Decrease' : 'Increase',
    quantity,
    delta: rawDelta
  };
}

function AdjustmentsPage() {
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const audit = useSelector(s => s.audit.entries);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const [productId, setProductId] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [variantId, setVariantId] = useState('');
  const [branchId, setBranchId] = useState(currentBranchId);
  const [quantity, setQuantity] = useState(0);
  const [adjustmentType, setAdjustmentType] = useState('increase');
  const [delta, setDelta] = useState(0);
  const [serializedAdjustmentMode, setSerializedAdjustmentMode] = useState('increase');
  const [serializedEntriesText, setSerializedEntriesText] = useState('');
  const [serializedScanInput, setSerializedScanInput] = useState('');
  const [serializedBatchMode, setSerializedBatchMode] = useState(true);
  const [serializedCameraOpen, setSerializedCameraOpen] = useState(false);
  const [serializedUnits, setSerializedUnits] = useState([]);
  const [serializedUnitsQuery, setSerializedUnitsQuery] = useState('');
  const [serializedLoading, setSerializedLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');
  const [transactionTitle, setTransactionTitle] = useState('');
  const [savingAdjust, setSavingAdjust] = useState(false);
  const [tab, setTab] = useState('initiate');
  const [openModal, setOpenModal] = useState(false);
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending_director');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [approvalRows, setApprovalRows] = useState([]);
  const dispatch = useDispatch();
  const toast = useToast();
  const serializedScanInputRef = useRef(null);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  useEffect(() => { setBranchId(currentBranchId); }, [currentBranchId]);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodMode, setPeriodMode] = useState('range');
  const [fActor, setFActor] = useState('');
  const [fBranch, setFBranch] = useState(currentBranchId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const assigned = auth.user?.assignedBranches || 'all';
  function has(g) {
    if (!g) return false;
    if (roleLower === 'superadmin') return true;
    return grants.includes(g);
  }
  const canAdjust = (['admin','manager','inventory staff'].includes(roleLower)) || has('add_adjustments');
  const canApprove = (['admin','manager','director','superadmin'].includes(roleLower)) || has('approve_adjustments');
  const canDirectorApprove = (['admin','director','superadmin'].includes(roleLower)) || has('approve_wholesale_director') || has('approve_credit_director') || has('approve_adjustments');
  const canManagerApprove = (['admin','manager','superadmin'].includes(roleLower)) || has('approve_wholesale_manager') || has('approve_credit_manager') || has('approve_adjustments');
  const canDeleteRecords = roleLower === 'superadmin';
  const [selectedRecordIds, setSelectedRecordIds] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === String(productId)) || null,
    [productId, products]
  );
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
  const effectiveDelta = selectedTrackType === 'serialized'
    ? Number(delta || 0)
    : (adjustmentType === 'decrease' ? -Math.abs(Number(quantity) || 0) : Math.abs(Number(quantity) || 0));
  const serializedEntries = useMemo(() => String(serializedEntriesText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[,\t|]/).map(part => part.trim()).filter(Boolean);
    return { imei: parts[0] || '', serialNumber: parts[1] || parts[0] || '' };
  }), [serializedEntriesText]);

  const byId = useMemo(() => {
    const map = new Map();
    branches.forEach(b => map.set(b.id, b.name || b.code || b.id));
    return map;
  }, [branches]);
  const branchOptions = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return branches;
    const ids = new Set(Array.isArray(assigned) ? assigned : [assigned]);
    return branches.filter((branch) => ids.has(branch.id));
  }, [assigned, branches, roleLower]);
  const retailBranches = useMemo(
    () => branchOptions.filter((branch) => isRetailBranch(branch)),
    [branchOptions]
  );
  const createBranchId = useMemo(() => {
    const hasSelectedRetailBranch = retailBranches.some((branch) => String(branch.id) === String(branchId));
    return hasSelectedRetailBranch ? String(branchId || '') : String(retailBranches[0]?.id || '');
  }, [branchId, retailBranches]);
  useEffect(() => { setFBranch(currentBranchId); }, [currentBranchId]);
  useEffect(() => { if (roleLower !== 'superadmin' && roleLower !== 'admin') setFBranch(branchId); }, [roleLower, branchId]);
  useEffect(() => {
    if (!openModal) return;
    setProductId('');
    setProductQuery('');
    setVariantId('');
    setTransactionTitle('');
    setReason('');
    setRemark('');
  }, [openModal]);
  useEffect(() => {
    if (!openModal) return;
    if (String(branchId || '') !== String(createBranchId || '')) {
      setBranchId(createBranchId);
    }
  }, [openModal, branchId, createBranchId]);
  const auditRows = useMemo(() => {
    const baseRows = audit.filter(e => e.actionType === 'stock_adjust' || e.actionType === 'stock_damage_remove');
    const fromTs = periodMode === 'all_time' ? 0 : (dateFrom ? new Date(dateFrom).getTime() : 0);
    const toTs = periodMode === 'all_time' ? Number.MAX_SAFE_INTEGER : (dateTo ? new Date(dateTo).getTime() : Number.MAX_SAFE_INTEGER);
    return baseRows.filter(e => {
      const ts = new Date(e.ts).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (fActor && e.actor !== fActor) return false;
      if (fBranch && (e.branchId || (e.details || {}).branchId) !== fBranch) return false;
      return true;
    }).map(e => {
      const d = e.details || {};
      const delta = e.actionType === 'stock_adjust' ? (Number(d.delta) || 0) : -Math.abs(Number(d.qty) || 0);
      return {
        id: e.id || e._id,
        _id: e._id || e.id,
        ts: e.ts,
        actor: e.actor,
        product: d.product || '',
        variant: d.variant || '',
        branchId: e.branchId || d.branchId || '',
        delta,
        type: e.actionType === 'stock_adjust' ? 'Adjust' : 'Damage/Expired',
        remark: e.remark || ''
      };
    }).slice().reverse();
  }, [audit, dateFrom, dateTo, fActor, fBranch, periodMode]);
  const requestRows = useMemo(() => {
    const fromTs = periodMode === 'all_time' ? 0 : (dateFrom ? new Date(dateFrom).getTime() : 0);
    const toTs = periodMode === 'all_time' ? Number.MAX_SAFE_INTEGER : (dateTo ? new Date(dateTo).getTime() : Number.MAX_SAFE_INTEGER);
    return (Array.isArray(approvalRows) ? approvalRows : [])
      .filter((row) => ['approved', 'rejected'].includes(String(row.status || '').toLowerCase()))
      .map((row) => {
        const product = products.find((p) => String(p.id) === String(row.productId));
        const variant = row.variantId ? ((product?.variants || []).find((v) => String(v.id) === String(row.variantId))?.label || row.variantId) : '';
        const ts = row.approved_at || row.rejected_at || row.updatedAt || row.createdAt || new Date().toISOString();
        const delta = Number(row.delta || (Array.isArray(row.items) ? row.items.reduce((sum, item) => sum + Number(item.delta || 0), 0) : 0));
        return {
          id: row._id || row.clientId || `${row.productId}-${ts}`,
          _id: row._id || row.clientId || `${row.productId}-${ts}`,
          ts,
          actor: row.approverName || row.initiatorName || '',
          product: row.transactionTitle || product?.name || row.productId || '',
          variant,
          branchId: row.branchId || '',
          delta,
          type: String(row.status || '').toLowerCase() === 'rejected' ? 'Rejected' : 'Adjust',
          remark: row.approvalRemark || row.managerApprovalRemark || row.rejectionRemark || row.remark || ''
        };
      })
      .filter((row) => {
        const ts = new Date(row.ts).getTime();
        if (ts < fromTs || ts > toTs) return false;
        if (fActor && row.actor !== fActor) return false;
        if (fBranch && row.branchId !== fBranch) return false;
        return true;
      })
      .slice()
      .reverse();
  }, [approvalRows, dateFrom, dateTo, fActor, fBranch, periodMode, products]);
  const rows = useMemo(() => {
    if (auditRows.length === 0) return requestRows;
    const merged = [...auditRows];
    requestRows.forEach((row) => {
      const duplicate = auditRows.some((auditRow) =>
        String(auditRow.branchId || '') === String(row.branchId || '')
        && String(auditRow.product || '').trim().toLowerCase() === String(row.product || '').trim().toLowerCase()
        && Number(auditRow.delta || 0) === Number(row.delta || 0)
        && Math.abs(new Date(auditRow.ts).getTime() - new Date(row.ts).getTime()) < 5 * 60 * 1000
      );
      if (!duplicate) merged.push(row);
    });
    return merged.slice().sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [auditRows, requestRows]);
  const actors = useMemo(() => Array.from(new Set(rows.map(e => e.actor).filter(Boolean))).sort(), [rows]);
  const summary = useMemo(() => ({
    records: rows.length,
    totalDelta: rows.reduce((sum, row) => sum + Math.abs(Number(row.delta || 0)), 0),
    increaseCount: rows.filter((row) => Number(row.delta || 0) > 0).length,
    decreaseCount: rows.filter((row) => Number(row.delta || 0) < 0).length,
    products: new Set(rows.map((row) => String(row.product || row.details?.product || '').trim()).filter(Boolean)).size
  }), [rows]);

  useEffect(() => {
    if (selectedTrackType !== 'serialized') {
      setSerializedUnits([]);
      setSerializedUnitsQuery('');
      return;
    }
    if (serializedAdjustmentMode === 'increase') {
      setDelta(Math.max(0, serializedEntries.length));
      return;
    }
    let alive = true;
    async function run() {
      if (!productId || !branchId) {
        if (alive) setSerializedUnits([]);
        return;
      }
      setSerializedLoading(true);
      try {
        const result = await productUnitsApi.listProductUnits({
          productId,
          variantId,
          branchId,
          inventoryType: inventoryTypeForBranch(branches, branchId),
          status: 'in_stock',
          query: serializedUnitsQuery,
          pageSize: 50
        });
        if (!alive) return;
        setSerializedUnits(prev => {
          const selectedIds = new Set(prev.filter(unit => unit.selected).map(unit => unit._id));
          const rows = (Array.isArray(result?.rows) ? result.rows : []).map(unit => ({ ...unit, selected: selectedIds.has(unit._id) }));
          setDelta(-rows.filter(unit => unit.selected).length);
          return rows;
        });
      } catch (e) {
        if (!alive) return;
        toast.show(String(e?.message || 'Failed to load serialized units'), { type: 'error' });
        setSerializedUnits([]);
      } finally {
        if (alive) setSerializedLoading(false);
      }
    }
    run();
    return () => { alive = false; };
  }, [branchId, productId, selectedTrackType, serializedAdjustmentMode, serializedEntries.length, serializedUnitsQuery, toast, variantId]);

  function appendSerializedEntry(value) {
    const text = String(value || '').trim();
    if (!text) return;
    const nextLines = String(serializedEntriesText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (nextLines.some(line => {
      const first = line.split(/[,\t|]/).map(part => part.trim()).filter(Boolean)[0] || '';
      return first === text;
    })) {
      toast.show('This IMEI is already in the entry list', { type: 'error' });
      return;
    }
    setSerializedEntriesText(prev => prev ? `${prev}\n${text}` : text);
    setSerializedScanInput('');
    if (serializedBatchMode) {
      setTimeout(() => {
        try { serializedScanInputRef.current?.focus(); } catch {}
      }, 0);
    }
  }

  async function deleteSelectedRecords() {
    const ids = selectedRecordIds.filter(Boolean);
    if (ids.length === 0) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Delete ${ids.length} selected adjustment record(s)?`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await auditsApi.removeMany(ids);
      dispatch(removeAuditEntries(ids));
      setSelectedRecordIds([]);
      setBulkAction('');
      toast.show('Adjustment records deleted', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete adjustment records'), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }

  function onExportCsv() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: r => new Date(r.ts).toLocaleString() },
      { key: 'actor', label: 'Actor' },
      { key: 'product', label: 'Product' },
      { key: 'variant', label: 'Variant' },
      { key: 'branch', label: 'Branch', value: r => byId.get(r.branchId) || r.branchId || '' },
      { key: 'delta', label: 'Delta' },
      { key: 'type', label: 'Type' },
      { key: 'remark', label: 'Remark' }
    ];
    exportCsv('adjustments.csv', headers, rows);
  }
  function onExportPdf() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: r => new Date(r.ts).toLocaleString() },
      { key: 'actor', label: 'Actor' },
      { key: 'product', label: 'Product' },
      { key: 'variant', label: 'Variant' },
      { key: 'branch', label: 'Branch', value: r => byId.get(r.branchId) || r.branchId || '' },
      { key: 'delta', label: 'Delta' },
      { key: 'type', label: 'Type' },
      { key: 'remark', label: 'Remark' }
    ];
    exportTablePdf('Adjustments', headers, rows);
  }

  async function adjust() {
    if (savingAdjust) return;
    if (!canAdjust) {
      toast.show('Not authorized to adjust stock', { type: 'error' });
      return false;
    }
    const current = (() => {
      if (!selectedProduct) return 0;
      const inventoryType = inventoryTypeForBranch(branches, createBranchId);
      const stockField = inventoryType === 'warehouse'
        ? 'warehouseStockByBranch'
        : inventoryType === 'wholesale'
          ? 'wholesaleStockByBranch'
          : 'stockByBranch';
      if (variantId) {
        const v = (selectedProduct.variants || []).find(vv => vv.id === variantId);
        return Number((v?.[stockField] || {})[createBranchId] || 0);
      }
      return Number((selectedProduct?.[stockField] || {})[createBranchId] || 0);
    })();
    const nextItems = items.length > 0 ? items : null;
    const clientId = `adjust-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      productId: nextItems ? nextItems[0]?.productId : productId,
      branchId: createBranchId,
      delta: nextItems ? nextItems.reduce((sum, item) => sum + Number(item.delta || 0), 0) : Number(effectiveDelta),
      actor: auth.user?.name || 'unknown',
      variantId: nextItems ? (nextItems[0]?.variantId || undefined) : (variantId || undefined),
      transactionTitle: transactionTitle.trim() || '',
      reason: reason.trim(),
      remark,
      initiatorName: auth.user?.name || 'unknown',
      initiatorRole: auth.role || '',
      clientId,
      items: nextItems || (selectedTrackType === 'serialized' ? [{
        lineId: '1',
        productId,
        variantId: variantId || '',
        delta: Number(effectiveDelta),
        quantity: Math.abs(Number(effectiveDelta) || 0),
        adjustmentType: serializedAdjustmentMode,
        reason: reason.trim(),
        unitIds: serializedAdjustmentMode === 'decrease' ? serializedUnits.filter(unit => unit.selected).map(unit => unit._id) : [],
        selectedUnits: serializedAdjustmentMode === 'decrease' ? serializedUnits.filter(unit => unit.selected).map(unit => ({ unitId: unit._id, imei: unit.imei || '', serialNumber: unit.serialNumber || '' })) : [],
        serializedEntries: serializedAdjustmentMode === 'increase' ? serializedEntries : [],
        remark: remark.trim(),
        status: 'accepted'
      }] : undefined)
    };
    if (!nextItems && !productId) {
      toast.show('Select a product', { type: 'error' });
      return false;
    }
    if (!nextItems && (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) && selectedTrackType !== 'serialized') {
      toast.show('Quantity must be greater than zero', { type: 'error' });
      return false;
    }
    if (!nextItems && !createBranchId) {
      toast.show('Select a branch', { type: 'error' });
      return false;
    }
    if (!nextItems && !reason.trim()) {
      toast.show('Reason is required', { type: 'error' });
      return false;
    }
    if (!nextItems && selectedTrackType === 'serialized' && serializedAdjustmentMode === 'increase' && serializedEntries.length <= 0) {
      toast.show('Scan or enter IMEI numbers to add serialized stock', { type: 'error' });
      return false;
    }
    if (!nextItems && selectedTrackType === 'serialized' && serializedAdjustmentMode === 'decrease' && serializedUnits.filter(unit => unit.selected).length <= 0) {
      toast.show('Select serialized units to remove', { type: 'error' });
      return false;
    }
    if (!nextItems && Number(effectiveDelta) < 0) {
      const toRemove = Math.abs(Number(effectiveDelta));
      if (toRemove > current) {
        toast.show(`Cannot remove more than available stock (${current})`, { type: 'error' });
        return false;
      }
    }
    if (!remark || !remark.trim()) {
      toast.show('Remark is required for adjustments', { type: 'error' });
      return false;
    }
    setSavingAdjust(true);
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: cannot submit request', { type: 'error' });
        setSavingAdjust(false);
        return false;
      }
      try {
        await enqueueHttp({ collection: 'adjustmentrequests', label: 'Adjustment request', path: '/api/adjustments/requests', method: 'POST', body: payload });
      } catch (e) {
        toast.show(String(e?.message || 'Failed to save offline'), { type: 'error' });
        setSavingAdjust(false);
        return false;
      }
    } else {
      try {
        await adjustmentsApi.createRequest(payload);
      } catch (e) {
        toast.show(String(e?.message || 'Failed to submit request'), { type: 'error' });
        setSavingAdjust(false);
        return false;
      }
    }
    setQuantity(0);
    setDelta(0);
    setAdjustmentType('increase');
    setSerializedAdjustmentMode('increase');
    setVariantId('');
    setReason('');
    setRemark('');
    setTransactionTitle('');
    setItems([]);
    setSerializedEntriesText('');
    setSerializedScanInput('');
    setSerializedUnits([]);
    toast.show(navigator.onLine ? 'Adjustment request submitted for approval' : 'Saved offline. Will sync when online.', { type: 'success' });
    setSavingAdjust(false);
    return true;
  }

  function addCurrentItem() {
    if (!productId) {
      toast.show('Select a product', { type: 'error' });
      return;
    }
    if ((!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) && selectedTrackType !== 'serialized') {
      toast.show('Quantity must be greater than zero', { type: 'error' });
      return;
    }
    if (!createBranchId) {
      toast.show('Select a branch', { type: 'error' });
      return;
    }
    if (!reason.trim()) {
      toast.show('Reason is required', { type: 'error' });
      return;
    }
    if (selectedTrackType === 'serialized' && serializedAdjustmentMode === 'increase' && serializedEntries.length <= 0) {
      toast.show('Scan or enter IMEI numbers to add serialized stock', { type: 'error' });
      return;
    }
    if (selectedTrackType === 'serialized' && serializedAdjustmentMode === 'decrease' && serializedUnits.filter(unit => unit.selected).length <= 0) {
      toast.show('Select serialized units to remove', { type: 'error' });
      return;
    }
    setItems(prev => [...prev, {
      lineId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId,
      variantId: variantId || '',
      delta: Number(effectiveDelta),
      quantity: Math.abs(Number(effectiveDelta) || 0),
      adjustmentType: selectedTrackType === 'serialized' ? serializedAdjustmentMode : adjustmentType,
      reason: reason.trim(),
      unitIds: selectedTrackType === 'serialized' && serializedAdjustmentMode === 'decrease' ? serializedUnits.filter(unit => unit.selected).map(unit => unit._id) : [],
      selectedUnits: selectedTrackType === 'serialized' && serializedAdjustmentMode === 'decrease' ? serializedUnits.filter(unit => unit.selected).map(unit => ({ unitId: unit._id, imei: unit.imei || '', serialNumber: unit.serialNumber || '' })) : [],
      serializedEntries: selectedTrackType === 'serialized' && serializedAdjustmentMode === 'increase' ? serializedEntries : [],
      remark: remark.trim(),
      status: 'accepted'
    }]);
    setQuantity(0);
    setDelta(0);
    setAdjustmentType('increase');
    setSerializedAdjustmentMode('increase');
    setVariantId('');
    setReason('');
    setSerializedEntriesText('');
    setSerializedScanInput('');
    setSerializedUnits([]);
  }

  function removeItem(lineId) {
    setItems(prev => prev.filter(item => item.lineId !== lineId));
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Adjustments</h1>
          <div className="page-subtitle-compact">Record inventory corrections with a clearer approval flow for retail, distribution, and serialized stock.</div>
        </div>
        <div className="page-header-actions">
          {tab === 'initiate' && (
            <button className="btn btn-primary" onClick={() => setOpenModal(true)}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2"/></svg>
              Add Adjustment
            </button>
          )}
          <OfflineQueueIndicator collection="adjustmentrequests" label="Adjustments queued" />
        </div>
      </div>
      <div className="page-tabs">
        <button className={tab === 'initiate' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('initiate')}>Initiate</button>
        <button className={tab === 'approvals' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('approvals')} disabled={!canApprove}>Approvals</button>
      </div>
      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-label">Adjustment Records</div><div className="stat-value">{summary.records}</div></div>
        <div className="card stat-card"><div className="stat-label">Total Units Adjusted</div><div className="stat-value">{summary.totalDelta}</div></div>
        <div className="card stat-card"><div className="stat-label">Increases</div><div className="stat-value">{summary.increaseCount}</div></div>
        <div className="card stat-card"><div className="stat-label">Decreases</div><div className="stat-value">{summary.decreaseCount}</div></div>
        <div className="card stat-card"><div className="stat-label">Products</div><div className="stat-value">{summary.products}</div></div>
      </div>
      {openModal && (
        <Modal title="Add Adjustment" onClose={() => setOpenModal(false)} footer={
          <>
            <button className="btn" onClick={() => setOpenModal(false)}>Cancel</button>
            <button className="btn" onClick={addCurrentItem}>Add To List</button>
            <button className="btn btn-primary" onClick={async () => { const ok = await adjust(); if (ok) setOpenModal(false); }} disabled={!canAdjust || savingAdjust}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2"/></svg>
              {savingAdjust ? 'Saving…' : 'Submit For Approval'}
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
            {(selectedProduct?.variants || []).length > 0 && (
              <label>
                <div className="field-label">Variant</div>
                <select className="select" value={variantId} onChange={e => setVariantId(e.target.value)} style={{ minWidth: 180 }}>
                  <option value="">Base</option>
                  {(selectedProduct?.variants || []).map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <div className="field-label">Branch</div>
              <select className="select" value={createBranchId} onChange={e => setBranchId(e.target.value)} style={{ width: '100%' }}>
                {retailBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            {selectedTrackType !== 'serialized' ? (
              <>
                <label>
                  <div className="field-label">Quantity</div>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="1"
                    value={quantity}
                    onChange={e => setQuantity(Number(e.target.value))}
                    placeholder="Quantity"
                  />
                </label>
                <label>
                  <div className="field-label">Adjustment Type</div>
                  <select className="select" value={adjustmentType} onChange={e => setAdjustmentType(e.target.value)}>
                    <option value="increase">Increase</option>
                    <option value="decrease">Decrease</option>
                  </select>
                </label>
              </>
            ) : (
              <label>
                <div className="field-label">Delta</div>
                <input className="input" type="number" value={delta} readOnly disabled />
              </label>
            )}
            {selectedTrackType === 'serialized' && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className={serializedAdjustmentMode === 'increase' ? 'btn btn-primary' : 'btn'} onClick={() => { setSerializedAdjustmentMode('increase'); setSerializedUnits([]); }}>
                    Add Units
                  </button>
                  <button type="button" className={serializedAdjustmentMode === 'decrease' ? 'btn btn-primary' : 'btn'} onClick={() => { setSerializedAdjustmentMode('decrease'); setSerializedEntriesText(''); setSerializedScanInput(''); }}>
                    Remove Units
                  </button>
                </div>
                {serializedAdjustmentMode === 'increase' ? (
                  <>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className={serializedBatchMode ? 'btn btn-primary' : 'btn'} onClick={() => { setSerializedBatchMode(v => !v); setTimeout(() => { try { serializedScanInputRef.current?.focus(); } catch {} }, 0); }}>
                        {serializedBatchMode ? 'Batch Mode On' : 'Batch Mode Off'}
                      </button>
                      <button type="button" className="btn" onClick={() => setSerializedCameraOpen(true)}>
                        Camera Scan
                      </button>
                    </div>
                    <input
                      ref={serializedScanInputRef}
                      className="input"
                      autoFocus
                      placeholder="Scan IMEI barcode or type and press Enter"
                      value={serializedScanInput}
                      onChange={e => setSerializedScanInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          appendSerializedEntry(serializedScanInput);
                        }
                      }}
                      style={{ color: '#111827', background: '#ffffff' }}
                    />
                    <textarea className="input" rows={6} value={serializedEntriesText} onChange={e => setSerializedEntriesText(e.target.value)} placeholder={'One per line\nIMEI123456789\nIMEI987654321,SN-0002'} style={{ color: '#111827', background: '#ffffff' }} />
                    <div style={{ color: '#64748b', fontSize: 12 }}>Delta updates automatically from scanned/entered IMEI values. Current entries: {serializedEntries.length}</div>
                  </>
                ) : (
                  <>
                    <input className="input" placeholder="Search IMEI or serial number" value={serializedUnitsQuery} onChange={e => setSerializedUnitsQuery(e.target.value)} style={{ color: '#111827', background: '#ffffff' }} />
                    <div style={{ color: '#64748b', fontSize: 12 }}>Selected: {serializedUnits.filter(unit => unit.selected).length}</div>
                    <div className="table-wrap" style={{ maxHeight: 260 }}>
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
                                    setDelta(-next.filter(row => row.selected).length);
                                    return next;
                                  })}
                                />
                              </td>
                              <td style={{ color: '#111827' }}>{unit.imei || '—'}</td>
                              <td style={{ color: '#111827' }}>{unit.serialNumber || '—'}</td>
                            </tr>
                          ))}
                          {!serializedLoading && serializedUnits.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>No available serialized units</td></tr>}
                          {serializedLoading && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>Loading serialized units…</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
            <label style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">Transaction Title</div>
              <input className="input" value={transactionTitle} onChange={e => setTransactionTitle(e.target.value)} placeholder="Optional bulk adjustment title" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">Reason</div>
              <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for adjustment" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">Remark (required)</div>
              <input className="input" value={remark} onChange={e => setRemark(e.target.value)} placeholder="Reason or note" />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="field-label">Items In This Request</div>
            <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th align="left">Product</th>
                  <th align="left">Adjustment Type</th>
                  <th align="left">Quantity</th>
                  <th align="left"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const product = products.find(p => p.id === item.productId);
                  const adjustment = getAdjustmentDisplay(item);
                  return (
                    <tr key={item.lineId}>
                      <td>
                        <div>{product?.name || item.productId}</div>
                        {Array.isArray(item.selectedUnits) && item.selectedUnits.length > 0 && (
                          <div style={{ marginTop: 4, color: '#111827', fontSize: 12 }}>
                            {item.selectedUnits.map(unit => unit.imei || unit.serialNumber || unit.unitId).filter(Boolean).join(', ')}
                          </div>
                        )}
                        {Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 && (
                          <div style={{ marginTop: 4, color: '#111827', fontSize: 12 }}>
                            {item.serializedEntries.map(unit => unit.imei || unit.serialNumber).filter(Boolean).join(', ')}
                          </div>
                        )}
                      </td>
                      <td>{adjustment.typeLabel}</td>
                      <td>{adjustment.quantity}</td>
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
      <BarcodeScannerModal
        title="Scan IMEI Barcode"
        open={serializedCameraOpen}
        onClose={() => setSerializedCameraOpen(false)}
        onDetected={(value) => {
          appendSerializedEntry(value);
          setSerializedCameraOpen(false);
        }}
      />
      {tab === 'approvals' && (
        <ApprovalsSection
          canApprove={canApprove}
          canDirectorApprove={canDirectorApprove}
          canManagerApprove={canManagerApprove}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          loading={loading}
          setLoading={setLoading}
          products={products}
          branches={branches}
          byId={byId}
          setDetail={setDetail}
          onRequestsChange={setApprovalRows}
          busyId={busyId}
          setBusyId={setBusyId}
          toast={toast}
          auth={auth}
          dispatch={dispatch}
        />
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
            <div className="field-label">Branch</div>
            <BranchSelect value={fBranch} onChange={setFBranch} />
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
        <h2 className="section-title">Recent Adjustments</h2>
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Timestamp</th>
              <th align="left">Actor</th>
              <th align="left">Product</th>
              <th align="left">Variant</th>
              <th align="left">Branch</th>
              <th align="left">Adjustment Type</th>
              <th align="left">Quantity</th>
              <th align="left">Type</th>
              <th align="left">Remark</th>
              {canDeleteRecords && (
                <th align="left">
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={rows.length > 0 && rows.every(entry => selectedRecordIds.includes(String(entry._id || entry.id || '')))}
                    onChange={e => setSelectedRecordIds(e.target.checked ? rows.map(entry => String(entry._id || entry.id || '')).filter(Boolean) : [])}
                  />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(r => {
              const adjustment = getAdjustmentDisplay(r);
              return (
              <tr key={r.id} style={bulkDeleting && selectedRecordIds.includes(String(r._id || r.id || '')) ? { opacity: 0.55 } : undefined}>
                <td>{new Date(r.ts).toLocaleString()}</td>
                <td>{r.actor}</td>
                <td>{r.product || '—'}</td>
                <td>{r.variant || '—'}</td>
                <td>{byId.get(r.branchId) || r.branchId || '—'}</td>
                <td>{adjustment.typeLabel}</td>
                <td>{adjustment.quantity}</td>
                <td>{r.type}</td>
                <td>{r.remark || '—'}</td>
                {canDeleteRecords && (
                  <td>
                    <input
                      type="checkbox"
                      disabled={bulkDeleting}
                      checked={selectedRecordIds.includes(String(r._id || r.id || ''))}
                      onChange={evt => setSelectedRecordIds(prev => evt.target.checked ? [...new Set([...prev, String(r._id || r.id || '')])] : prev.filter(id => id !== String(r._id || r.id || '')))}
                    />
                  </td>
                )}
              </tr>
            )})}
            {rows.length === 0 && (
              <tr><td colSpan={canDeleteRecords ? 10 : 9} style={{ padding: 12, color: '#64748b' }}>No adjustment records yet</td></tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="pagination-row">
          <div className="pagination-controls">
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
            <span className="table-meta">Page {page} of {Math.max(1, Math.ceil(rows.length / pageSize))}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(rows.length / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(rows.length / pageSize))}>Next</button>
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
        <Modal title="Adjustment Request" onClose={() => setDetail(null)}>
          <RequestDetail detail={detail} products={products} byId={byId} />
        </Modal>
      )}
    </div>
  );
}

function ApprovalsSection({ canApprove, canDirectorApprove, canManagerApprove, statusFilter, setStatusFilter, loading, setLoading, products, branches, byId, setDetail, onRequestsChange, busyId, setBusyId, toast, auth, dispatch }) {
  const [requests, setRequests] = useState([]);
  const [reloadAt, setReloadAt] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        let rows = await adjustmentsApi.listRequests({ status: statusFilter, limit: 200 });
        if ((!Array.isArray(rows) || rows.length === 0) && (statusFilter === 'pending_director' || statusFilter === 'pending_manager' || statusFilter === 'approved' || statusFilter === 'rejected')) {
          const all = await adjustmentsApi.listRequests({ limit: 200 });
          const wanted = statusFilter === 'pending_director' ? ['pending', 'pending_approval', 'pending_director'] : [statusFilter];
          rows = Array.isArray(all) ? all.filter(r => wanted.includes(String(r.status || ''))) : [];
        }
        if (alive) {
          const nextRows = Array.isArray(rows) ? rows : [];
          setRequests(nextRows);
          if (typeof onRequestsChange === 'function') onRequestsChange(nextRows);
        }
      } catch (e) {
        if (alive) {
          setRequests([]);
          if (typeof onRequestsChange === 'function') onRequestsChange([]);
          try { toast.show(String(e?.message || 'Failed to load requests'), { type: 'error' }); } catch {}
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [statusFilter, setLoading, reloadAt, toast]);
  async function approve(r) {
    if (!canApprove) { toast.show('Not authorized to approve adjustments', { type: 'error' }); return; }
    if (String(r.status || '') === 'pending_director' && !canDirectorApprove) { toast.show('Director approval required', { type: 'error' }); return; }
    if (String(r.status || '') === 'pending_manager' && !canManagerApprove) { toast.show('Manager approval required', { type: 'error' }); return; }
    const id = r._id || r.clientId;
    try {
      const remark = await promptDialog('Enter remark for approval (required)');
      if (!remark || !String(remark).trim()) { toast.show('Remark is required', { type: 'error' }); return; }
      setBusyId(id);
      if (!navigator.onLine) {
        await enqueueHttp({ collection: 'adjustmentrequests', label: 'Adjustment approve', path: '/api/adjustments/approve', method: 'POST', body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark } });
        toast.show('Adjustment approval queued offline', { type: 'success' });
        setRequests(prev => prev.map(x => String(x._id || x.clientId) === String(id) ? { ...x, status: 'pending_manager', directorApproverName: auth.user?.name || 'unknown', directorApproverRole: auth.role || '', directorApprovalRemark: remark, directorApproved_at: new Date().toISOString() } : x));
        return;
      } else {
        const response = await adjustmentsApi.approve({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
        const next = response?.request || response;
        const nextStatus = String(next?.status || '');
        setBusyId(null);
        if (nextStatus === 'approved') {
          const approvedItems = Array.isArray(next?.items) && next.items.length > 0 ? next.items : (Array.isArray(r.items) ? r.items : []);
          approvedItems.forEach((item) => {
            if (String(item?.status || '').toLowerCase() === 'cancelled') return;
            dispatch(adjustStock({
              productId: item.productId,
              variantId: item.variantId || undefined,
              branchId: next.branchId || r.branchId,
              delta: Number(item.delta || 0),
              inventoryType: inventoryTypeForBranch(branches, next.branchId || r.branchId)
            }));
          });
          void refreshAffectedProducts(dispatch, Array.from(new Set(approvedItems.map((item) => item?.productId).filter(Boolean))));
          toast.show('Adjustment approved and stock updated', { type: 'success' });
          setRequests(prev => {
            const updated = prev.map(x => String(x._id || x.clientId) === String(id) ? { ...x, ...next } : x);
            if (typeof onRequestsChange === 'function') onRequestsChange(updated);
            return updated;
          });
          setStatusFilter('approved');
          setReloadAt(Date.now());
        } else {
          toast.show('Director approval recorded. Waiting for manager approval.', { type: 'success' });
          setRequests(prev => {
            const updated = prev.map(x => String(x._id || x.clientId) === String(id) ? { ...x, ...next } : x);
            if (typeof onRequestsChange === 'function') onRequestsChange(updated);
            return updated;
          });
          setStatusFilter('pending_manager');
          setReloadAt(Date.now());
        }
        return;
      }
    } catch (e) {
      const message = String(e?.message || 'Failed to approve');
      setBusyId(null);
      if (/timed out/i.test(message)) {
        setReloadAt(Date.now());
        toast.show('Approval is still processing. Refreshing status now.', { type: 'warning' });
      } else {
        toast.show(message, { type: 'error' });
      }
    } finally { setBusyId(null); }
  }
  async function reject(r) {
    if (!canApprove) { toast.show('Not authorized to reject adjustments', { type: 'error' }); return; }
    const id = r._id || r.clientId;
    try {
      const remark = await promptDialog('Enter reason for rejection (required)');
      if (!remark || !String(remark).trim()) { toast.show('Remark is required', { type: 'error' }); return; }
      setBusyId(id);
      if (!navigator.onLine) {
        await enqueueHttp({ collection: 'adjustmentrequests', label: 'Adjustment reject', path: '/api/adjustments/reject', method: 'POST', body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark } });
      } else {
        await adjustmentsApi.reject({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
      }
      toast.show('Adjustment rejected', { type: 'success' });
      setRequests(prev => {
        const updated = prev.map(x => String(x._id || x.clientId) === String(id) ? { ...x, status: 'rejected', approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', rejectionRemark: remark, rejected_at: new Date().toISOString() } : x);
        if (typeof onRequestsChange === 'function') onRequestsChange(updated);
        return updated;
      });
      setStatusFilter('rejected');
      setReloadAt(Date.now());
    } catch (e) {
      toast.show(String(e?.message || 'Failed to reject'), { type: 'error' });
    } finally { setBusyId(null); }
  }
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="approval-toolbar">
        <h2 className="section-title" style={{ marginBottom: 8 }}>Approvals</h2>
        <div className="card-scroll-x">
        <div className="page-tabs">
          <button className={statusFilter === 'pending_director' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_director')}>Pending Director</button>
          <button className={statusFilter === 'pending_manager' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_manager')}>Pending Manager</button>
          <button className={statusFilter === 'approved' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('approved')}>Approved</button>
          <button className={statusFilter === 'rejected' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('rejected')}>Rejected</button>
          <button className="btn" onClick={() => setReloadAt(Date.now())} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        </div>
      </div>
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th align="left">Product</th>
            <th align="left">Branch</th>
            <th align="left">Adjustment Type</th>
            <th align="left">Quantity</th>
            <th align="left"></th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>Loading…</td></tr>}
          {!loading && requests.map(r => {
            const p = products.find(x => x.id === r.productId);
            const adjustment = getAdjustmentDisplay(r);
            const title = String(r.transactionTitle || '').trim() || (Array.isArray(r.items) && r.items.length > 1 ? `${p?.name || r.productId} +${r.items.length - 1} more` : `${p?.name || r.productId}${r.variantId ? ` • ${(p?.variants || []).find(v => v.id === r.variantId)?.label || r.variantId}` : ''}`);
            return (
              <tr key={r._id || r.clientId} style={{ cursor: 'pointer' }} onClick={() => setDetail(r)}>
                <td>{title}</td>
                <td>{byId.get(r.branchId) || r.branchId}</td>
                <td>{adjustment.typeLabel}</td>
                <td>{adjustment.quantity}</td>
                <td>
                  {['pending_approval', 'pending_director', 'pending_manager'].includes(String(r.status || '')) ? (
                    <div className="approval-row-actions">
                      <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); approve(r); }} disabled={((String(r.status || '') === 'pending_director' && !canDirectorApprove) || (String(r.status || '') === 'pending_manager' && !canManagerApprove) || busyId === (r._id || r.clientId))}>{busyId === (r._id || r.clientId) ? 'Working…' : String(r.status || '') === 'pending_manager' ? 'Manager Approve' : 'Director Approve'}</button>
                      <button className="btn" onClick={(e) => { e.stopPropagation(); reject(r); }} disabled={!canApprove || busyId === (r._id || r.clientId)}>{busyId === (r._id || r.clientId) ? 'Working…' : 'Reject'}</button>
                    </div>
                  ) : (
                    <span className={`status-pill ${r.status === 'approved' ? 'status-pill-approved' : 'status-pill-rejected'}`}>{r.status}</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!loading && requests.length === 0 && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>No items</td></tr>}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function RequestDetail({ detail, products, byId }) {
  const p = products.find(x => x.id === detail.productId);
  const vLabel = detail.variantId ? ((p?.variants || []).find(v => v.id === detail.variantId)?.label || detail.variantId) : '';
  const adjustment = getAdjustmentDisplay(detail);
  return (
    <>
      <div className="detail-grid">
        <div className="detail-field"><div className="detail-label">Status</div><div className="detail-value"><span className={`status-pill ${detail.status === 'approved' ? 'status-pill-approved' : detail.status === 'rejected' ? 'status-pill-rejected' : 'status-pill-pending'}`}>{detail.status}</span></div></div>
        <div className="detail-field"><div className="detail-label">Title</div><div className="detail-value">{detail.transactionTitle || '—'}</div></div>
        <div className="detail-field"><div className="detail-label">Product</div><div className="detail-value">{p?.name || detail.productId}{vLabel ? ` • ${vLabel}` : ''}</div></div>
        <div className="detail-field"><div className="detail-label">Branch</div><div className="detail-value">{byId.get(detail.branchId) || detail.branchId}</div></div>
        <div className="detail-field"><div className="detail-label">Adjustment Type</div><div className="detail-value">{adjustment.typeLabel}</div></div>
        <div className="detail-field"><div className="detail-label">Quantity</div><div className="detail-value">{adjustment.quantity}</div></div>
        <div className="detail-field"><div className="detail-label">Initiator</div><div className="detail-value">{detail.initiatorName} {detail.initiatorRole ? `(${detail.initiatorRole})` : ''}</div></div>
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
                <th align="left">Adjustment Type</th>
                <th align="left">Quantity</th>
                <th align="left">Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item, index) => {
                const product = products.find(row => row.id === item.productId);
                const itemAdjustment = getAdjustmentDisplay(item);
                return (
                  <tr key={item.lineId || index}>
                    <td>
                      <div>{product?.name || item.productId}</div>
                      {Array.isArray(item.selectedUnits) && item.selectedUnits.length > 0 && (
                        <div style={{ marginTop: 4, color: '#111827', fontSize: 12 }}>
                          {item.selectedUnits.map(unit => unit.imei || unit.serialNumber || unit.unitId).filter(Boolean).join(', ')}
                        </div>
                      )}
                      {Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 && (
                        <div style={{ marginTop: 4, color: '#111827', fontSize: 12 }}>
                          {item.serializedEntries.map(unit => unit.imei || unit.serialNumber).filter(Boolean).join(', ')}
                        </div>
                      )}
                    </td>
                    <td>{itemAdjustment.typeLabel}</td>
                    <td>{itemAdjustment.quantity}</td>
                    <td>{item.status || 'accepted'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </>
  );
}

export default AdjustmentsPage;
