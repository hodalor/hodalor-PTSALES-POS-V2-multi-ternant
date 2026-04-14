import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import { formatCurrency } from '../utils/currency';
import * as wholesaleApi from '../api/wholesale';
import * as productUnitsApi from '../api/productUnits';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import Modal from '../components/Modal';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';

function labelForArea(area, op) {
  const prefix = String(area || 'wholesale').toLowerCase() === 'warehouse' ? 'Warehouse' : 'Distribution';
  const suffix = op === 'purchase' ? 'Purchase' : op === 'transfer' ? 'Transfer' : op === 'adjustment' ? 'Adjustment' : 'Refund';
  return `${prefix} ${suffix}`;
}

function normalizeReviewStatus(value) {
  return String(value || '').toLowerCase() === 'cancelled' ? 'cancelled' : 'accepted';
}

function WholesaleOperationsPage({ operationType, operationArea = 'wholesale' }) {
  const toast = useToast();
  const dispatch = useDispatch();
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const roleLower = String(auth.role || '').toLowerCase();
  const assigned = auth.user?.assignedBranches || 'all';

  const branchOptions = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return branches;
    const ids = new Set(Array.isArray(assigned) ? assigned : [assigned]);
    return branches.filter(b => ids.has(b.id));
  }, [assigned, branches, roleLower]);
  const normalizedArea = String(operationArea || 'wholesale').toLowerCase() === 'warehouse' ? 'warehouse' : 'wholesale';
  const scopedBranchOptions = useMemo(
    () => branchOptions.filter(branch => String(branch.branchType || 'retail').toLowerCase() === normalizedArea),
    [branchOptions, normalizedArea]
  );

  const branchNameById = useMemo(() => {
    const map = new Map();
    branches.forEach(branch => map.set(branch.id, branch.name || branch.code || branch.id));
    return map;
  }, [branches]);

  const [statusFilter, setStatusFilter] = useState('pending_director');
  const [operations, setOperations] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [decisionRemark, setDecisionRemark] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [items, setItems] = useState([]);
  const [reviewItems, setReviewItems] = useState([]);
  const [serializedUnits, setSerializedUnits] = useState([]);
  const [serializedUnitsQuery, setSerializedUnitsQuery] = useState('');
  const [serializedLoading, setSerializedLoading] = useState(false);
  const [serializedEntriesText, setSerializedEntriesText] = useState('');
  const [serializedScanInput, setSerializedScanInput] = useState('');
  const [serializedBatchMode, setSerializedBatchMode] = useState(true);
  const [serializedCameraOpen, setSerializedCameraOpen] = useState(false);
  const pageSize = 50;

  const [productId, setProductId] = useState(products[0]?.id || '');
  const [variantId, setVariantId] = useState('');
  const [branchId, setBranchId] = useState(currentBranchId || scopedBranchOptions[0]?.id || branchOptions[0]?.id || '');
  const [fromBranchId, setFromBranchId] = useState(currentBranchId || branchOptions[0]?.id || '');
  const [toBranchId, setToBranchId] = useState(branchOptions.find(branch => branch.id !== currentBranchId)?.id || branchOptions[0]?.id || '');
  const [fromInventoryType, setFromInventoryType] = useState(normalizedArea);
  const [toInventoryType, setToInventoryType] = useState(normalizedArea);
  const [qty, setQty] = useState(1);
  const [cost, setCost] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [adjustmentType, setAdjustmentType] = useState('increase');
  const [supplier, setSupplier] = useState('');
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');

  const selectedProduct = useMemo(() => products.find(product => String(product.id) === String(productId)) || null, [productId, products]);
  const selectedVariant = useMemo(() => {
    if (!selectedProduct || !variantId) return null;
    return (selectedProduct.variants || []).find(v => String(v.id) === String(variantId)) || null;
  }, [selectedProduct, variantId]);
  const selectedTrackType = String(selectedVariant?.trackType || selectedProduct?.trackType || 'quantity');
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const canDirectorApprove = roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'director' || grants.includes('approve_wholesale_director') || grants.includes('approve_credit_director');
  const canManagerApprove = roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'manager' || grants.includes('approve_wholesale_manager') || grants.includes('approve_credit_manager');
  const defaultBranchIdRef = useRef(currentBranchId || scopedBranchOptions[0]?.id || branchOptions[0]?.id || '');
  const defaultTransferToBranchIdRef = useRef(branchOptions.find(branch => branch.id !== (currentBranchId || branchOptions[0]?.id))?.id || branchOptions[0]?.id || '');
  const serializedScanInputRef = useRef(null);
  const transferFromBranchOptions = useMemo(
    () => branchOptions.filter(branch => String(branch.branchType || 'retail').toLowerCase() === String(fromInventoryType || normalizedArea).toLowerCase()),
    [branchOptions, fromInventoryType, normalizedArea]
  );
  const transferToBranchOptions = useMemo(
    () => branchOptions.filter(branch => String(branch.branchType || 'retail').toLowerCase() === String(toInventoryType || normalizedArea).toLowerCase()),
    [branchOptions, toInventoryType, normalizedArea]
  );
  const serializedEntries = useMemo(() => String(serializedEntriesText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[,\t|]/).map(part => part.trim()).filter(Boolean);
    return { imei: parts[0] || '', serialNumber: parts[1] || parts[0] || '' };
  }), [serializedEntriesText]);
  const usesSerializedSelection = selectedTrackType === 'serialized' && (operationType === 'transfer' || (operationType === 'adjustment' && adjustmentType === 'decrease'));

  useEffect(() => {
    if (!productId && products[0]?.id) setProductId(products[0].id);
  }, [productId, products]);

  useEffect(() => {
    if (selectedTrackType === 'serialized' && !usesSerializedSelection) {
      setQty(Math.max(0, serializedEntries.length));
    }
  }, [selectedTrackType, serializedEntries.length, usesSerializedSelection]);

  useEffect(() => {
    defaultBranchIdRef.current = currentBranchId || scopedBranchOptions[0]?.id || branchOptions[0]?.id || '';
    defaultTransferToBranchIdRef.current = branchOptions.find(branch => branch.id !== (currentBranchId || branchOptions[0]?.id))?.id || branchOptions[0]?.id || '';
  }, [branchOptions, currentBranchId, scopedBranchOptions]);

  useEffect(() => {
    if (operationType !== 'transfer' && scopedBranchOptions.length > 0 && !scopedBranchOptions.some(branch => branch.id === branchId)) {
      setBranchId(scopedBranchOptions[0].id);
    }
  }, [branchId, operationType, scopedBranchOptions]);

  useEffect(() => {
    if (operationType === 'transfer' && transferFromBranchOptions.length > 0 && !transferFromBranchOptions.some(branch => branch.id === fromBranchId)) {
      setFromBranchId(transferFromBranchOptions[0].id);
    }
  }, [fromBranchId, operationType, transferFromBranchOptions]);

  useEffect(() => {
    if (operationType === 'transfer' && transferToBranchOptions.length > 0 && !transferToBranchOptions.some(branch => branch.id === toBranchId)) {
      setToBranchId(transferToBranchOptions[0].id);
    }
  }, [operationType, toBranchId, transferToBranchOptions]);

  useEffect(() => {
    if (!branchId && currentBranchId) setBranchId(currentBranchId);
    if (!fromBranchId && currentBranchId) setFromBranchId(currentBranchId);
    if (!toBranchId && branchOptions[0]?.id) {
      setToBranchId(branchOptions.find(branch => branch.id !== (currentBranchId || branchOptions[0]?.id))?.id || branchOptions[0]?.id || '');
    }
  }, [branchId, branchOptions, currentBranchId, fromBranchId, toBranchId]);

  useEffect(() => {
    setVariantId('');
    setCost('');
    setRequestedAmount('');
    setAdjustmentType('increase');
    setSupplier('');
    setReason('');
    setRemark('');
    setFromInventoryType(normalizedArea);
    if (operationType === 'transfer') {
      setFromBranchId(defaultBranchIdRef.current);
      setToBranchId(defaultTransferToBranchIdRef.current);
      setToInventoryType(normalizedArea);
    } else {
      setBranchId(defaultBranchIdRef.current);
    }
  }, [normalizedArea, operationType]);

  useEffect(() => {
    async function run() {
      const shouldLoad = selectedTrackType === 'serialized' && (operationType === 'transfer' || (operationType === 'adjustment' && adjustmentType === 'decrease'));
      if (!shouldLoad || !productId || !(operationType === 'transfer' ? fromBranchId : branchId)) {
        setSerializedUnits([]);
        return;
      }
      setSerializedLoading(true);
      try {
        const result = await productUnitsApi.listProductUnits({
          productId,
          variantId,
          branchId: operationType === 'transfer' ? fromBranchId : branchId,
          inventoryType: operationType === 'transfer' ? fromInventoryType : normalizedArea,
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
  }, [adjustmentType, branchId, fromBranchId, fromInventoryType, normalizedArea, operationType, productId, selectedTrackType, serializedUnitsQuery, toast, variantId]);

  const loadOperations = useCallback(async (options = {}) => {
    setLoading(true);
    try {
      const result = await wholesaleApi.listOperations({ operationType, status: statusFilter, operationArea: normalizedArea, force: !!options.force, paged: true, page, pageSize });
      setOperations(Array.isArray(result?.rows) ? result.rows : []);
      setTotal(Number(result?.total || 0));
    } catch (e) {
      const msg = String(e?.message || '');
      if (!/404|not found/i.test(msg)) {
        toast.show(msg || 'Failed to load wholesale operations', { type: 'error' });
      }
      setOperations([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [normalizedArea, operationType, page, pageSize, statusFilter, toast]);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);
  useEffect(() => {
    setPage(1);
  }, [normalizedArea, operationType, statusFilter]);

  function resetForm() {
    setVariantId('');
    setQty(1);
    setCost('');
    setRequestedAmount('');
    setAdjustmentType('increase');
    setSupplier('');
    setReason('');
    setRemark('');
    setItems([]);
    setSerializedUnits([]);
    setSerializedUnitsQuery('');
    setSerializedEntriesText('');
    setSerializedScanInput('');
  }

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

  function openReview(row) {
    setSelectedRow(row);
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
            serializedEntries: Array.isArray(item.serializedEntries) ? item.serializedEntries.map(entry => ({ imei: entry?.imei || '', serialNumber: entry?.serialNumber || '' })) : [],
            cost: Number(item.cost || 0),
            requestedAmount: Number(item.requestedAmount || 0),
            adjustmentType: item.adjustmentType || 'increase',
            supplier: item.supplier || '',
            reason: item.reason || '',
            remark: item.remark || '',
            status: normalizeReviewStatus(item.status)
          }))
        : [{
            lineId: '1',
            productId: row.productId,
            variantId: row.variantId || '',
            qty: Number(row.qty || 0),
            unitIds: Array.isArray(row.unitIds) ? row.unitIds.map(String) : [],
            selectedUnits: Array.isArray(row.selectedUnits) ? row.selectedUnits.map(unit => ({ unitId: unit?.unitId || '', imei: unit?.imei || '', serialNumber: unit?.serialNumber || '' })) : [],
            serializedEntries: Array.isArray(row.serializedEntries) ? row.serializedEntries.map(entry => ({ imei: entry?.imei || '', serialNumber: entry?.serialNumber || '' })) : [],
            cost: Number(row.cost || 0),
            requestedAmount: Number(row.requestedAmount || 0),
            adjustmentType: row.adjustmentType || 'increase',
            supplier: row.supplier || '',
            reason: row.reason || '',
            remark: row.remark || '',
            status: 'accepted'
          }]
    );
  }

  async function reviewAction(type) {
    if (!selectedRow || reviewing) return;
    const remark = String(decisionRemark || '').trim();
    if (!remark) {
      toast.show(type === 'approve' ? 'Approval remark is required' : 'Rejection remark is required', { type: 'error' });
      return;
    }
    setReviewing(true);
    try {
      const payload = {
        remark,
        reason: remark,
        approverName: auth.user?.name || auth.user?.username || 'unknown',
        approverRole: auth.role || ''
      };
      const affectedProductIds = Array.from(new Set(reviewItems.map(item => String(item.productId || '')).filter(Boolean)));
      if (type === 'approve') await wholesaleApi.approveOperation(selectedRow, { ...payload, items: reviewItems.map(item => ({ ...item, status: normalizeReviewStatus(item.status) })) });
      else await wholesaleApi.rejectOperation(selectedRow, payload);
      toast.show(type === 'approve' ? 'Request updated' : 'Request rejected', { type: 'success' });
      setOperations(prev => prev.filter(item => String(item._id || item.clientId) !== String(selectedRow._id || selectedRow.clientId)));
      setSelectedRow(null);
      setDecisionRemark('');
      void loadOperations({ force: true });
      if (type === 'approve' && String(selectedRow.status || '').toLowerCase() === 'pending_manager') {
        void refreshAffectedProducts(dispatch, affectedProductIds);
      }
    } catch (e) {
      const msg = String(e?.message || '');
      if (/404|not found/i.test(msg)) {
        void loadOperations({ force: true });
        setSelectedRow(null);
        setDecisionRemark('');
        toast.show('Request was already processed. List refreshed.', { type: 'warning' });
      } else {
        toast.show(msg || `Failed to ${type} request`, { type: 'error' });
      }
    } finally {
      setReviewing(false);
    }
  }

  function addCurrentItem() {
    if (!productId) {
      toast.show('Select a product', { type: 'error' });
      return;
    }
    if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) {
      toast.show('Quantity must be greater than zero', { type: 'error' });
      return;
    }
    if (usesSerializedSelection && serializedUnits.filter(unit => unit.selected).length !== Number(qty)) {
      toast.show(operationType === 'transfer' ? 'Select the exact serialized units to transfer' : 'Select the exact serialized units to remove', { type: 'error' });
      return;
    }
    if (selectedTrackType === 'serialized' && !usesSerializedSelection && serializedEntries.length !== Number(qty)) {
      toast.show('Enter the exact serialized units to add', { type: 'error' });
      return;
    }
    setItems(prev => [...prev, {
      lineId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId,
      variantId: variantId || '',
      qty: Number(qty),
      unitIds: usesSerializedSelection ? serializedUnits.filter(unit => unit.selected).map(unit => unit._id) : [],
      selectedUnits: usesSerializedSelection ? serializedUnits.filter(unit => unit.selected).map(unit => ({ unitId: unit._id, imei: unit.imei || '', serialNumber: unit.serialNumber || '' })) : [],
      serializedEntries: selectedTrackType === 'serialized' && !usesSerializedSelection ? serializedEntries : [],
      cost: Number(cost || 0),
      requestedAmount: Number(requestedAmount || 0),
      adjustmentType,
      supplier: supplier.trim(),
      reason: reason.trim(),
      remark: remark.trim(),
      status: 'accepted'
    }]);
    setVariantId('');
    setQty(1);
    setCost('');
    setRequestedAmount('');
    setAdjustmentType('increase');
    setSupplier('');
    setReason('');
    setRemark('');
    setSerializedEntriesText('');
    setSerializedScanInput('');
  }

  function removeItem(lineId) {
    setItems(prev => prev.filter(item => item.lineId !== lineId));
  }

  async function submit() {
    if (saving) return;
    const nextItems = items.length > 0 ? items : null;
    if (!nextItems && !productId) {
      toast.show('Select a product', { type: 'error' });
      return;
    }
    if (!nextItems && (!Number.isFinite(Number(qty)) || Number(qty) <= 0)) {
      toast.show('Quantity must be greater than zero', { type: 'error' });
      return;
    }
    if (!nextItems && !reason.trim()) {
      toast.show('Reason is required', { type: 'error' });
      return;
    }
    if (operationType === 'transfer') {
      if (!fromBranchId || !toBranchId) {
        toast.show('Select both source and destination branches', { type: 'error' });
        return;
      }
      if (fromBranchId === toBranchId) {
        toast.show('Source and destination branches must be different', { type: 'error' });
        return;
      }
      if (!nextItems && usesSerializedSelection && serializedUnits.filter(unit => unit.selected).length !== Number(qty)) {
        toast.show(operationType === 'transfer' ? 'Select the exact serialized units to transfer' : 'Select the exact serialized units to remove', { type: 'error' });
        return;
      }
    } else if (!branchId) {
      toast.show('Select a branch', { type: 'error' });
      return;
    }
    if (!nextItems && selectedTrackType === 'serialized' && !usesSerializedSelection && serializedEntries.length !== Number(qty)) {
      toast.show('Enter the exact serialized units to add', { type: 'error' });
      return;
    }

    const clientId = `${normalizedArea}-${operationType}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      clientId,
      operationArea: normalizedArea,
      operationType,
      productId: nextItems ? nextItems[0]?.productId : productId,
      variantId: nextItems ? (nextItems[0]?.variantId || undefined) : (variantId || undefined),
      qty: nextItems ? Number(nextItems.reduce((sum, item) => sum + Number(item.qty || 0), 0)) : Number(qty),
      cost: Number(cost || 0),
      requestedAmount: Number(requestedAmount || 0),
      adjustmentType,
      supplier: supplier.trim(),
      reason: reason.trim(),
      remark: remark.trim(),
      branchId: operationType === 'transfer' ? undefined : branchId,
      fromBranchId: operationType === 'transfer' ? fromBranchId : undefined,
      toBranchId: operationType === 'transfer' ? toBranchId : undefined,
      fromInventoryType: operationType === 'transfer' ? fromInventoryType : normalizedArea,
      toInventoryType: operationType === 'transfer' ? toInventoryType : normalizedArea,
      items: nextItems || ((selectedTrackType === 'serialized' && (usesSerializedSelection || !usesSerializedSelection))
        ? [{
            lineId: '1',
            productId,
            variantId: variantId || '',
            qty: Number(qty),
            unitIds: usesSerializedSelection ? serializedUnits.filter(unit => unit.selected).map(unit => unit._id) : [],
            selectedUnits: usesSerializedSelection ? serializedUnits.filter(unit => unit.selected).map(unit => ({ unitId: unit._id, imei: unit.imei || '', serialNumber: unit.serialNumber || '' })) : [],
            serializedEntries: !usesSerializedSelection ? serializedEntries : [],
            remark: remark.trim(),
            reason: reason.trim(),
            adjustmentType,
            supplier: supplier.trim(),
            status: 'accepted'
          }]
        : undefined)
    };

    const optimistic = {
      ...payload,
      _id: clientId,
      initiatedByName: auth.user?.name || 'unknown',
      initiatedByRole: auth.role || '',
      status: 'pending_director',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setSaving(true);
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        setSaving(false);
        return;
      }
      try {
        await enqueueHttp({ collection: 'wholesaleoperations', label: `Wholesale ${operationType}`, path: '/api/wholesale/operations', method: 'POST', body: payload });
        setOperations(prev => [optimistic, ...prev]);
        resetForm();
        setIsCreateOpen(false);
        toast.show('Saved offline. Will sync when online.', { type: 'success' });
      } catch (e) {
        toast.show(String(e?.message || 'Failed to save offline'), { type: 'error' });
      } finally {
        setSaving(false);
      }
      return;
    }

    try {
      const response = await wholesaleApi.createOperation(payload);
      setOperations(prev => [response?.operation || optimistic, ...prev]);
      resetForm();
      setIsCreateOpen(false);
      toast.show(`${normalizedArea === 'warehouse' ? 'Warehouse' : 'Distribution'} request submitted for director approval`, { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to submit wholesale request'), { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>{normalizedArea === 'warehouse' ? 'Warehouse Operations' : 'Distribution Operations'}</h1>
          <div style={{ color: '#64748b', fontSize: 13 }}>Initiate {normalizedArea} purchases, transfers, adjustments, and refund restocks through the 2-step approval workflow.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <OfflineQueueIndicator collection="wholesaleoperations" label={`${normalizedArea === 'warehouse' ? 'Warehouse' : 'Distribution'} queued`} />
          <button className="btn btn-primary" onClick={() => setIsCreateOpen(true)}>
            New Request
          </button>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>{labelForArea(normalizedArea, operationType)}</h2>
        <div style={{ color: '#64748b', fontSize: 13 }}>
          Open the request modal to initiate a new {labelForArea(normalizedArea, operationType).toLowerCase()} and then track director and manager approvals below.
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Request Tracking</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={statusFilter === 'pending_director' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_director')}>Pending Director</button>
            <button className={statusFilter === 'pending_manager' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_manager')}>Pending Manager</button>
            <button className={statusFilter === 'approved' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('approved')}>Approved</button>
            <button className={statusFilter === 'rejected' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('rejected')}>Rejected</button>
            <button className="btn" onClick={loadOperations} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ color: '#64748b', fontSize: 13 }}>Showing {operations.length} of {total} requests</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1}>Previous</button>
            <button className="btn" onClick={() => setPage(p => p + 1)} disabled={loading || page * pageSize >= total}>Next</button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Product</th>
                <th align="left">Route</th>
                <th align="left">Qty</th>
                <th align="left">Value</th>
                <th align="left">Status</th>
                <th align="left">Initiator</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="6" style={{ padding: 12, color: '#64748b' }}>Loading…</td></tr>}
              {!loading && operations.map(row => {
                const product = products.find(item => String(item.id) === String(row.productId));
                const variantLabel = row.variantId ? ((product?.variants || []).find(variant => String(variant.id) === String(row.variantId))?.label || row.variantId) : '';
                const route = row.operationType === 'transfer'
                  ? `${branchNameById.get(row.fromBranchId || row.from) || row.fromBranchId || row.from || '—'} ${String(row.fromInventoryType || 'retail')} → ${branchNameById.get(row.toBranchId || row.to) || row.toBranchId || row.to || '—'} ${String(row.toInventoryType || 'retail')}`
                  : `${branchNameById.get(row.branchId) || row.branchId || '—'} • ${row.toInventoryType || row.fromInventoryType || 'wholesale'}`;
                const value = row.operationType === 'refund' ? Number(row.requestedAmount || 0) : Number(row.cost || 0);
                return (
                  <tr key={row._id || row.clientId} onClick={() => openReview(row)} style={{ cursor: 'pointer' }}>
                    <td>{product?.name || row.productId}{variantLabel ? ` • ${variantLabel}` : ''}</td>
                    <td>{route}</td>
                    <td>{Number(row.qty || 0)}</td>
                    <td>{value > 0 ? formatCurrency(value, settings) : '—'}</td>
                    <td>{row.status}</td>
                    <td>{row.initiatedByName || '—'} {row.initiatedByRole ? `(${row.initiatedByRole})` : ''}</td>
                  </tr>
                );
              })}
              {!loading && operations.length === 0 && <tr><td colSpan="6" style={{ padding: 12, color: '#64748b' }}>No {normalizedArea} requests yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isCreateOpen && (
        <Modal
          title={labelForArea(normalizedArea, operationType) || 'Stock Request'}
          onClose={() => setIsCreateOpen(false)}
          footer={(
            <>
              <button className="btn" onClick={() => setIsCreateOpen(false)} disabled={saving}>Close</button>
              <button className="btn" onClick={addCurrentItem} disabled={saving}>Add To List</button>
              <button className="btn btn-primary" onClick={submit} disabled={saving}>
                {saving ? 'Saving…' : 'Submit For Approval'}
              </button>
            </>
          )}
        >
          {selectedProduct && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              <div>
                Retail: <strong>{formatCurrency(Number((selectedVariant || selectedProduct).retailPrice || selectedProduct.retailPrice || selectedProduct.price || 0), settings)}</strong>
              </div>
              <div>
                Distribution: <strong>{formatCurrency(Number((selectedVariant || selectedProduct).wholesalePrice || selectedProduct.wholesalePrice || selectedProduct.price || 0), settings)}</strong>
              </div>
              <div>
                Agent: <strong>{formatCurrency(Number((selectedVariant || selectedProduct).agentPrice || selectedProduct.agentPrice || selectedProduct.price || 0), settings)}</strong>
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <label>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>Product</div>
              <select className="select" value={productId} onChange={e => setProductId(e.target.value)} style={{ width: '100%' }}>
                {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>

            {(selectedProduct?.variants || []).length > 0 ? (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>Variant</div>
                <select className="select" value={variantId} onChange={e => setVariantId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Base</option>
                  {(selectedProduct?.variants || []).map(variant => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
                </select>
              </label>
            ) : <div />}

            {operationType === 'transfer' ? (
              <>
                <label>
                  <div style={{ marginBottom: 6, color: '#94a3b8' }}>From Branch</div>
                  <select className="select" value={fromBranchId} onChange={e => setFromBranchId(e.target.value)} style={{ width: '100%' }}>
                    {transferFromBranchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <label>
                  <div style={{ marginBottom: 6, color: '#94a3b8' }}>Source Inventory</div>
                  <select className="select" value={fromInventoryType} onChange={e => setFromInventoryType(e.target.value)} style={{ width: '100%' }}>
                    <option value="retail">Retail Inventory</option>
                    <option value="wholesale">Distribution Inventory</option>
                    <option value="warehouse">Warehouse Inventory</option>
                  </select>
                </label>
                <label>
                  <div style={{ marginBottom: 6, color: '#94a3b8' }}>To Branch</div>
                  <select className="select" value={toBranchId} onChange={e => setToBranchId(e.target.value)} style={{ width: '100%' }}>
                    {transferToBranchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <label>
                  <div style={{ marginBottom: 6, color: '#94a3b8' }}>Destination Inventory</div>
                  <select className="select" value={toInventoryType} onChange={e => setToInventoryType(e.target.value)} style={{ width: '100%' }}>
                    <option value="wholesale">Distribution Inventory</option>
                    <option value="retail">Retail Inventory</option>
                    <option value="warehouse">Warehouse Inventory</option>
                  </select>
                </label>
              </>
            ) : (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>Branch</div>
                <select className="select" value={branchId} onChange={e => setBranchId(e.target.value)} style={{ width: '100%' }}>
                  {scopedBranchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
            )}

            <label>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>Quantity</div>
              <input className="input" type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} disabled={selectedTrackType === 'serialized'} />
            </label>

            {usesSerializedSelection && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <div style={{ color: '#94a3b8' }}>Serialized Units</div>
                <input className="input" placeholder="Search IMEI or serial number" value={serializedUnitsQuery} onChange={e => setSerializedUnitsQuery(e.target.value)} />
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  Selected: {serializedUnits.filter(unit => unit.selected).length}
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 220 }}>
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

            {selectedTrackType === 'serialized' && !usesSerializedSelection && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <div style={{ color: '#94a3b8' }}>IMEI / Serial Numbers</div>
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
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  Quantity updates automatically from scanned/entered IMEI values. Current entries: {serializedEntries.length}
                </div>
              </div>
            )}

            {operationType === 'adjustment' ? (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>Adjustment Type</div>
                <select className="select" value={adjustmentType} onChange={e => setAdjustmentType(e.target.value)} style={{ width: '100%' }}>
                  <option value="increase">Increase</option>
                  <option value="decrease">Decrease</option>
                </select>
              </label>
            ) : (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>{operationType === 'refund' ? 'Refund Amount' : 'Cost'}</div>
                <input className="input" type="number" min="0" step="0.01" value={operationType === 'refund' ? requestedAmount : cost} onChange={e => operationType === 'refund' ? setRequestedAmount(e.target.value) : setCost(e.target.value)} />
              </label>
            )}

            {(operationType === 'purchase' || operationType === 'refund') && (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>Supplier</div>
                <input className="input" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Supplier or source" />
              </label>
            )}

            <label style={{ gridColumn: '1 / -1' }}>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>Reason</div>
              <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder={`Why this ${normalizedArea} operation is needed`} />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>Remark</div>
              <input className="input" value={remark} onChange={e => setRemark(e.target.value)} placeholder="Additional details for approvers" />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6, color: '#94a3b8' }}>Items In This Request</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Product</th>
                    <th align="left">Qty</th>
                    <th align="left">Units</th>
                    <th align="left">Remark</th>
                    <th align="left"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const product = products.find(row => String(row.id) === String(item.productId));
                    return (
                      <tr key={item.lineId}>
                        <td>
                          <div style={{ color: '#111827' }}>{product?.name || item.productId}</div>
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
                        <td>{item.qty}</td>
                        <td>{Array.isArray(item.unitIds) && item.unitIds.length > 0 ? item.unitIds.length : (Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 ? item.serializedEntries.length : '—')}</td>
                        <td>{item.reason || item.remark || '—'}</td>
                        <td><button className="btn" onClick={() => removeItem(item.lineId)}>Remove</button></td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>No items added yet. You can still submit a single item directly.</td></tr>}
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

      {selectedRow && (
        <Modal
          title="Request Review"
          onClose={() => { if (!reviewing) { setSelectedRow(null); setDecisionRemark(''); } }}
          footer={(
            <>
              <button className="btn" onClick={() => { setSelectedRow(null); setDecisionRemark(''); }} disabled={reviewing}>Close</button>
              {((selectedRow.status === 'pending_director' && canDirectorApprove) || (selectedRow.status === 'pending_manager' && canManagerApprove)) && (
                <>
                  <button className="btn" onClick={() => reviewAction('reject')} disabled={reviewing}>{reviewing ? 'Working…' : 'Reject'}</button>
                  <button className="btn btn-primary" onClick={() => reviewAction('approve')} disabled={reviewing}>{reviewing ? 'Working…' : 'Approve'}</button>
                </>
              )}
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Status</div><strong>{selectedRow.status}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Initiator</div><strong>{selectedRow.initiatedByName || selectedRow.initiatorName || '—'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Quantity</div><strong>{Number(selectedRow.qty || selectedRow.baseUnits || 0)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Value</div><strong>{formatCurrency(Number(selectedRow.cost || selectedRow.requestedAmount || 0), settings)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Source</div><strong>{branchNameById.get(selectedRow.fromBranchId || selectedRow.from || selectedRow.branchId) || selectedRow.fromBranchId || selectedRow.from || selectedRow.branchId || '—'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Destination</div><strong>{branchNameById.get(selectedRow.toBranchId || selectedRow.to) || selectedRow.toBranchId || selectedRow.to || '—'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>From Inventory</div><strong>{selectedRow.fromInventoryType || 'retail'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>To Inventory</div><strong>{selectedRow.toInventoryType || selectedRow.fromInventoryType || 'wholesale'}</strong></div>
            </div>
            <div><div style={{ color: '#94a3b8', fontSize: 12 }}>Remark</div><strong>{selectedRow.remark || selectedRow.approvalRemark || selectedRow.rejectionRemark || '—'}</strong></div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Product</th>
                    <th align="left">Qty</th>
                    <th align="left">Units</th>
                    <th align="left">Status</th>
                    <th align="left">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewItems.map((item, index) => {
                    const product = products.find(row => String(row.id) === String(item.productId));
                    return (
                      <tr key={item.lineId || index}>
                        <td>
                          <div style={{ color: '#111827' }}>{product?.name || item.productId}</div>
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
                        <td>
                          <input className="input" type="number" min="0" value={item.qty} onChange={e => setReviewItems(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, qty: Number(e.target.value) || 0 } : row))} style={{ width: 90, color: '#111827' }} disabled={(Array.isArray(item.unitIds) && item.unitIds.length > 0) || (Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0) || !((selectedRow.status === 'pending_director' && canDirectorApprove) || (selectedRow.status === 'pending_manager' && canManagerApprove)) || reviewing} />
                        </td>
                        <td style={{ color: '#111827' }}>{Array.isArray(item.unitIds) && item.unitIds.length > 0 ? item.unitIds.length : (Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 ? item.serializedEntries.length : '—')}</td>
                        <td>
                          <select className="select" value={normalizeReviewStatus(item.status)} onChange={e => setReviewItems(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, status: e.target.value } : row))} style={{ color: '#111827' }} disabled={!((selectedRow.status === 'pending_director' && canDirectorApprove) || (selectedRow.status === 'pending_manager' && canManagerApprove)) || reviewing}>
                            <option value="accepted">Accepted</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </td>
                        <td style={{ color: '#111827' }}>{item.reason || item.remark || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <label>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>Approval / Rejection Remark</div>
              <textarea className="input" value={decisionRemark} onChange={e => setDecisionRemark(e.target.value)} rows={4} style={{ width: '100%', resize: 'vertical' }} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default WholesaleOperationsPage;
