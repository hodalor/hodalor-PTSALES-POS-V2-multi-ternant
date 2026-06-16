import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import { formatCurrency } from '../utils/currency';
import * as wholesaleApi from '../api/wholesale';
import * as transfersApi from '../api/transfers';
import * as productUnitsApi from '../api/productUnits';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import Modal from '../components/Modal';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import ProductLiveSearchField from '../components/ProductLiveSearchField';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import { ensureSupplierByName } from '../utils/suppliers';
import LoadingDots from '../components/LoadingDots';
import { useAppLanguage } from '../utils/localization';
import { formatDateTime, getOperationSearchValues, getProductDisplayMeta, matchesDateField, matchesFilterText } from '../utils/inventoryFilters';

function labelForArea(area, op, t) {
  const prefix = String(area || 'wholesale').toLowerCase() === 'warehouse' ? t('Warehouse') : t('Distribution');
  const suffix = op === 'purchase' ? t('Purchase') : op === 'transfer' ? t('Transfer') : op === 'adjustment' ? t('Adjustment') : t('Refund');
  return `${prefix} ${suffix}`;
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

function WholesaleOperationsPage({ operationType, operationArea = 'wholesale' }) {
  const { t } = useAppLanguage();
  const toast = useToast();
  const dispatch = useDispatch();
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const suppliers = useSelector(s => s.suppliers?.suppliers || []);
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
  const allowedBranchIds = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return null;
    return new Set(Array.isArray(assigned) ? assigned : [assigned]);
  }, [assigned, roleLower]);
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
  const branchTypeById = useMemo(() => {
    const map = new Map();
    branches.forEach(branch => map.set(String(branch.id), String(branch.branchType || 'retail').toLowerCase()));
    return map;
  }, [branches]);
  const inventoryTypeForBranch = useCallback((targetBranchId) => {
    const kind = String(branchTypeById.get(String(targetBranchId || '')) || 'retail').toLowerCase();
    return kind === 'warehouse' ? 'warehouse' : kind === 'wholesale' ? 'wholesale' : 'retail';
  }, [branchTypeById]);

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
  const [trackingQuery, setTrackingQuery] = useState('');
  const [trackingDateField, setTrackingDateField] = useState('created');
  const [trackingDateFrom, setTrackingDateFrom] = useState('');
  const [trackingDateTo, setTrackingDateTo] = useState('');

  const [productId, setProductId] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [variantId, setVariantId] = useState('');
  const [branchId, setBranchId] = useState(currentBranchId || scopedBranchOptions[0]?.id || branchOptions[0]?.id || '');
  const [fromBranchId, setFromBranchId] = useState(currentBranchId || scopedBranchOptions[0]?.id || branchOptions[0]?.id || '');
  const [toBranchId, setToBranchId] = useState(branchOptions.find(branch => String(branch.id) !== String(currentBranchId || ''))?.id || branchOptions[0]?.id || '');
  const [qty, setQty] = useState(1);
  const [cost, setCost] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [adjustmentType, setAdjustmentType] = useState('increase');
  const [supplier, setSupplier] = useState('');
  const [transactionTitle, setTransactionTitle] = useState('');
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');

  const selectedProduct = useMemo(() => products.find(product => String(product.id) === String(productId)) || null, [productId, products]);
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
  const selectedVariant = useMemo(() => {
    if (!selectedProduct || !variantId) return null;
    return (selectedProduct.variants || []).find(v => String(v.id) === String(variantId)) || null;
  }, [selectedProduct, variantId]);
  const selectedTrackType = String(selectedVariant?.trackType || selectedProduct?.trackType || 'quantity');
  useEffect(() => {
    if (operationType === 'refund') return;
    if (!selectedProduct) {
      setCost('');
      return;
    }
    const nextCost = Number(selectedProduct.costPrice || 0);
    setCost(Number.isFinite(nextCost) ? String(nextCost) : '');
  }, [operationType, productId, variantId, selectedProduct]);
  const grants = useMemo(() => (Array.isArray(auth.grants) ? auth.grants : []), [auth.grants]);
  const canDirectorApprove = roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'director'
    || (normalizedArea === 'warehouse' ? grants.includes('approve_warehouse_director') : grants.includes('approve_distribution_director'))
    || grants.includes('approve_credit_director');
  const canManagerApprove = roleLower === 'superadmin' || roleLower === 'admin' || roleLower === 'manager'
    || (normalizedArea === 'warehouse' ? grants.includes('approve_warehouse_manager') : grants.includes('approve_distribution_manager'))
    || grants.includes('approve_credit_manager');
  const canViewCost = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_profit') || grants.includes('view_financials');
  const canCreateRequest = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin') return true;
    if (operationType === 'transfer') {
      return normalizedArea === 'warehouse' ? grants.includes('add_warehouse_transfers') : grants.includes('add_wholesale_transfers');
    }
    if (operationType === 'purchase') {
      return normalizedArea === 'warehouse' ? grants.includes('add_warehouse_purchases') : grants.includes('add_wholesale_purchases');
    }
    if (operationType === 'adjustment') {
      return normalizedArea === 'warehouse' ? grants.includes('add_warehouse_adjustments') : grants.includes('add_wholesale_adjustments');
    }
    if (operationType === 'refund') return grants.includes('add_distribution_refunds');
    return false;
  }, [grants, normalizedArea, operationType, roleLower]);
  const defaultBranchIdRef = useRef(currentBranchId || scopedBranchOptions[0]?.id || branchOptions[0]?.id || '');
  const defaultTransferToBranchIdRef = useRef(branchOptions.find(branch => String(branch.id) !== String(currentBranchId || scopedBranchOptions[0]?.id || ''))?.id || branchOptions[0]?.id || '');
  const serializedScanInputRef = useRef(null);
  const transferFromBranchOptions = useMemo(
    () => scopedBranchOptions,
    [scopedBranchOptions]
  );
  const transferToBranchOptions = useMemo(
    () => branchOptions.filter(branch => String(branch.id) !== String(fromBranchId || '')),
    [branchOptions, fromBranchId]
  );
  const serializedEntries = useMemo(() => String(serializedEntriesText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/[,\t|]/).map(part => part.trim()).filter(Boolean);
    return { imei: parts[0] || '', serialNumber: parts[1] || parts[0] || '' };
  }), [serializedEntriesText]);
  const usesSerializedSelection = selectedTrackType === 'serialized' && (operationType === 'transfer' || (operationType === 'adjustment' && adjustmentType === 'decrease'));

  useEffect(() => {
    if (!isCreateOpen) return;
    setProductId('');
    setProductQuery('');
    setVariantId('');
    setTransactionTitle('');
  }, [isCreateOpen]);

  useEffect(() => {
    if (selectedTrackType === 'serialized' && !usesSerializedSelection) {
      setQty(Math.max(0, serializedEntries.length));
    }
  }, [selectedTrackType, serializedEntries.length, usesSerializedSelection]);

  useEffect(() => {
    defaultBranchIdRef.current = currentBranchId || scopedBranchOptions[0]?.id || branchOptions[0]?.id || '';
    defaultTransferToBranchIdRef.current = branchOptions.find(branch => String(branch.id) !== String(currentBranchId || scopedBranchOptions[0]?.id || ''))?.id || branchOptions[0]?.id || '';
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
    if (!fromBranchId && (currentBranchId || scopedBranchOptions[0]?.id)) {
      setFromBranchId(currentBranchId || scopedBranchOptions[0]?.id || '');
    }
    if (!toBranchId && branchOptions[0]?.id) {
      setToBranchId(branchOptions.find(branch => String(branch.id) !== String(fromBranchId || currentBranchId || branchOptions[0]?.id || ''))?.id || branchOptions[0]?.id || '');
    }
  }, [branchId, branchOptions, currentBranchId, fromBranchId, scopedBranchOptions, toBranchId]);

  useEffect(() => {
    setVariantId('');
    setCost('');
    setRequestedAmount('');
    setAdjustmentType('increase');
    setSupplier('');
    setTransactionTitle('');
    setReason('');
    setRemark('');
    if (operationType === 'transfer') {
      setFromBranchId(defaultBranchIdRef.current);
      setToBranchId(defaultTransferToBranchIdRef.current);
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
          inventoryType: operationType === 'transfer' ? inventoryTypeForBranch(fromBranchId) : normalizedArea,
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
  }, [adjustmentType, branchId, fromBranchId, inventoryTypeForBranch, normalizedArea, operationType, productId, selectedTrackType, serializedUnitsQuery, toast, variantId, t]);

  const loadOperations = useCallback(async (options = {}) => {
    if (operations.length === 0) setLoading(true);
    try {
      const workflowResult = await wholesaleApi.listOperations({
        operationType,
        status: statusFilter,
        operationArea: normalizedArea,
        force: !!options.force
      });
      const workflowRows = Array.isArray(workflowResult)
        ? workflowResult
        : (Array.isArray(workflowResult?.rows) ? workflowResult.rows : []);
      if (operationType === 'transfer') {
        const retailTransferRows = await transfersApi.listRequests({ status: statusFilter, limit: 500 });
        const inboundRetailTransfers = (Array.isArray(retailTransferRows) ? retailTransferRows : [])
          .filter((row) => {
            const fromInventory = inventoryTypeForBranch(row.from || row.fromBranchId);
            const toInventory = inventoryTypeForBranch(row.to || row.toBranchId);
            return fromInventory === normalizedArea || toInventory === normalizedArea;
          })
          .map((row) => ({
            ...row,
            approvalMode: 'legacy_transfer',
            operationType: 'transfer',
            fromBranchId: row.from,
            toBranchId: row.to,
            fromInventoryType: inventoryTypeForBranch(row.from),
            toInventoryType: inventoryTypeForBranch(row.to),
            initiatedByName: row.initiatorName || row.initiatedByName || '',
            initiatedByRole: row.initiatorRole || row.initiatedByRole || '',
            cost: 0,
            requestedAmount: 0
          }));
        const combined = [...workflowRows, ...inboundRetailTransfers]
          .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
        setOperations(combined);
        setTotal(combined.length);
      } else {
        const scopedRows = workflowRows.filter((row) => {
          if (operationType === 'purchase' || operationType === 'adjustment' || operationType === 'refund') {
            return String(row.operationArea || normalizedArea).toLowerCase() === normalizedArea;
          }
          return true;
        });
        setOperations(scopedRows);
        setTotal(scopedRows.length);
      }
    } catch (e) {
      const msg = String(e?.message || '');
      if (!/404|not found/i.test(msg)) {
        toast.show(msg || t('Failed to load wholesale operations'), { type: 'error' });
      }
      setOperations([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [inventoryTypeForBranch, normalizedArea, operationType, operations.length, statusFilter, toast, t]);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);
  useEffect(() => {
    setPage(1);
  }, [normalizedArea, operationType, statusFilter]);

  const filteredOperations = useMemo(() => {
    return operations.filter((row) => {
      if (!matchesFilterText(getOperationSearchValues(row, products, branchNameById), trackingQuery)) {
        return false;
      }
      return matchesDateField(row, trackingDateField, trackingDateFrom, trackingDateTo);
    });
  }, [branchNameById, operations, products, trackingDateField, trackingDateFrom, trackingDateTo, trackingQuery]);

  useEffect(() => {
    setPage(1);
  }, [trackingQuery, trackingDateField, trackingDateFrom, trackingDateTo]);

  const totalPages = Math.max(1, Math.ceil(filteredOperations.length / pageSize));
  const pageRows = useMemo(
    () => filteredOperations.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    [filteredOperations, page, pageSize]
  );

  function resetForm() {
    setProductId('');
    setProductQuery('');
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

  function maskCostValue(value) {
    return canViewCost ? formatCurrency(Number(value || 0), settings) : '****';
  }

  function appendSerializedEntry(value) {
    const text = String(value || '').trim();
    if (!text) return;
    const nextLines = String(serializedEntriesText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (nextLines.some(line => {
      const first = line.split(/[,\t|]/).map(part => part.trim()).filter(Boolean)[0] || '';
      return first === text;
    })) {
      toast.show(t('This IMEI is already in the entry list'), { type: 'error' });
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

  const hasManagerTransferReviewChanges = useMemo(() => {
    if (!selectedRow) return false;
    if (String(selectedRow.approvalMode || '').toLowerCase() !== 'workflow') return false;
    if (String(selectedRow.operationType || '').toLowerCase() !== 'transfer') return false;
    if (String(selectedRow.status || '').toLowerCase() !== 'pending_manager') return false;
    const originalSource = Array.isArray(selectedRow.items) && selectedRow.items.length > 0
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
    const original = normalizeReviewItemsForCompare(originalSource);
    const reviewed = normalizeReviewItemsForCompare(reviewItems);
    return JSON.stringify(original) !== JSON.stringify(reviewed);
  }, [reviewItems, selectedRow]);

  const canActOnSelectedRow = useMemo(() => {
    if (!selectedRow) return false;
    if (String(selectedRow.approvalMode || '').toLowerCase() === 'workflow') {
      return (selectedRow.status === 'pending_director' && canDirectorApprove) || (selectedRow.status === 'pending_manager' && canManagerApprove);
    }
    const sourceBranch = String(selectedRow.from || selectedRow.fromBranchId || '');
    const destinationBranch = String(selectedRow.to || selectedRow.toBranchId || '');
    const canSeeDirectorStage = !allowedBranchIds || allowedBranchIds.has(sourceBranch) || allowedBranchIds.has(destinationBranch);
    const canSeeManagerStage = !allowedBranchIds || allowedBranchIds.has(destinationBranch);
    if (selectedRow.status === 'pending_director' || selectedRow.status === 'pending_approval') {
      return canDirectorApprove && canSeeDirectorStage;
    }
    if (selectedRow.status === 'pending_manager') {
      return canManagerApprove && canSeeManagerStage;
    }
    return false;
  }, [allowedBranchIds, canDirectorApprove, canManagerApprove, selectedRow]);

  async function reviewAction(type) {
    if (!selectedRow || reviewing) return;
    const remark = String(decisionRemark || '').trim();
    if (!remark) {
      toast.show(type === 'approve' ? t('Approval remark is required') : t('Rejection remark is required'), { type: 'error' });
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
      const reviewedPayloadItems = reviewItems.map(item => ({ ...item, status: normalizeReviewStatus(item.status) }));
      let response = null;
      if (String(selectedRow.approvalMode || '').toLowerCase() === 'workflow') {
        if (type === 'approve') {
          response = await wholesaleApi.approveOperation(selectedRow, {
            ...payload,
            items: reviewedPayloadItems,
            resubmitToDirector: hasManagerTransferReviewChanges
          });
        } else {
          await wholesaleApi.rejectOperation(selectedRow, payload);
        }
      } else if (type === 'approve') {
        response = await transfersApi.approve({
          id: selectedRow._id || selectedRow.clientId,
          ...payload,
          items: reviewedPayloadItems
        });
      } else {
        await transfersApi.reject({
          id: selectedRow._id || selectedRow.clientId,
          ...payload
        });
      }
      const nextStatus = String(response?.status || '').toLowerCase();
      if (type === 'approve') {
        if (String(selectedRow.approvalMode || '').toLowerCase() !== 'workflow') {
          if (nextStatus === 'pending_manager') {
            toast.show(t('Director approval recorded. Waiting for destination branch manager approval.'), { type: 'success' });
          } else {
            toast.show(t('Transfer approved and stock updated'), { type: 'success' });
          }
        } else if (nextStatus === 'pending_director') {
          toast.show(t('Transfer changes resubmitted for director approval'), { type: 'success' });
        } else if (nextStatus === 'pending_manager') {
          toast.show(t('Director approval recorded. Waiting for manager approval.'), { type: 'success' });
        } else {
          toast.show(t('Request updated'), { type: 'success' });
        }
      } else {
        toast.show(t('Request rejected'), { type: 'success' });
      }
      setOperations(prev => prev.filter(item => String(item._id || item.clientId) !== String(selectedRow._id || selectedRow.clientId)));
      setSelectedRow(null);
      setDecisionRemark('');
      void loadOperations({ force: true });
      if (type === 'approve' && nextStatus === 'approved') {
        void refreshAffectedProducts(dispatch, affectedProductIds);
      }
    } catch (e) {
      const msg = String(e?.message || '');
      if (/404|not found/i.test(msg)) {
        void loadOperations({ force: true });
        setSelectedRow(null);
        setDecisionRemark('');
        toast.show(t('Request was already processed. List refreshed.'), { type: 'warning' });
      } else {
        toast.show(msg || t(`Failed to ${type} request`), { type: 'error' });
      }
    } finally {
      setReviewing(false);
    }
  }

  function addCurrentItem() {
    if (!productId) {
      toast.show(t('Select a product'), { type: 'error' });
      return;
    }
    if (!Number.isFinite(Number(qty)) || Number(qty) <= 0) {
      toast.show(t('Quantity must be greater than zero'), { type: 'error' });
      return;
    }
    if (usesSerializedSelection && serializedUnits.filter(unit => unit.selected).length !== Number(qty)) {
      toast.show(operationType === 'transfer' ? t('Select the exact serialized units to transfer') : t('Select the exact serialized units to remove'), { type: 'error' });
      return;
    }
    if (selectedTrackType === 'serialized' && !usesSerializedSelection && serializedEntries.length !== Number(qty)) {
      toast.show(t('Enter the exact serialized units to add'), { type: 'error' });
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
      toast.show(t('Select a product'), { type: 'error' });
      return;
    }
    if (!nextItems && (!Number.isFinite(Number(qty)) || Number(qty) <= 0)) {
      toast.show(t('Quantity must be greater than zero'), { type: 'error' });
      return;
    }
    if (!nextItems && !reason.trim()) {
      toast.show(t('Reason is required'), { type: 'error' });
      return;
    }
    if (operationType === 'transfer') {
      if (!fromBranchId || !toBranchId) {
        toast.show(t('Select both source and destination branches'), { type: 'error' });
        return;
      }
      if (fromBranchId === toBranchId) {
        toast.show(t('Source and destination branches must be different'), { type: 'error' });
        return;
      }
      if (!nextItems && usesSerializedSelection && serializedUnits.filter(unit => unit.selected).length !== Number(qty)) {
        toast.show(operationType === 'transfer' ? t('Select the exact serialized units to transfer') : t('Select the exact serialized units to remove'), { type: 'error' });
        return;
      }
    } else if (!branchId) {
      toast.show(t('Select a branch'), { type: 'error' });
      return;
    }
    if (!nextItems && selectedTrackType === 'serialized' && !usesSerializedSelection && serializedEntries.length !== Number(qty)) {
      toast.show(t('Enter the exact serialized units to add'), { type: 'error' });
      return;
    }

    let supplierName = supplier.trim();
    if (operationType === 'purchase' && supplierName) {
      try {
        const ensuredSupplier = await ensureSupplierByName({ name: supplierName, suppliers, dispatch, offlineBackupAllowed });
        supplierName = ensuredSupplier?.name || supplierName;
      } catch (e) {
        toast.show(String(e?.message || t('Failed to save supplier')), { type: 'error' });
        return;
      }
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
      supplier: supplierName,
      transactionTitle: transactionTitle.trim() || '',
      reason: reason.trim(),
      remark: remark.trim(),
      branchId: operationType === 'transfer' ? undefined : branchId,
      fromBranchId: operationType === 'transfer' ? fromBranchId : undefined,
      toBranchId: operationType === 'transfer' ? toBranchId : undefined,
      fromInventoryType: operationType === 'transfer' ? inventoryTypeForBranch(fromBranchId) : normalizedArea,
      toInventoryType: operationType === 'transfer' ? inventoryTypeForBranch(toBranchId) : normalizedArea,
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
        toast.show(t('Offline: connect internet and try again.'), { type: 'error' });
        setSaving(false);
        return;
      }
      try {
        await enqueueHttp({ collection: 'wholesaleoperations', label: `${t('Wholesale')} ${t(operationType === 'purchase' ? 'Purchase' : operationType === 'transfer' ? 'Transfer' : operationType === 'adjustment' ? 'Adjustment' : 'Refund')}`, path: '/api/wholesale/operations', method: 'POST', body: payload });
        setOperations(prev => [optimistic, ...prev]);
        resetForm();
        setIsCreateOpen(false);
        toast.show(t('Saved offline. Will sync when online.'), { type: 'success' });
      } catch (e) {
        toast.show(String(e?.message || t('Failed to save offline')), { type: 'error' });
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
      toast.show(`${normalizedArea === 'warehouse' ? t('Warehouse') : t('Distribution')} ${t('request submitted for director approval')}`, { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || t('Failed to submit wholesale request')), { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>{normalizedArea === 'warehouse' ? t('Warehouse Operations') : t('Distribution Operations')}</h1>
          <div className="page-subtitle-compact">
            {normalizedArea === 'warehouse'
              ? t('Initiate warehouse purchases, transfers, adjustments, and refund restocks through the 2-step approval workflow.')
              : t('Initiate distribution purchases, transfers, adjustments, and refund restocks through the 2-step approval workflow.')}
          </div>
        </div>
        <div className="page-header-actions">
          <OfflineQueueIndicator collection="wholesaleoperations" label={`${normalizedArea === 'warehouse' ? t('Warehouse') : t('Distribution')} ${t('queued')}`} />
          <button className="btn btn-primary" onClick={() => setIsCreateOpen(true)} disabled={!canCreateRequest}>
            {t('New Request')}
          </button>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>{labelForArea(normalizedArea, operationType, t)}</h2>
        <div className="section-note">
          {operationType === 'purchase'
            ? (normalizedArea === 'warehouse' ? t('Open the request modal to initiate a new warehouse purchase and then track director and manager approvals below.') : t('Open the request modal to initiate a new distribution purchase and then track director and manager approvals below.'))
            : operationType === 'transfer'
              ? (normalizedArea === 'warehouse' ? t('Open the request modal to initiate a new warehouse transfer and then track director and manager approvals below.') : t('Open the request modal to initiate a new distribution transfer and then track director and manager approvals below.'))
              : operationType === 'adjustment'
                ? (normalizedArea === 'warehouse' ? t('Open the request modal to initiate a new warehouse adjustment and then track director and manager approvals below.') : t('Open the request modal to initiate a new distribution adjustment and then track director and manager approvals below.'))
                : t('Open the request modal to initiate a new request and then track director and manager approvals below.')}
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>{t('Request Tracking')}</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={statusFilter === 'pending_director' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_director')}>{t('Pending Director')}</button>
            <button className={statusFilter === 'pending_manager' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('pending_manager')}>{t('Pending Manager')}</button>
            <button className={statusFilter === 'approved' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('approved')}>{t('Approved')}</button>
            <button className={statusFilter === 'rejected' ? 'btn btn-primary' : 'btn'} onClick={() => setStatusFilter('rejected')}>{t('Rejected')}</button>
            <button className="btn" onClick={loadOperations} disabled={loading}>{loading ? t('Refreshing…') : t('Refresh')}</button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ color: '#64748b', fontSize: 13 }}>{t('Showing {shown} of {total} requests', { shown: filteredOperations.length, total })}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={loading || page <= 1}>{t('Previous')}</button>
            <button className="btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={loading || page >= totalPages}>{t('Next')}</button>
          </div>
        </div>

        <div className="record-filters">
          <label>
            <div className="field-label">{t('Search Product')}</div>
            <input className="input" value={trackingQuery} onChange={e => setTrackingQuery(e.target.value)} placeholder={t('Search product, title, branch, supplier, or remark')} />
          </label>
          <label>
            <div className="field-label">{t('Date Type')}</div>
            <select className="select" value={trackingDateField} onChange={e => setTrackingDateField(e.target.value)}>
              <option value="created">{t('Initiated Date')}</option>
              <option value="director">{t('Director Approval Date')}</option>
              <option value="manager">{t('Manager Approval Date')}</option>
              <option value="decision">{t('Final Decision Date')}</option>
            </select>
          </label>
          <label>
            <div className="field-label">{t('From')}</div>
            <input className="input" type="date" value={trackingDateFrom} onChange={e => setTrackingDateFrom(e.target.value)} />
          </label>
          <label>
            <div className="field-label">{t('To')}</div>
            <input className="input" type="date" value={trackingDateTo} onChange={e => setTrackingDateTo(e.target.value)} />
          </label>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th align="left">{t('Product')}</th>
                <th align="left">{t('Route')}</th>
                <th align="left">{t('Qty')}</th>
                <th align="left">{t('Value')}</th>
                <th align="left">{t('Status')}</th>
                <th align="left">{t('Initiator')}</th>
                <th align="left">{t('Initiated Date')}</th>
                <th align="left">{t('Director Approval Date')}</th>
                <th align="left">{t('Manager Approval Date')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && filteredOperations.length === 0 && <tr><td colSpan="9" style={{ padding: 12, color: '#64748b' }}><LoadingDots label={t('Loading wholesale operations')} /></td></tr>}
              {!loading && pageRows.map(row => {
                const meta = getProductDisplayMeta(products, row.productId, row.variantId, row);
                const route = row.operationType === 'transfer'
                  ? `${branchNameById.get(row.fromBranchId || row.from) || row.fromBranchId || row.from || '—'} ${t(String(row.fromInventoryType || 'retail'))} → ${branchNameById.get(row.toBranchId || row.to) || row.toBranchId || row.to || '—'} ${t(String(row.toInventoryType || 'retail'))}`
                  : `${branchNameById.get(row.branchId) || row.branchId || '—'} • ${t(String(row.toInventoryType || row.fromInventoryType || 'wholesale'))}`;
                const value = row.operationType === 'refund' ? Number(row.requestedAmount || 0) : Number(row.cost || 0);
                const title = String(row.transactionTitle || '').trim() || (Array.isArray(row.items) && row.items.length > 1 ? `${meta.productName || row.productId} +${row.items.length - 1} ${t('more')}` : (meta.productName || row.productId));
                const rowCanAct = String(row.approvalMode || '').toLowerCase() === 'workflow'
                  ? ((String(row.status || '') === 'pending_director' && canDirectorApprove) || (String(row.status || '') === 'pending_manager' && canManagerApprove))
                  : (((String(row.status || '') === 'pending_director' || String(row.status || '') === 'pending_approval') && canDirectorApprove && (!allowedBranchIds || allowedBranchIds.has(String(row.from || row.fromBranchId || '')) || allowedBranchIds.has(String(row.to || row.toBranchId || ''))))
                    || (String(row.status || '') === 'pending_manager' && canManagerApprove && (!allowedBranchIds || allowedBranchIds.has(String(row.to || row.toBranchId || '')))));
                return (
                  <tr key={row._id || row.clientId} onClick={() => openReview(row)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div>{title}</div>
                      {meta.secondaryLabel ? <div style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>{meta.secondaryLabel}</div> : null}
                    </td>
                    <td>{route}</td>
                    <td>{Number(row.qty || 0)}</td>
                    <td>{value > 0 ? maskCostValue(value) : '—'}</td>
                    <td>{rowCanAct ? row.status : `${row.status} • ${t('Tracking')}`}</td>
                    <td>{row.initiatedByName || '—'} {row.initiatedByRole ? `(${row.initiatedByRole})` : ''}</td>
                    <td>{formatDateTime(row.createdAt || row.created_at)}</td>
                    <td>{formatDateTime(row.directorApproved_at || row.directorApprovedAt)}</td>
                    <td>{formatDateTime(row.managerApproved_at || row.managerApprovedAt)}</td>
                  </tr>
                );
              })}
              {!loading && filteredOperations.length === 0 && <tr><td colSpan="9" style={{ padding: 12, color: '#64748b' }}>{normalizedArea === 'warehouse' ? t('No warehouse requests yet') : t('No distribution requests yet')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {isCreateOpen && (
        <Modal
          title={labelForArea(normalizedArea, operationType, t) || t('Stock Request')}
          onClose={() => setIsCreateOpen(false)}
          footer={(
            <>
              <button className="btn" onClick={() => setIsCreateOpen(false)} disabled={saving}>{t('Close')}</button>
              <button className="btn" onClick={addCurrentItem} disabled={saving || !canCreateRequest}>{t('Add To List')}</button>
              <button className="btn btn-primary" onClick={submit} disabled={saving || !canCreateRequest}>
                {saving ? t('Saving…') : t('Submit For Approval')}
              </button>
            </>
          )}
        >
          {selectedProduct && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              <div>
                {t('Retail')}: <strong>{formatCurrency(Number((selectedVariant || selectedProduct).retailPrice || selectedProduct.retailPrice || selectedProduct.price || 0), settings)}</strong>
              </div>
              <div>
                {t('Distribution')}: <strong>{formatCurrency(Number((selectedVariant || selectedProduct).wholesalePrice || selectedProduct.wholesalePrice || selectedProduct.price || 0), settings)}</strong>
              </div>
              <div>
                {t('Agent')}: <strong>{formatCurrency(Number((selectedVariant || selectedProduct).agentPrice || selectedProduct.agentPrice || selectedProduct.price || 0), settings)}</strong>
              </div>
            </div>
          )}
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

            {(selectedProduct?.variants || []).length > 0 ? (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Variant')}</div>
                <select className="select" value={variantId} onChange={e => setVariantId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">{t('Base')}</option>
                  {(selectedProduct?.variants || []).map(variant => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
                </select>
              </label>
            ) : null}

            {operationType === 'transfer' ? (
              <>
                <label>
                  <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('From Branch')}</div>
                  <select className="select" value={fromBranchId} onChange={e => setFromBranchId(e.target.value)} style={{ width: '100%' }}>
                    {transferFromBranchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <label>
                  <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('To Branch')}</div>
                  <select className="select" value={toBranchId} onChange={e => setToBranchId(e.target.value)} style={{ width: '100%' }}>
                    {transferToBranchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Branch')}</div>
                <select className="select" value={branchId} onChange={e => setBranchId(e.target.value)} style={{ width: '100%' }}>
                  {scopedBranchOptions.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
            )}

            <label>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Quantity')}</div>
              <input className="input" type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} disabled={selectedTrackType === 'serialized'} />
            </label>

            {usesSerializedSelection && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <div style={{ color: '#94a3b8' }}>{t('Serialized Units')}</div>
                <input className="input" placeholder={t('Search IMEI or serial number')} value={serializedUnitsQuery} onChange={e => setSerializedUnitsQuery(e.target.value)} />
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  {t('Selected: {count}', { count: serializedUnits.filter(unit => unit.selected).length })}
                </div>
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

            {selectedTrackType === 'serialized' && !usesSerializedSelection && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <div style={{ color: '#94a3b8' }}>{t('IMEI / Serial Numbers')}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                  style={{ color: '#111827', background: '#ffffff' }}
                />
                <textarea className="input" rows={6} value={serializedEntriesText} onChange={e => setSerializedEntriesText(e.target.value)} placeholder={t('One per line\nIMEI123456789\nIMEI987654321,SN-0002')} style={{ color: '#111827', background: '#ffffff' }} />
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  {t('Quantity updates automatically from scanned/entered IMEI values. Current entries: {count}', { count: serializedEntries.length })}
                </div>
              </div>
            )}

            {operationType === 'adjustment' ? (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Adjustment Type')}</div>
                <select className="select" value={adjustmentType} onChange={e => setAdjustmentType(e.target.value)} style={{ width: '100%' }}>
                  <option value="increase">{t('Increase')}</option>
                  <option value="decrease">{t('Decrease')}</option>
                </select>
              </label>
            ) : (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>{operationType === 'refund' ? t('Refund Amount') : t('Cost')}</div>
                <input
                  className="input"
                  type={canViewCost ? 'number' : 'text'}
                  min={canViewCost ? '0' : undefined}
                  step={canViewCost ? '0.01' : undefined}
                  value={canViewCost ? (operationType === 'refund' ? requestedAmount : cost) : '****'}
                  onChange={e => {
                    if (!canViewCost) return;
                    if (operationType === 'refund') setRequestedAmount(e.target.value);
                    else setCost(e.target.value);
                  }}
                  readOnly={!canViewCost}
                  disabled={!canViewCost}
                />
              </label>
            )}

            {(operationType === 'purchase' || operationType === 'refund') && (
              <label>
                <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Supplier')}</div>
                <input className="input" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder={t('Supplier or source')} list="suppliers-list" />
                <SuppliersDatalist />
              </label>
            )}

            <label style={{ gridColumn: '1 / -1' }}>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Transaction Title')}</div>
              <input className="input" value={transactionTitle} onChange={e => setTransactionTitle(e.target.value)} placeholder={operationType === 'purchase' ? t('Optional purchase title for grouped items') : operationType === 'transfer' ? t('Optional transfer title for grouped items') : operationType === 'adjustment' ? t('Optional adjustment title for grouped items') : t('Optional refund title for grouped items')} />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Reason')}</div>
              <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder={normalizedArea === 'warehouse' ? t('Why this warehouse operation is needed') : t('Why this distribution operation is needed')} />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Remark')}</div>
              <input className="input" value={remark} onChange={e => setRemark(e.target.value)} placeholder={t('Additional details for approvers')} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Items In This Request')}</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">{t('Product')}</th>
                    <th align="left">{t('Qty')}</th>
                    <th align="left">{t('Units')}</th>
                    <th align="left">{t('Remark')}</th>
                    <th align="left"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const meta = getProductDisplayMeta(products, item.productId, item.variantId, item);
                    return (
                      <tr key={item.lineId}>
                        <td>
                          <div style={{ color: '#111827' }}>{meta.productName || item.productId}</div>
                          {meta.secondaryLabel ? <div style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>{meta.secondaryLabel}</div> : null}
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
                        <td><button className="btn" onClick={() => removeItem(item.lineId)}>{t('Remove')}</button></td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>{t('No items added yet. You can still submit a single item directly.')}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
      <BarcodeScannerModal
        title={t('Scan IMEI Barcode')}
        open={serializedCameraOpen}
        onClose={() => setSerializedCameraOpen(false)}
        onDetected={(value) => {
          appendSerializedEntry(value);
          setSerializedCameraOpen(false);
        }}
      />

      {selectedRow && (
        <Modal
          title={t('Request Review')}
          onClose={() => { if (!reviewing) { setSelectedRow(null); setDecisionRemark(''); } }}
          footer={(
            <>
              <button className="btn" onClick={() => { setSelectedRow(null); setDecisionRemark(''); }} disabled={reviewing}>{t('Close')}</button>
              {canActOnSelectedRow && (
                <>
                  <button className="btn" onClick={() => reviewAction('reject')} disabled={reviewing}>{reviewing ? t('Working…') : t('Reject')}</button>
                  <button className="btn btn-primary" onClick={() => reviewAction('approve')} disabled={reviewing}>{reviewing ? t('Working…') : (String(selectedRow.approvalMode || '').toLowerCase() === 'workflow' && hasManagerTransferReviewChanges) ? t('Resubmit') : t('Approve')}</button>
                </>
              )}
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Status')}</div><strong>{selectedRow.status}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Title')}</div><strong>{selectedRow.transactionTitle || '—'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Initiator')}</div><strong>{selectedRow.initiatedByName || selectedRow.initiatorName || '—'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Quantity')}</div><strong>{Number(selectedRow.qty || selectedRow.baseUnits || 0)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Value')}</div><strong>{maskCostValue(selectedRow.cost || selectedRow.requestedAmount || 0)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Source')}</div><strong>{branchNameById.get(selectedRow.fromBranchId || selectedRow.from || selectedRow.branchId) || selectedRow.fromBranchId || selectedRow.from || selectedRow.branchId || '—'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Destination')}</div><strong>{branchNameById.get(selectedRow.toBranchId || selectedRow.to) || selectedRow.toBranchId || selectedRow.to || '—'}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('From Inventory')}</div><strong>{t(selectedRow.fromInventoryType || 'retail')}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('To Inventory')}</div><strong>{t(selectedRow.toInventoryType || selectedRow.fromInventoryType || 'wholesale')}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Initiated Date')}</div><strong>{formatDateTime(selectedRow.createdAt || selectedRow.created_at)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Director Approval Date')}</div><strong>{formatDateTime(selectedRow.directorApproved_at || selectedRow.directorApprovedAt)}</strong></div>
              <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Manager Approval Date')}</div><strong>{formatDateTime(selectedRow.managerApproved_at || selectedRow.managerApprovedAt)}</strong></div>
            </div>
            <div><div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Remark')}</div><strong>{selectedRow.remark || selectedRow.approvalRemark || selectedRow.rejectionRemark || '—'}</strong></div>
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
                    const meta = getProductDisplayMeta(products, item.productId, item.variantId, item);
                    return (
                      <tr key={item.lineId || index}>
                        <td>
                          <div style={{ color: '#111827' }}>{meta.productName || item.productId}</div>
                          {meta.secondaryLabel ? <div style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>{meta.secondaryLabel}</div> : null}
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
                          <input className="input" type="number" min="0" value={item.qty} onChange={e => setReviewItems(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, qty: Number(e.target.value) || 0 } : row))} style={{ width: 90, color: '#111827' }} disabled={(Array.isArray(item.unitIds) && item.unitIds.length > 0) || (Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0) || !canActOnSelectedRow || reviewing} />
                        </td>
                        <td style={{ color: '#111827' }}>{Array.isArray(item.unitIds) && item.unitIds.length > 0 ? item.unitIds.length : (Array.isArray(item.serializedEntries) && item.serializedEntries.length > 0 ? item.serializedEntries.length : '—')}</td>
                        <td>
                          <select className="select" value={normalizeReviewStatus(item.status)} onChange={e => setReviewItems(prev => prev.map((row, rowIndex) => rowIndex === index ? { ...row, status: e.target.value } : row))} style={{ color: '#111827' }} disabled={!canActOnSelectedRow || reviewing}>
                            <option value="accepted">{t('Accepted')}</option>
                            <option value="cancelled">{t('Cancelled')}</option>
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
              <div style={{ marginBottom: 6, color: '#94a3b8' }}>{t('Approval / Rejection Remark')}</div>
              <textarea className="input" value={decisionRemark} onChange={e => setDecisionRemark(e.target.value)} rows={4} style={{ width: '100%', resize: 'vertical' }} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default WholesaleOperationsPage;

function SuppliersDatalist() {
  const list = useSelector(s => s.suppliers?.suppliers || []);
  return (
    <datalist id="suppliers-list">
      {list.map((supplier) => <option key={supplier.id || supplier._id || supplier.name} value={supplier.name} />)}
    </datalist>
  );
}
