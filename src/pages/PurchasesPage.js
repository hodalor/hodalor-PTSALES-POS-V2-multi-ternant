import { useDispatch, useSelector } from 'react-redux';
import { useMemo, useState, useEffect, useRef } from 'react';
import { adjustStock } from '../store/productsSlice';
import { useToast } from '../components/ToastProvider';
import BranchSelect from '../components/BranchSelect';
import { addAudit } from '../store/auditSlice';
import { formatCurrency } from '../utils/currency';
import { useSelector as useReduxSelector } from 'react-redux';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import * as purchasesApi from '../api/purchases';
import * as auditsApi from '../api/audits';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import { approvePurchase, createPurchaseRequest, rejectPurchase } from '../store/purchasesSlice';
import { removeEntries as removeAuditEntries } from '../store/auditSlice';
import Modal from '../components/Modal';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import InlineSpinner from '../components/InlineSpinner';
import ProductLiveSearchField from '../components/ProductLiveSearchField';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';

function PurchasesPage() {
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const audit = useSelector(s => s.audit.entries);
  const [productId, setProductId] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [branchId, setBranchId] = useState(currentBranchId);
  const [qty, setQty] = useState(1);
  const [packName, setPackName] = useState('');
  const [variantId, setVariantId] = useState('');
  const [supplier, setSupplier] = useState('');
  const [cost, setCost] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [note, setNote] = useState('');
  const [serializedEntriesText, setSerializedEntriesText] = useState('');
  const [serializedScanInput, setSerializedScanInput] = useState('');
  const [serializedBatchMode, setSerializedBatchMode] = useState(true);
  const [serializedCameraOpen, setSerializedCameraOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodMode, setPeriodMode] = useState('range');
  const [fActor, setFActor] = useState('');
  const [fBranch, setFBranch] = useState(currentBranchId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('initiate'); // initiate | approvals
  const [openModal, setOpenModal] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending_director');
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const dispatch = useDispatch();
  const toast = useToast();
  const serializedScanInputRef = useRef(null);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const [auditDetail, setAuditDetail] = useState(null);
  useEffect(() => { setBranchId(currentBranchId); }, [currentBranchId]);
  useEffect(() => { setFBranch(currentBranchId); }, [currentBranchId]);

  const byId = useMemo(() => {
    const map = new Map();
    branches.forEach(b => map.set(b.id, b.name));
    return map;
  }, [branches]);
  const selectedProduct = useMemo(() => products.find(p => p.id === productId) || null, [productId, products]);
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
  useEffect(() => {
    if (!selectedProduct) {
      setCost('');
      return;
    }
    const nextCost = Number(selectedProduct.costPrice || 0);
    setCost(Number.isFinite(nextCost) ? String(nextCost) : '');
  }, [productId, variantId, selectedProduct]);
  const serializedEntries = useMemo(() => String(serializedEntriesText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[,\t|]/).map(part => part.trim()).filter(Boolean);
    return { imei: parts[0] || '', serialNumber: parts[1] || parts[0] || '' };
  }), [serializedEntriesText]);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  function has(g) {
    if (!g) return false;
    if (roleLower === 'superadmin') return true;
    return grants.includes(g);
  }
  const canReceive = (['admin','manager','inventory staff'].includes(roleLower)) || has('add_purchases');
  const canApprove = (['admin','manager','director','superadmin'].includes(roleLower)) || has('approve_purchases');
  const canDirectorApprove = (['admin','director','superadmin'].includes(roleLower)) || has('approve_wholesale_director') || has('approve_credit_director') || has('approve_purchases');
  const canManagerApprove = (['admin','manager','superadmin'].includes(roleLower)) || has('approve_wholesale_manager') || has('approve_credit_manager') || has('approve_purchases');
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
  const basePurchases = useMemo(() => audit.filter(e => e.actionType === 'stock_receive'), [audit]);
  const actors = useMemo(() => Array.from(new Set(basePurchases.map(e => e.actor).filter(Boolean))).sort(), [basePurchases]);
  const purchases = useMemo(() => {
    const fromTs = periodMode === 'all_time' ? 0 : (dateFrom ? new Date(dateFrom).getTime() : 0);
    const toTs = periodMode === 'all_time' ? Number.MAX_SAFE_INTEGER : (dateTo ? new Date(dateTo).getTime() : Number.MAX_SAFE_INTEGER);
    return basePurchases.filter(e => {
      const ts = new Date(e.ts).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (fActor && e.actor !== fActor) return false;
      if (fBranch && e.branchId !== fBranch) return false;
      return true;
    }).slice().reverse();
  }, [basePurchases, dateFrom, dateTo, fActor, fBranch, periodMode]);

  useEffect(() => {
    if (selectedTrackType === 'serialized') {
      setPackName('');
      setQty(Math.max(0, serializedEntries.length));
    }
  }, [selectedTrackType, serializedEntries.length]);
  useEffect(() => {
    if (!openModal) return;
    setProductId('');
    setProductQuery('');
    setVariantId('');
    setPackName('');
  }, [openModal]);
  useEffect(() => {
    if (filteredProducts.length > 0 && !filteredProducts.some((product) => String(product.id) === String(productId))) {
      setProductId(filteredProducts[0].id);
    }
  }, [filteredProducts, productId]);

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

  function onExportCsv() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: e => new Date(e.ts).toLocaleString() },
      { key: 'actor', label: 'Actor' },
      { key: 'product', label: 'Product', value: e => (e.details || {}).product || '' },
      { key: 'branch', label: 'Branch', value: e => byId.get(e.branchId) || e.branchId || '' },
      { key: 'qty', label: 'Qty', value: e => (e.details || {}).qty ?? '' },
      { key: 'pack', label: 'Pack', value: e => (e.details || {}).pack || 'Base Unit' },
      { key: 'baseUnits', label: 'Base Units', value: e => (e.details || {}).baseUnits ?? '' },
      { key: 'supplier', label: 'Supplier', value: e => (e.details || {}).supplier || '' },
      { key: 'cost', label: 'Cost', value: e => (e.details || {}).cost ?? '' },
      { key: 'remark', label: 'Remark', value: e => e.remark || '' }
    ];
    exportCsv('purchases.csv', headers, purchases);
  }
  function onExportPdf() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: e => new Date(e.ts).toLocaleString() },
      { key: 'actor', label: 'Actor' },
      { key: 'product', label: 'Product', value: e => (e.details || {}).product || '' },
      { key: 'branch', label: 'Branch', value: e => byId.get(e.branchId) || e.branchId || '' },
      { key: 'qty', label: 'Qty', value: e => (e.details || {}).qty ?? '' },
      { key: 'pack', label: 'Pack', value: e => (e.details || {}).pack || 'Base Unit' },
      { key: 'baseUnits', label: 'Base Units', value: e => (e.details || {}).baseUnits ?? '' },
      { key: 'supplier', label: 'Supplier', value: e => (e.details || {}).supplier || '' },
      { key: 'cost', label: 'Cost', value: e => (e.details || {}).cost ?? '' },
      { key: 'remark', label: 'Remark', value: e => e.remark || '' }
    ];
    exportTablePdf('Purchases', headers, purchases);
  }

  async function receive() {
    if (saving) return;
    if (!canReceive) {
      toast.show('Not authorized to initiate purchases', { type: 'error' });
      return;
    }
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: cannot submit purchase request', { type: 'error' });
        return;
      }
    }
    const nextItems = items.length > 0 ? items : null;
    if (!nextItems && (!productId || !branchId || (selectedTrackType === 'serialized' ? serializedEntries.length <= 0 : qty <= 0))) {
      toast.show('Select product/branch and quantity', { type: 'error' });
      return;
    }
    const price = Number(cost) || 0;
    const prod = products.find(p => p.id === productId);
    const pack = (prod?.packs || []).find(pk => pk.name === packName);
    const factor = selectedTrackType === 'serialized' ? 1 : (pack ? Number(pack.quantity) || 1 : 1);
    const baseUnits = selectedTrackType === 'serialized' ? serializedEntries.length : Number(qty) * factor;
    if (!nextItems && selectedTrackType === 'serialized' && serializedEntries.length !== baseUnits) {
      toast.show(`Enter exactly ${baseUnits} IMEI/serial entries`, { type: 'error' });
      setSaving(false);
      return;
    }
    const cpu = factor > 0 ? (price / factor) : price;
    setSaving(true);
    const clientId = `purchase-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      productId: nextItems ? nextItems[0]?.productId : productId,
      branchId,
      baseUnits: nextItems ? nextItems.reduce((sum, item) => sum + Number(item.baseUnits || 0), 0) : baseUnits,
      actor: auth.user?.name || 'unknown',
      supplier: supplier.trim() || '',
      cost: price,
      costPerUnit: cpu,
      expiryDate: expiryDate || undefined,
      remark: note.trim() || '',
      variantId: nextItems ? (nextItems[0]?.variantId || undefined) : (variantId || undefined),
      pack: selectedTrackType === 'serialized' ? '' : (pack ? pack.name : ''),
      initiatorName: auth.user?.name || 'unknown',
      initiatorRole: auth.role || '',
      clientId,
      items: nextItems || (selectedTrackType === 'serialized' ? [{
        lineId: '1',
        productId,
        variantId: variantId || '',
        baseUnits,
        serializedEntries,
        pack: pack ? pack.name : '',
        supplier: supplier.trim() || '',
        cost: price,
        costPerUnit: cpu,
        expiryDate: expiryDate || undefined,
        remark: note.trim() || '',
        status: 'accepted'
      }] : undefined)
    };
    if (!navigator.onLine) {
      try {
        await enqueueHttp({ collection: 'purchaserequests', label: 'Purchase request', path: '/api/purchases/requests', method: 'POST', body: payload });
      } catch (e) {
        toast.show(String(e?.message || 'Failed to save offline'), { type: 'error' });
        setSaving(false);
        return;
      }
    } else {
      try {
        await purchasesApi.createRequest(payload);
      } catch (e) {
        toast.show(String(e?.message || 'Failed to submit request'), { type: 'error' });
        setSaving(false);
        return;
      }
    }
    dispatch(createPurchaseRequest({
      productId,
      variantId: variantId || null,
      branchId,
      baseUnits,
      supplier: supplier.trim() || '',
      cost: price,
      costPerUnit: cpu,
      expiryDate: expiryDate || null,
      remark: note.trim() || '',
      initiatorName: auth.user?.name || 'unknown',
      initiatorRole: auth.role || '',
      pack: selectedTrackType === 'serialized' ? '' : (pack ? pack.name : ''),
      status: 'pending_director',
      clientId,
      created_at: new Date().toISOString(),
      items: nextItems || (selectedTrackType === 'serialized' ? [{
        lineId: '1',
        productId,
        variantId: variantId || '',
        baseUnits,
        serializedEntries,
        pack: pack ? pack.name : '',
        supplier: supplier.trim() || '',
        cost: price,
        costPerUnit: cpu,
        expiryDate: expiryDate || undefined,
        remark: note.trim() || '',
        status: 'accepted'
      }] : undefined)
    }));
    dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: 'purchase_initiated',
      details: { product: prod?.name || productId, variant: (prod?.variants || []).find(v => v.id === variantId)?.label || '', qty: selectedTrackType === 'serialized' ? serializedEntries.length : Number(qty), pack: selectedTrackType === 'serialized' ? 'Serialized Units' : (pack ? pack.name : 'Base Unit'), factor, baseUnits, branchId, supplier: supplier.trim() || '', cost: price, costPerUnit: cpu, expiryDate: expiryDate || null },
      remark: note.trim() || '',
      branchId,
      offline: !navigator.onLine
    }));
    setQty(1);
    setPackName('');
    setVariantId('');
    setSupplier('');
    setCost('');
    setExpiryDate('');
    setNote('');
    setSerializedEntriesText('');
    setSerializedScanInput('');
    setItems([]);
    toast.show(navigator.onLine ? 'Purchase request submitted for approval' : 'Saved offline. Will sync when online.', { type: 'success' });
    setSaving(false);
  }

  async function deleteSelectedRecords() {
    const ids = selectedRecordIds.filter(Boolean);
    if (ids.length === 0) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Delete ${ids.length} selected purchase record(s)?`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await auditsApi.removeMany(ids);
      dispatch(removeAuditEntries(ids));
      setSelectedRecordIds([]);
      setBulkAction('');
      toast.show('Purchase records deleted', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete purchase records'), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }

  function addCurrentItem() {
    if (!productId || !branchId || (selectedTrackType === 'serialized' ? serializedEntries.length <= 0 : qty <= 0)) {
      toast.show('Select product/branch and quantity', { type: 'error' });
      return;
    }
    const price = Number(cost) || 0;
    const prod = products.find(p => p.id === productId);
    const pack = (prod?.packs || []).find(pk => pk.name === packName);
    const factor = selectedTrackType === 'serialized' ? 1 : (pack ? Number(pack.quantity) || 1 : 1);
    const baseUnits = selectedTrackType === 'serialized' ? serializedEntries.length : Number(qty) * factor;
    if (selectedTrackType === 'serialized' && serializedEntries.length !== baseUnits) {
      toast.show(`Enter exactly ${baseUnits} IMEI/serial entries`, { type: 'error' });
      return;
    }
    const cpu = factor > 0 ? (price / factor) : price;
    setItems(prev => [...prev, {
      lineId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId,
      variantId: variantId || '',
      baseUnits,
      serializedEntries,
      pack: selectedTrackType === 'serialized' ? '' : (pack ? pack.name : ''),
      supplier: supplier.trim() || '',
      cost: price,
      costPerUnit: cpu,
      expiryDate: expiryDate || undefined,
      remark: note.trim() || '',
      status: 'accepted'
    }]);
    setQty(1);
    setPackName('');
    setVariantId('');
    setSupplier('');
    setCost('');
    setExpiryDate('');
    setNote('');
    setSerializedEntriesText('');
    setSerializedScanInput('');
  }

  function removeItem(lineId) {
    setItems(prev => prev.filter(item => item.lineId !== lineId));
  }

  const requests = useSelector(s => s.purchases?.requests || []);
  const allowedBranches = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return null; // null => all
    return new Set(Array.isArray(assigned) ? assigned : [assigned]);
  }, [roleLower, assigned]);
  const pendingRequests = useMemo(() => {
    return requests.filter(r => {
      const s = r.status === 'pending_approval' ? 'pending_director' : r.status;
      if (s !== statusFilter) return false;
      if (fBranch && r.branchId !== fBranch) return false;
      if (allowedBranches && !allowedBranches.has(r.branchId)) return false;
      return true;
    });
  }, [requests, statusFilter, fBranch, allowedBranches]);
  const summary = useMemo(() => {
    const totalQty = purchases.reduce((sum, row) => sum + (Number(row.details?.qty || 0) || 0), 0);
    const totalCost = purchases.reduce((sum, row) => sum + (Number(row.details?.qty || 0) * Number(row.details?.cost || 0)), 0);
    const uniqueProducts = new Set(purchases.map((row) => String(row.details?.product || '').trim()).filter(Boolean)).size;
    return {
      records: purchases.length,
      totalQty,
      totalCost,
      uniqueProducts,
      pendingApprovals: pendingRequests.length
    };
  }, [purchases, pendingRequests]);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (tab !== 'approvals') return;
      setLoading(true);
      try {
        const rows = await purchasesApi.listRequests({ status: statusFilter, limit: 200 });
        if (alive && Array.isArray(rows)) {
          const { setPurchaseRequests } = await import('../store/purchasesSlice');
          dispatch(setPurchaseRequests(rows));
        }
      } catch {}
      if (alive) setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [tab, statusFilter, fBranch, dispatch]);
  async function approve(r) {
    if (!canApprove) { toast.show('Not authorized to approve purchases', { type: 'error' }); return; }
    if (String(r.status || '') === 'pending_director' && !canDirectorApprove) { toast.show('Director approval required', { type: 'error' }); return; }
    if (String(r.status || '') === 'pending_manager' && !canManagerApprove) { toast.show('Manager approval required', { type: 'error' }); return; }
    const id = r._id || r.clientId;
    try {
      const { promptDialog } = await import('../utils/dialogs');
      let remark = await promptDialog('Enter remark for approval (required)');
      if (!remark || !String(remark).trim()) { toast.show('Remark is required', { type: 'error' }); return; }
      setBusyId(id);
      if (!navigator.onLine) {
        await enqueueHttp({ collection: 'purchaserequests', label: 'Purchase approve', path: '/api/purchases/approve', method: 'POST', body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark } });
      } else {
        const response = await purchasesApi.approve({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
        const nextStatus = String(response?.status || '');
        dispatch(approvePurchase({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, nextStatus }));
        if (nextStatus === 'approved') {
          dispatch(adjustStock({ productId: r.productId, variantId: r.variantId || undefined, branchId: r.branchId, delta: Number(r.baseUnits || 0) }));
          void refreshAffectedProducts(dispatch, [r.productId]);
          toast.show('Purchase approved and stock updated', { type: 'success' });
        } else {
          toast.show('Director approval recorded. Waiting for manager approval.', { type: 'success' });
        }
        return;
      }
      dispatch(approvePurchase({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, nextStatus: 'pending_manager' }));
      toast.show('Purchase approval queued offline', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to approve'), { type: 'error' });
    } finally { setBusyId(null); }
  }
  async function reject(r) {
    if (!canApprove) { toast.show('Not authorized to reject purchases', { type: 'error' }); return; }
    const id = r._id || r.clientId;
    try {
      const { promptDialog } = await import('../utils/dialogs');
      let remark = await promptDialog('Enter reason for rejection (required)');
      if (!remark || !String(remark).trim()) { toast.show('Remark is required', { type: 'error' }); return; }
      setBusyId(id);
      if (!navigator.onLine) {
        await enqueueHttp({ collection: 'purchaserequests', label: 'Purchase reject', path: '/api/purchases/reject', method: 'POST', body: { id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark } });
      } else {
        await purchasesApi.reject({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark });
      }
      dispatch(rejectPurchase({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark }));
      toast.show('Purchase rejected', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to reject'), { type: 'error' });
    } finally { setBusyId(null); }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Purchases</h1>
        <div className="filter-actions">
          {tab === 'initiate' && (
          <button className="btn btn-primary" onClick={() => { setOpenModal(true); }}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
            Add Purchase
          </button>
          )}
          <OfflineQueueIndicator collection="purchaserequests" label="Purchases queued" />
          <OfflineQueueIndicator collection="audits" label="Stock queued" />
        </div>
      </div>
      <div className="filter-actions" style={{ marginBottom: 12 }}>
        <button className={tab === 'initiate' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('initiate')}>Initiate</button>
        <button className={tab === 'approvals' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('approvals')} disabled={!canApprove}>Approvals</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Purchase Records</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.records}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Units Purchased</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.totalQty}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Purchase Value</div><div style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(summary.totalCost, settings)}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Products</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.uniqueProducts}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Pending Approvals</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.pendingApprovals}</div></div>
      </div>
      {openModal && (
        <Modal title="Add Purchase" onClose={() => setOpenModal(false)} footer={
          <>
            <button className="btn" onClick={() => setOpenModal(false)}>Cancel</button>
            <button className="btn" onClick={addCurrentItem} disabled={!canReceive || saving}>Add To List</button>
            <button className="btn btn-primary" onClick={async () => { await receive(); setOpenModal(false); }} disabled={!canReceive || saving}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2"/><path d="M5 19h14" stroke="currentColor" strokeWidth="2"/></svg>
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
                    setPackName('');
                  }
                }}
                products={filteredProducts}
                allProducts={products}
                selectedProductId={productId}
                onSelect={(product) => {
                  setProductId(product.id);
                  setVariantId('');
                  setPackName('');
                  setProductQuery('');
                }}
              />
            </div>
            <label>
              <div style={{ marginBottom: 6, color: '#64748b' }}>Branch</div>
              <BranchSelect value={branchId} onChange={setBranchId} />
            </label>
            {(products.find(p => p.id === productId)?.variants || []).length > 0 && (
              <label>
                <div style={{ marginBottom: 6, color: '#64748b' }}>Variant</div>
                <select className="select" value={variantId} onChange={e => setVariantId(e.target.value)}>
                  <option value="">None (base)</option>
                  {(products.find(p => p.id === productId)?.variants || []).map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
            )}
            {selectedProduct && (
              <label>
                <div style={{ marginBottom: 6, color: '#64748b' }}>Pack</div>
                <select className="select" value={packName} onChange={e => setPackName(e.target.value)} disabled={selectedTrackType === 'serialized'}>
                  <option value="">Base Unit</option>
                  {(products.find(p => p.id === productId)?.packs || []).map(pk => (
                    <option key={pk.name} value={pk.name}>{pk.name} = {pk.quantity} units</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <div style={{ marginBottom: 6, color: '#64748b' }}>Quantity</div>
              <input className="input" type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} disabled={selectedTrackType === 'serialized'} />
            </label>
            {selectedTrackType === 'serialized' && (
              <label style={{ gridColumn: '1 / -1' }}>
                <div style={{ marginBottom: 6, color: '#64748b' }}>IMEI / Serial Numbers</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
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
                  style={{ marginBottom: 8, color: '#111827', background: '#ffffff' }}
                />
                <textarea className="input" rows={6} value={serializedEntriesText} onChange={e => setSerializedEntriesText(e.target.value)} placeholder={'One per line\nIMEI123456789\nIMEI987654321,SN-0002'} style={{ color: '#111827', background: '#ffffff' }} />
                <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 12 }}>
                  Enter one unit per line. Quantity updates automatically from scanned/entered IMEI values. Current entries: {serializedEntries.length}.
                </div>
              </label>
            )}
            <label>
              <div style={{ marginBottom: 6, color: '#64748b' }}>Supplier</div>
              <input className="input" placeholder="e.g., FreshCo" value={supplier} onChange={e => setSupplier(e.target.value)} list="suppliers-list" />
              <SuppliersDatalist />
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#64748b' }}>Cost Price</div>
              <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={cost} onChange={e => setCost(e.target.value)} />
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#64748b' }}>Expiry Date</div>
              <input className="input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <div style={{ marginBottom: 6, color: '#64748b' }}>Remark</div>
              <input className="input" placeholder="Optional note" value={note} onChange={e => setNote(e.target.value)} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6, color: '#64748b' }}>Items In This Request</div>
            <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th align="left">Product</th>
                  <th align="left">Base Units</th>
                  <th align="left">Serialized</th>
                  <th align="left">Supplier</th>
                  <th align="left"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const product = products.find(p => p.id === item.productId);
                  return (
                    <tr key={item.lineId}>
                      <td>{product?.name || item.productId}</td>
                      <td>{item.baseUnits}</td>
                      <td>{Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 ? item.serializedEntries.length : '—'}</td>
                      <td>{item.supplier || '—'}</td>
                      <td><button className="btn" onClick={() => removeItem(item.lineId)}>Remove</button></td>
                    </tr>
                  );
                })}
                {items.length === 0 && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>No items added yet. You can still submit a single item.</td></tr>}
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
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 className="section-title" style={{ marginBottom: 8 }}>Approvals</h2>
            <div className="card-scroll-x">
            <div style={{ display: 'flex', gap: 6 }}>
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
                <th align="left">Branch</th>
                <th align="left">Base Units</th>
                <th align="left">Supplier</th>
                <th align="left">Cost</th>
                <th align="left"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="6" style={{ padding: 12, color: '#64748b' }}>Loading…</td></tr>}
              {!loading && pendingRequests.map(r => {
                const p = products.find(x => x.id === r.productId);
                const branchName = byId.get(r.branchId) || r.branchId;
                return (
                  <tr key={r._id || r.clientId} style={{ borderTop: '1px solid #e2e8f0', cursor: 'pointer' }} onClick={() => setDetail(r)}>
                    <td>{p?.name || r.productId}</td>
                    <td>{branchName}</td>
                    <td>{r.baseUnits}</td>
                    <td>{r.supplier || '—'}</td>
                    <td>{Number.isFinite(Number(r.cost)) ? formatCurrency(Number(r.cost), settings) : '—'}</td>
                    <td>
                      {['pending_approval', 'pending_director', 'pending_manager'].includes(String(r.status || '')) ? (
                        <>
                          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); approve(r); }} disabled={((String(r.status || '') === 'pending_director' && !canDirectorApprove) || (String(r.status || '') === 'pending_manager' && !canManagerApprove) || busyId === (r._id || r.clientId))}>{busyId === (r._id || r.clientId) ? 'Working…' : String(r.status || '') === 'pending_manager' ? 'Manager Approve' : 'Director Approve'}</button>
                          <button className="btn" onClick={(e) => { e.stopPropagation(); reject(r); }} style={{ marginLeft: 6 }} disabled={!canApprove || busyId === (r._id || r.clientId)}>{busyId === (r._id || r.clientId) ? 'Working…' : 'Reject'}</button>
                        </>
                      ) : (
                        <span style={{ color: r.status === 'approved' ? '#10b981' : '#ef4444', fontWeight: 600 }}>{r.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && pendingRequests.length === 0 && <tr><td colSpan="6" style={{ padding: 12, color: '#64748b' }}>No items</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {detail && (
        <Modal title="Purchase Details" onClose={() => setDetail(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><div style={{ color: '#64748b' }}>Status</div><div>{detail.status}</div></div>
            <div><div style={{ color: '#64748b' }}>Branch</div><div>{byId.get(detail.branchId) || detail.branchId}</div></div>
            <div><div style={{ color: '#64748b' }}>Product</div><div>{products.find(p => p.id === detail.productId)?.name || detail.productId}</div></div>
            {detail.variantId ? <div><div style={{ color: '#64748b' }}>Variant</div><div>{(products.find(p => p.id === detail.productId)?.variants || []).find(v => v.id === detail.variantId)?.label || detail.variantId}</div></div> : null}
            <div><div style={{ color: '#64748b' }}>Base Units</div><div>{detail.baseUnits}</div></div>
            <div><div style={{ color: '#64748b' }}>Pack</div><div>{detail.pack || 'Base Unit'}</div></div>
            <div><div style={{ color: '#64748b' }}>Supplier</div><div>{detail.supplier || '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Cost</div><div>{Number.isFinite(Number(detail.cost)) ? formatCurrency(Number(detail.cost), settings) : '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Initiator</div><div>{detail.initiatorName} {detail.initiatorRole ? `(${detail.initiatorRole})` : ''}</div></div>
            <div><div style={{ color: '#64748b' }}>Initiation Remark</div><div>{detail.remark || '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Approver</div><div>{detail.approverName ? `${detail.approverName}${detail.approverRole ? ` (${detail.approverRole})` : ''}` : '—'}</div></div>
            {detail.status === 'approved' && <div><div style={{ color: '#64748b' }}>Approval Remark</div><div>{detail.approvalRemark || '—'}</div></div>}
            {detail.status === 'rejected' && <div><div style={{ color: '#64748b' }}>Rejection Remark</div><div>{detail.rejectionRemark || '—'}</div></div>}
            <div><div style={{ color: '#64748b' }}>Created</div><div>{detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Updated</div><div>{detail.updatedAt ? new Date(detail.updatedAt).toLocaleString() : '—'}</div></div>
          </div>
          {Array.isArray(detail.items) && detail.items.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 6, color: '#64748b' }}>Request Items</div>
              <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">Product</th>
                    <th align="left">Base Units</th>
                    <th align="left">Serialized</th>
                    <th align="left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, index) => {
                    const product = products.find(p => p.id === item.productId);
                    return (
                      <tr key={item.lineId || index}>
                        <td>
                          <div style={{ color: '#111827' }}>{product?.name || item.productId}</div>
                          {Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 && (
                            <div style={{ marginTop: 4, color: '#111827', fontSize: 12 }}>
                              {item.serializedEntries.map(unit => unit.imei || unit.serialNumber).filter(Boolean).join(', ')}
                            </div>
                          )}
                        </td>
                        <td>{item.baseUnits}</td>
                        <td>{Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 ? item.serializedEntries.length : '—'}</td>
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
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-scroll-x">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr) auto', gap: 8, marginBottom: 8 }}>
          <label>
            Period
            <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
              <option value="range">Custom Range</option>
              <option value="all_time">All Time</option>
            </select>
          </label>
          <label>
            From
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            To
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            Actor
            <select className="select" value={fActor} onChange={e => setFActor(e.target.value)}>
              <option value="">All</option>
              {actors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>
            Branch
            <select className="select" value={fBranch} onChange={e => setFBranch(e.target.value)}>
              {(roleLower === 'superadmin' || roleLower === 'admin') && <option value="">All</option>}
              {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <div style={{ alignSelf: 'end', display: 'flex', gap: 6 }}>
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
        <h2 className="section-title">Recent Purchases</h2>
        <div className="table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Timestamp</th>
              <th align="left">Actor</th>
              <th align="left">Product</th>
              <th align="left">Branch</th>
              <th align="left">Qty</th>
              <th align="left">Pack</th>
              <th align="left">Base Units</th>
              <th align="left">Supplier</th>
              <th align="left">Cost</th>
              <th align="left">Remark</th>
              {canDeleteRecords && (
                <th align="left">
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={purchases.length > 0 && purchases.every(entry => selectedRecordIds.includes(String(entry._id || entry.id || '')))}
                    onChange={e => setSelectedRecordIds(e.target.checked ? purchases.map(entry => String(entry._id || entry.id || '')).filter(Boolean) : [])}
                  />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {purchases.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(e => {
              const d = e.details || {};
              const branchName = byId.get(e.branchId) || e.branchId || '—';
              return (
                <tr key={e.id} style={{ borderTop: '1px solid #e2e8f0', cursor: bulkDeleting ? 'default' : 'pointer', opacity: bulkDeleting && selectedRecordIds.includes(String(e._id || e.id || '')) ? 0.55 : 1 }} onClick={() => { if (!bulkDeleting) setAuditDetail(e); }}>
                  <td>{new Date(e.ts).toLocaleString()}</td>
                  <td>{e.actor}</td>
                  <td>{d.product || '—'}</td>
                  <td>{branchName}</td>
                  <td>{d.qty ?? '—'}</td>
                  <td>{d.pack || 'Base Unit'}</td>
                  <td>{d.baseUnits ?? (Number(d.qty) || 0) * (Number(d.factor) || 1)}</td>
                  <td>{d.supplier || '—'}</td>
                  <td>{Number.isFinite(Number(d.cost)) ? formatCurrency(Number(d.cost), settings) : '—'}</td>
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
            {purchases.length === 0 && (
              <tr><td colSpan={canDeleteRecords ? 11 : 10} style={{ padding: 12, color: '#64748b' }}>No purchase records yet</td></tr>
            )}
          </tbody>
        </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
            <span>Page {page} of {Math.max(1, Math.ceil(purchases.length / pageSize))}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(purchases.length / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(purchases.length / pageSize))}>Next</button>
          </div>
          <label>
            <span style={{ marginRight: 6 }}>Rows</span>
            <select className="select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>
      {auditDetail && (
        <Modal title="Purchase Record" onClose={() => setAuditDetail(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><div style={{ color: '#64748b' }}>Timestamp</div><div>{auditDetail.ts ? new Date(auditDetail.ts).toLocaleString() : '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Actor</div><div>{auditDetail.actor || '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Product</div><div>{(auditDetail.details || {}).product || '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Branch</div><div>{byId.get(auditDetail.branchId) || auditDetail.branchId || '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Qty</div><div>{(auditDetail.details || {}).qty ?? '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Pack</div><div>{(auditDetail.details || {}).pack || 'Base Unit'}</div></div>
            <div><div style={{ color: '#64748b' }}>Base Units</div><div>{(auditDetail.details || {}).baseUnits ?? '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Supplier</div><div>{(auditDetail.details || {}).supplier || '—'}</div></div>
            <div><div style={{ color: '#64748b' }}>Cost</div><div>{Number.isFinite(Number((auditDetail.details || {}).cost)) ? formatCurrency(Number((auditDetail.details || {}).cost), settings) : '—'}</div></div>
            <div style={{ gridColumn: '1 / -1' }}><div style={{ color: '#64748b' }}>Remark</div><div>{auditDetail.remark || '—'}</div></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SuppliersDatalist() {
  const list = useReduxSelector(s => s.suppliers?.suppliers || []);
  return (
    <datalist id="suppliers-list">
      {list.map(s => <option key={s.id} value={s.name} />)}
    </datalist>
  );
}

export default PurchasesPage;
