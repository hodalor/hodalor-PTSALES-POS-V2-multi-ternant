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
import { ensureSupplierByName } from '../utils/suppliers';
import LoadingDots from '../components/LoadingDots';
import { useAppLanguage } from '../utils/localization';
import { formatDateTime, getOperationSearchValues, matchesDateField, matchesFilterText } from '../utils/inventoryFilters';

function PurchasesPage() {
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const suppliers = useSelector(s => s.suppliers?.suppliers || []);
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
  const [transactionTitle, setTransactionTitle] = useState('');
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
  const [recordQuery, setRecordQuery] = useState('');
  const [approvalQuery, setApprovalQuery] = useState('');
  const [approvalDateField, setApprovalDateField] = useState('created');
  const [approvalDateFrom, setApprovalDateFrom] = useState('');
  const [approvalDateTo, setApprovalDateTo] = useState('');
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [reloadAt, setReloadAt] = useState(0);
  const dispatch = useDispatch();
  const toast = useToast();
  const { t } = useAppLanguage();
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
  const branchTypeById = useMemo(() => {
    const map = new Map();
    branches.forEach(branch => map.set(String(branch.id), String(branch.branchType || 'retail').toLowerCase()));
    return map;
  }, [branches]);
  function inventoryTypeForBranch(targetBranchId) {
    const kind = String(branchTypeById.get(String(targetBranchId)) || 'retail').toLowerCase();
    return kind === 'warehouse' ? 'warehouse' : kind === 'wholesale' ? 'wholesale' : 'retail';
  }
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
  const authTenantId = String(auth.user?.tenantId || '').trim().toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  function has(g) {
    if (!g) return false;
    if (roleLower === 'superadmin') return true;
    return grants.includes(g);
  }
  const canReceive = (['admin','manager','inventory staff'].includes(roleLower)) || has('add_purchases');
  const canApprove = (['admin','manager','director','superadmin'].includes(roleLower)) || has('approve_purchases');
  const canDirectorApprove = (['admin','director','superadmin'].includes(roleLower)) || has('approve_credit_director') || has('approve_purchases');
  const canManagerApprove = (['admin','manager','superadmin'].includes(roleLower)) || has('approve_credit_manager') || has('approve_purchases');
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
  const basePurchases = useMemo(() => audit.filter((entry) => {
    if (entry.actionType !== 'stock_receive') return false;
    const entryTenantId = String(entry?.tenantId || '').trim().toLowerCase();
    if (!entryTenantId) return authTenantId !== 'master';
    return entryTenantId === authTenantId;
  }), [audit, authTenantId]);
  const actors = useMemo(() => Array.from(new Set(basePurchases.map(e => e.actor).filter(Boolean))).sort(), [basePurchases]);
  const purchases = useMemo(() => {
    const fromTs = periodMode === 'all_time' ? 0 : (dateFrom ? new Date(dateFrom).getTime() : 0);
    const toTs = periodMode === 'all_time' ? Number.MAX_SAFE_INTEGER : (dateTo ? new Date(dateTo).getTime() : Number.MAX_SAFE_INTEGER);
    return basePurchases.filter(e => {
      const ts = new Date(e.ts).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (fActor && e.actor !== fActor) return false;
      if (fBranch && e.branchId !== fBranch) return false;
      if (!matchesFilterText([(e.details || {}).product, (e.details || {}).variant, (e.details || {}).supplier, e.remark, e.actor, byId.get(e.branchId)], recordQuery)) return false;
      return true;
    }).slice().reverse();
  }, [basePurchases, byId, dateFrom, dateTo, fActor, fBranch, periodMode, recordQuery]);

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
    setTransactionTitle('');
  }, [openModal]);
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
    exportTablePdf(t('Purchases'), headers, purchases);
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
    if (!nextItems && (!selectedProduct || !branchId || (selectedTrackType === 'serialized' ? serializedEntries.length <= 0 : qty <= 0))) {
      toast.show('Select product/branch and quantity', { type: 'error' });
      return;
    }
    const price = Number(cost) || 0;
    const prod = selectedProduct;
    const pack = (prod?.packs || []).find(pk => pk.name === packName);
    const factor = selectedTrackType === 'serialized' ? 1 : (pack ? Number(pack.quantity) || 1 : 1);
    const baseUnits = selectedTrackType === 'serialized' ? serializedEntries.length : Number(qty) * factor;
    if (!nextItems && selectedTrackType === 'serialized' && serializedEntries.length !== baseUnits) {
      toast.show(`Enter exactly ${baseUnits} IMEI/serial entries`, { type: 'error' });
      setSaving(false);
      return;
    }
    const cpu = factor > 0 ? (price / factor) : price;
    let supplierName = supplier.trim() || '';
    if (supplierName) {
      try {
        const ensuredSupplier = await ensureSupplierByName({ name: supplierName, suppliers, dispatch, offlineBackupAllowed });
        supplierName = ensuredSupplier?.name || supplierName;
      } catch (e) {
        toast.show(String(e?.message || 'Failed to save supplier'), { type: 'error' });
        return;
      }
    }
    setSaving(true);
    const clientId = `purchase-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      productId: nextItems ? nextItems[0]?.productId : selectedProduct?.id,
      branchId,
      baseUnits: nextItems ? nextItems.reduce((sum, item) => sum + Number(item.baseUnits || 0), 0) : baseUnits,
      actor: auth.user?.name || 'unknown',
      supplier: supplierName,
      transactionTitle: transactionTitle.trim() || '',
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
        productId: selectedProduct?.id,
        variantId: variantId || '',
        baseUnits,
        serializedEntries,
        pack: pack ? pack.name : '',
        supplier: supplierName,
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
      productId: selectedProduct?.id,
      variantId: variantId || null,
      branchId,
      baseUnits,
      supplier: supplierName,
      transactionTitle: transactionTitle.trim() || '',
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
        supplier: supplierName,
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
      details: { product: prod?.name || productId, variant: (prod?.variants || []).find(v => v.id === variantId)?.label || '', qty: selectedTrackType === 'serialized' ? serializedEntries.length : Number(qty), pack: selectedTrackType === 'serialized' ? 'Serialized Units' : (pack ? pack.name : 'Base Unit'), factor, baseUnits, branchId, supplier: supplierName, transactionTitle: transactionTitle.trim() || '', cost: price, costPerUnit: cpu, expiryDate: expiryDate || null },
      remark: note.trim() || '',
      branchId,
      offline: !navigator.onLine
    }));
    setQty(1);
    setPackName('');
    setVariantId('');
    setSupplier('');
    setTransactionTitle('');
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
    if (!selectedProduct || !branchId || (selectedTrackType === 'serialized' ? serializedEntries.length <= 0 : qty <= 0)) {
      toast.show('Select product/branch and quantity', { type: 'error' });
      return;
    }
    const price = Number(cost) || 0;
    const prod = selectedProduct;
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
      productId: selectedProduct?.id,
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
  const filteredPendingRequests = useMemo(() => {
    return pendingRequests.filter((row) => {
      if (!matchesFilterText(getOperationSearchValues(row, products, byId), approvalQuery)) {
        return false;
      }
      return matchesDateField(row, approvalDateField, approvalDateFrom, approvalDateTo);
    });
  }, [approvalDateField, approvalDateFrom, approvalDateTo, approvalQuery, byId, pendingRequests, products]);
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
  }, [tab, statusFilter, fBranch, reloadAt, dispatch]);
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
          const approvedItems = Array.isArray(response?.items) && response.items.length > 0 ? response.items : (Array.isArray(r.items) ? r.items : []);
          approvedItems.forEach((item) => {
            if (String(item?.status || '').toLowerCase() === 'cancelled') return;
            dispatch(adjustStock({
              productId: item.productId,
              variantId: item.variantId || undefined,
              branchId: response?.branchId || r.branchId,
              delta: Number(item.baseUnits || 0),
              inventoryType: inventoryTypeForBranch(response?.branchId || r.branchId)
            }));
          });
          void refreshAffectedProducts(dispatch, Array.from(new Set(approvedItems.map((item) => item?.productId).filter(Boolean))));
          toast.show('Purchase approved and stock updated', { type: 'success' });
          setStatusFilter('approved');
          setReloadAt(Date.now());
        } else {
          toast.show('Director approval recorded. Waiting for manager approval.', { type: 'success' });
          setStatusFilter('pending_manager');
          setReloadAt(Date.now());
        }
        return;
      }
      dispatch(approvePurchase({ id, approverName: auth.user?.name || 'unknown', approverRole: auth.role || '', remark, nextStatus: 'pending_manager' }));
      toast.show('Purchase approval queued offline', { type: 'success' });
    } catch (e) {
      const message = String(e?.message || 'Failed to approve');
      if (/timed out/i.test(message)) {
        setReloadAt(Date.now());
        toast.show('Approval is still processing. Refreshing status now.', { type: 'warning' });
      } else {
        toast.show(message, { type: 'error' });
      }
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
      setStatusFilter('rejected');
      setReloadAt(Date.now());
    } catch (e) {
      toast.show(String(e?.message || 'Failed to reject'), { type: 'error' });
    } finally { setBusyId(null); }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>{t('Purchases')}</h1>
          <div className="page-subtitle-compact">{t('Create, review, and approve retail purchase requests with a cleaner workflow.')}</div>
        </div>
        <div className="page-header-actions">
          {tab === 'initiate' && (
          <button className="btn btn-primary" onClick={() => { setOpenModal(true); }}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
            {t('Add Purchase')}
          </button>
          )}
          <OfflineQueueIndicator collection="purchaserequests" label={t('Purchases queued')} />
          <OfflineQueueIndicator collection="audits" label={t('Stock queued')} />
        </div>
      </div>
      <div className="page-tabs">
        <button className={tab === 'initiate' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('initiate')}>{t('Initiate')}</button>
        <button className={tab === 'approvals' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('approvals')} disabled={!canApprove}>{t('Approvals')}</button>
      </div>
      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-label">{t('Purchase Records')}</div><div className="stat-value">{summary.records}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Units Purchased')}</div><div className="stat-value">{summary.totalQty}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Purchase Value')}</div><div className="stat-value-compact price-accent">{formatCurrency(summary.totalCost, settings)}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Products')}</div><div className="stat-value">{summary.uniqueProducts}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Pending Approvals')}</div><div className="stat-value">{summary.pendingApprovals}</div></div>
      </div>
      {openModal && (
        <Modal title={t('Add Purchase')} onClose={() => setOpenModal(false)} footer={
          <>
            <button className="btn" onClick={() => setOpenModal(false)}>{t('Cancel')}</button>
            <button className="btn" onClick={addCurrentItem} disabled={!canReceive || saving}>{t('Add To List')}</button>
            <button className="btn btn-primary" onClick={async () => { await receive(); setOpenModal(false); }} disabled={!canReceive || saving}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2"/><path d="M5 19h14" stroke="currentColor" strokeWidth="2"/></svg>
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
              <div className="field-label">{t('Branch')}</div>
              <BranchSelect value={branchId} onChange={setBranchId} overrideBranches={retailBranchOptions} />
            </label>
            {(selectedProduct?.variants || []).length > 0 && (
              <label>
                <div className="field-label">{t('Variant')}</div>
                <select className="select" value={variantId} onChange={e => setVariantId(e.target.value)}>
                  <option value="">{t('None (base)')}</option>
                  {(selectedProduct?.variants || []).map(v => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </label>
            )}
            {selectedProduct && (
              <label>
                <div className="field-label">{t('Pack')}</div>
                <select className="select" value={packName} onChange={e => setPackName(e.target.value)} disabled={selectedTrackType === 'serialized'}>
                  <option value="">{t('Base Unit')}</option>
                  {(selectedProduct?.packs || []).map(pk => (
                    <option key={pk.name} value={pk.name}>{pk.name} = {pk.quantity} units</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <div className="field-label">{t('Quantity')}</div>
              <input className="input" type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} disabled={selectedTrackType === 'serialized'} />
            </label>
            {selectedTrackType === 'serialized' && (
              <label style={{ gridColumn: '1 / -1' }}>
                <div className="field-label">{t('IMEI / Serial Numbers')}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <button type="button" className={serializedBatchMode ? 'btn btn-primary' : 'btn'} onClick={() => { setSerializedBatchMode(v => !v); setTimeout(() => { try { serializedScanInputRef.current?.focus(); } catch {} }, 0); }}>
                    {serializedBatchMode ? t('Batch Mode On') : t('Batch Mode Off')}
                  </button>
                  <button type="button" className="btn" onClick={() => setSerializedCameraOpen(true)}>
                    {t('Camera Scan')}
                  </button>
                </div>
                <input
                  ref={serializedScanInputRef}
                  className="input"
                  autoFocus
                  placeholder={t('Scan IMEI barcode or type and press Enter')}
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
                <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 12 }}>{t('Enter one unit per line. Quantity updates automatically from scanned/entered IMEI values. Current entries: {count}.', { count: serializedEntries.length })}</div>
              </label>
            )}
            <label>
              <div className="field-label">{t('Supplier')}</div>
              <input className="input" placeholder="e.g., FreshCo" value={supplier} onChange={e => setSupplier(e.target.value)} list="suppliers-list" />
              <SuppliersDatalist />
            </label>
            <label>
              <div className="field-label">{t('Transaction Title')}</div>
              <input className="input" placeholder={t('Optional bulk purchase title')} value={transactionTitle} onChange={e => setTransactionTitle(e.target.value)} />
            </label>
            <label>
              <div className="field-label">{t('Cost Price')}</div>
              <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={cost} onChange={e => setCost(e.target.value)} />
            </label>
            <label>
              <div className="field-label">{t('Expiry Date')}</div>
              <input className="input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">{t('Remark')}</div>
              <input className="input" placeholder={t('Optional note')} value={note} onChange={e => setNote(e.target.value)} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="field-label">{t('Request Items')}</div>
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
          <div className="record-filters" style={{ marginBottom: 12 }}>
            <label>
              <div className="field-label">{t('Search Product')}</div>
              <input className="input" value={approvalQuery} onChange={e => setApprovalQuery(e.target.value)} placeholder={t('Search product, branch, supplier, or remark')} />
            </label>
            <label>
              <div className="field-label">{t('Date Type')}</div>
              <select className="select" value={approvalDateField} onChange={e => setApprovalDateField(e.target.value)}>
                <option value="created">{t('Initiated Date')}</option>
                <option value="director">{t('Director Approval Date')}</option>
                <option value="manager">{t('Manager Approval Date')}</option>
                <option value="decision">{t('Final Decision Date')}</option>
              </select>
            </label>
            <label>
              <div className="field-label">{t('From')}</div>
              <input className="input" type="date" value={approvalDateFrom} onChange={e => setApprovalDateFrom(e.target.value)} />
            </label>
            <label>
              <div className="field-label">{t('To')}</div>
              <input className="input" type="date" value={approvalDateTo} onChange={e => setApprovalDateTo(e.target.value)} />
            </label>
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
                <th align="left">{t('Initiated Date')}</th>
                <th align="left">{t('Director Approval Date')}</th>
                <th align="left">{t('Manager Approval Date')}</th>
                <th align="left"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="9" style={{ padding: 12, color: '#64748b' }}><LoadingDots label={t('Loading purchases')} /></td></tr>}
              {!loading && filteredPendingRequests.map(r => {
                const p = products.find(x => x.id === r.productId);
                const branchName = byId.get(r.branchId) || r.branchId;
                const title = String(r.transactionTitle || '').trim() || (Array.isArray(r.items) && r.items.length > 1 ? `${p?.name || r.productId} +${r.items.length - 1} more` : (p?.name || r.productId));
                return (
                  <tr key={r._id || r.clientId} style={{ cursor: 'pointer' }} onClick={() => setDetail(r)}>
                    <td>{title}</td>
                    <td>{branchName}</td>
                    <td>{r.baseUnits}</td>
                    <td>{r.supplier || '—'}</td>
                    <td>{Number.isFinite(Number(r.cost)) ? <span className="price-accent">{formatCurrency(Number(r.cost), settings)}</span> : '—'}</td>
                    <td>{formatDateTime(r.createdAt || r.created_at)}</td>
                    <td>{formatDateTime(r.directorApproved_at || r.directorApprovedAt)}</td>
                    <td>{formatDateTime(r.managerApproved_at || r.managerApprovedAt)}</td>
                    <td>
                      {['pending_approval', 'pending_director', 'pending_manager'].includes(String(r.status || '')) ? (
                        <div className="approval-row-actions">
                          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); approve(r); }} disabled={((String(r.status || '') === 'pending_director' && !canDirectorApprove) || (String(r.status || '') === 'pending_manager' && !canManagerApprove) || busyId === (r._id || r.clientId))}>{busyId === (r._id || r.clientId) ? t('Working…') : String(r.status || '') === 'pending_manager' ? t('Manager Approve') : t('Director Approve')}</button>
                          <button className="btn" onClick={(e) => { e.stopPropagation(); reject(r); }} disabled={!canApprove || busyId === (r._id || r.clientId)}>{busyId === (r._id || r.clientId) ? t('Working…') : t('Rejected')}</button>
                        </div>
                      ) : (
                        <span className={`status-pill ${r.status === 'approved' ? 'status-pill-approved' : 'status-pill-rejected'}`}>{r.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredPendingRequests.length === 0 && <tr><td colSpan="9" style={{ padding: 12, color: '#64748b' }}>{t('No items')}</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {detail && (
        <Modal title={t('Purchase Details')} onClose={() => setDetail(null)}>
          <div className="detail-grid">
            <div className="detail-field"><div className="detail-label">Status</div><div className="detail-value"><span className={`status-pill ${detail.status === 'approved' ? 'status-pill-approved' : detail.status === 'rejected' ? 'status-pill-rejected' : 'status-pill-pending'}`}>{detail.status}</span></div></div>
            <div className="detail-field"><div className="detail-label">Branch</div><div className="detail-value">{byId.get(detail.branchId) || detail.branchId}</div></div>
            <div className="detail-field"><div className="detail-label">Title</div><div className="detail-value">{detail.transactionTitle || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Product</div><div className="detail-value">{products.find(p => p.id === detail.productId)?.name || detail.productId}</div></div>
            {detail.variantId ? <div className="detail-field"><div className="detail-label">Variant</div><div className="detail-value">{(products.find(p => p.id === detail.productId)?.variants || []).find(v => v.id === detail.variantId)?.label || detail.variantId}</div></div> : null}
            <div className="detail-field"><div className="detail-label">Base Units</div><div className="detail-value">{detail.baseUnits}</div></div>
            <div className="detail-field"><div className="detail-label">Pack</div><div className="detail-value">{detail.pack || 'Base Unit'}</div></div>
            <div className="detail-field"><div className="detail-label">Supplier</div><div className="detail-value">{detail.supplier || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Cost</div><div className="detail-value">{Number.isFinite(Number(detail.cost)) ? <span className="price-accent">{formatCurrency(Number(detail.cost), settings)}</span> : '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Initiator</div><div className="detail-value">{detail.initiatorName} {detail.initiatorRole ? `(${detail.initiatorRole})` : ''}</div></div>
            <div className="detail-field"><div className="detail-label">Initiation Remark</div><div className="detail-value">{detail.remark || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Approver</div><div className="detail-value">{detail.approverName ? `${detail.approverName}${detail.approverRole ? ` (${detail.approverRole})` : ''}` : '—'}</div></div>
            {detail.status === 'approved' && <div className="detail-field"><div className="detail-label">Approval Remark</div><div className="detail-value">{detail.approvalRemark || '—'}</div></div>}
            {detail.status === 'rejected' && <div className="detail-field"><div className="detail-label">Rejection Remark</div><div className="detail-value">{detail.rejectionRemark || '—'}</div></div>}
            <div className="detail-field"><div className="detail-label">Created</div><div className="detail-value">{detail.createdAt ? new Date(detail.createdAt).toLocaleString() : '—'}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Director Approval Date')}</div><div className="detail-value">{formatDateTime(detail.directorApproved_at || detail.directorApprovedAt)}</div></div>
            <div className="detail-field"><div className="detail-label">{t('Manager Approval Date')}</div><div className="detail-value">{formatDateTime(detail.managerApproved_at || detail.managerApprovedAt)}</div></div>
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
            <div className="field-label">{t('Branch')}</div>
            <select className="select" value={fBranch} onChange={e => setFBranch(e.target.value)}>
              {(roleLower === 'superadmin' || roleLower === 'admin') && <option value="">{t('All')}</option>}
              {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>
            <div className="field-label">{t('Search Product')}</div>
            <input className="input" value={recordQuery} onChange={e => setRecordQuery(e.target.value)} placeholder={t('Search product, branch, supplier, actor, or remark')} />
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
                    {bulkDeleting ? t('Working…') : t('Apply')}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
        </div>
        <h2 className="section-title">{t('Recent Purchases')}</h2>
        <div className="table-wrap">
        <table className="table">
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
                <tr key={e.id} style={{ cursor: bulkDeleting ? 'default' : 'pointer', opacity: bulkDeleting && selectedRecordIds.includes(String(e._id || e.id || '')) ? 0.55 : 1 }} onClick={() => { if (!bulkDeleting) setAuditDetail(e); }}>
                  <td>{new Date(e.ts).toLocaleString()}</td>
                  <td>{e.actor}</td>
                  <td>{d.product || '—'}</td>
                  <td>{branchName}</td>
                  <td>{d.qty ?? '—'}</td>
                  <td>{d.pack || 'Base Unit'}</td>
                  <td>{d.baseUnits ?? (Number(d.qty) || 0) * (Number(d.factor) || 1)}</td>
                  <td>{d.supplier || '—'}</td>
                  <td>{Number.isFinite(Number(d.cost)) ? <span className="price-accent">{formatCurrency(Number(d.cost), settings)}</span> : '—'}</td>
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
        <div className="pagination-row">
          <div className="pagination-controls">
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
            <span className="table-meta">Page {page} of {Math.max(1, Math.ceil(purchases.length / pageSize))}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(purchases.length / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(purchases.length / pageSize))}>Next</button>
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
      {auditDetail && (
        <Modal title="Purchase Record" onClose={() => setAuditDetail(null)}>
          <div className="detail-grid">
            <div className="detail-field"><div className="detail-label">Timestamp</div><div className="detail-value">{auditDetail.ts ? new Date(auditDetail.ts).toLocaleString() : '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Actor</div><div className="detail-value">{auditDetail.actor || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Product</div><div className="detail-value">{(auditDetail.details || {}).product || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Branch</div><div className="detail-value">{byId.get(auditDetail.branchId) || auditDetail.branchId || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Qty</div><div className="detail-value">{(auditDetail.details || {}).qty ?? '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Pack</div><div className="detail-value">{(auditDetail.details || {}).pack || 'Base Unit'}</div></div>
            <div className="detail-field"><div className="detail-label">Base Units</div><div className="detail-value">{(auditDetail.details || {}).baseUnits ?? '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Supplier</div><div className="detail-value">{(auditDetail.details || {}).supplier || '—'}</div></div>
            <div className="detail-field"><div className="detail-label">Cost</div><div className="detail-value">{Number.isFinite(Number((auditDetail.details || {}).cost)) ? <span className="price-accent">{formatCurrency(Number((auditDetail.details || {}).cost), settings)}</span> : '—'}</div></div>
            <div className="detail-field detail-field-full"><div className="detail-label">Remark</div><div className="detail-value">{auditDetail.remark || '—'}</div></div>
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
