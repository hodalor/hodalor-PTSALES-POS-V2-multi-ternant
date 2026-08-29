import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { addItem, removeItem, removeItemByUnitId, setQuantity, updateItemPricing, clearCart, setDiscount, addHeld, removeHeld, replaceCart, updateHeld, selectCartScope } from '../store/cartSlice';
import { adjustStock } from '../store/productsSlice';
import { recordSale } from '../store/salesSlice';
import { addInvoice } from '../store/invoicesSlice';
import { addCustomer, updateCustomer } from '../store/customersSlice';
import { buildBrandedReceiptHtml, printReceiptHtml } from '../utils/print';
import { escposReceipt, escposOpenDrawer, downloadText } from '../utils/escpos';
import { buildInvoiceA4Html, printInvoiceA4 } from '../utils/invoicePrint';
import { useToast } from '../components/ToastProvider';
import { formatCurrency } from '../utils/currency';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addAudit } from '../store/auditSlice';
import { setCurrentBranch } from '../store/settingsSlice';
import { productSpec } from '../utils/productSpec';
import { createSale } from '../api/sales';
import { cancelDiscountApproval, listDiscountApprovals, requestDiscountApproval } from '../api/discountApprovals';
import * as customersApi from '../api/customers';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import { confirmDialog, promptDialog } from '../utils/dialogs';
import { isFeatureEnabled } from '../utils/featureFlags';
import * as productUnitsApi from '../api/productUnits';
import Modal from '../components/Modal';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import FilterSearchSelect from '../components/FilterSearchSelect';
import { getAllowedPriceTiers, getDisplayPrice, getPreferredPriceTier, getPriceTierLabel } from '../utils/priceVisibility';
import InlineSpinner from '../components/InlineSpinner';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import { useAppLanguage } from '../utils/localization';
import { getBranchStock } from '../utils/branchStock';
import { filterBranchesByType, normalizeBranchType } from '../utils/branchTypes';
import { getProductBrand, getProductSearchText } from '../utils/productSearch';

function reportQueuedSalesImeiDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'queued-sales-imei',
      runId: 'pre-fix',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

function reportEbkTmpReceiptDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'ebk-tmp-receipt',
      runId: 'pre-fix',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

function reportQuantityQueueTamaleDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'quantity-queue-tamale',
      runId: 'pre-fix',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

function createReservationToken() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `RES-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getLocalSaleDateTimeParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return {
    date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  };
}

function buildSaleDateTimeValue(dateValue, timeValue) {
  const date = String(dateValue || '').trim();
  const time = String(timeValue || '').trim();
  if (!date) return new Date();
  const parsed = new Date(`${date}T${time || '00:00'}`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function buildCreditUpfrontTimeline(total, costTotal, upfrontAmount, paidAt) {
  const totalAmount = Math.max(0, Number(total || 0));
  const totalCost = Math.max(0, Number(costTotal || 0));
  const upfront = Math.max(0, Math.min(totalAmount, Number(upfrontAmount || 0)));
  const recognizedCost = Math.min(totalCost, upfront);
  const recognizedProfit = Math.max(0, upfront - totalCost);
  return [{
    source: 'credit_upfront',
    amount: upfront,
    principalAmount: upfront,
    penaltyAmount: 0,
    recognizedCost,
    recognizedProfit,
    paidAt
  }];
}

function getEffectiveTrackType(product) {
  return String(product?.trackType || 'quantity').trim().toLowerCase() === 'serialized'
    ? 'serialized'
    : 'quantity';
}

function PosPage({ mode = 'retail' }) {
  const dispatch = useDispatch();
  const location = useLocation();
  const modeLower = String(mode || '').toLowerCase();
  const isWholesale = modeLower === 'wholesale';
  const isWarehouse = modeLower === 'warehouse';
  const isNonRetail = isWholesale || isWarehouse;
  const inventoryType = isWholesale ? 'wholesale' : isWarehouse ? 'warehouse' : 'retail';
  const cartScope = inventoryType;
  const cart = useSelector(state => selectCartScope(state.cart, cartScope));
  const heldSales = useMemo(() => cart.heldSales || [], [cart.heldSales]);
  const products = useSelector(s => s.products.products);
  const customers = useSelector(s => s.customers.customers);
  const branches = useSelector(s => s.branches.branches);
  const branchId = useSelector(s => s.settings.currentBranchId);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const { t } = useAppLanguage();
  const creditModeLabel = isNonRetail ? t('Credit Sale') : t('Credit');
  const modeLabel = isWholesale ? t('Distribution POS') : isWarehouse ? t('Warehouse POS') : t('POS');
  const reservationStorageKey = `ptsales:pos-reservation-token:${modeLower || 'retail'}`;
  const initialPriceTier = isWholesale ? 'wholesale' : isWarehouse ? 'warehouse' : 'retail';
  const defaultCustomerType = isNonRetail ? 'distribution' : 'retail';
  const roleLower = String(auth.role || '').toLowerCase();
  const isFixedBranchUser = !['admin', 'manager', 'branch manager', 'superadmin'].includes(roleLower);
  const assignedBranchIds = useMemo(() => {
    const assignedRaw = auth.user?.assignedBranches;
    return assignedRaw === 'all'
      ? []
      : (Array.isArray(assignedRaw) ? assignedRaw : [assignedRaw]).map(v => String(v || '').trim()).filter(Boolean);
  }, [auth.user?.assignedBranches]);
  const scopedBranches = useMemo(
    () => filterBranchesByType(branches, inventoryType),
    [branches, inventoryType]
  );
  const activeBranchId = useMemo(() => {
    const preferredBranchId = isFixedBranchUser
      ? (String(auth.user?.branchId || '').trim() || assignedBranchIds[0] || branchId)
      : branchId;
    const currentBranch = (branches || []).find(branch => String(branch.id) === String(preferredBranchId));
    const expectedType = inventoryType;
    if (normalizeBranchType(currentBranch?.branchType) === expectedType) return preferredBranchId;
    const allowedIds = new Set((isFixedBranchUser ? [preferredBranchId, ...assignedBranchIds] : [preferredBranchId]).filter(Boolean).map(String));
    const fallback = scopedBranches.find(branch => {
      if (!isFixedBranchUser) return true;
      return allowedIds.has(String(branch.id));
    });
    return fallback?.id || '';
  }, [assignedBranchIds, auth.user?.branchId, branchId, branches, inventoryType, isFixedBranchUser, scopedBranches]);
  const activeBranch = useMemo(() => scopedBranches.find(branch => String(branch.id) === String(activeBranchId)) || null, [activeBranchId, scopedBranches]);
  const branchNameById = useMemo(() => new Map((branches || []).map(branch => [String(branch.id), branch.name])), [branches]);
  const stockBranchId = useMemo(() => String(activeBranchId || '').trim(), [activeBranchId]);
  const branchLabel = useMemo(() => activeBranch?.name || '', [activeBranch?.name]);
  const missingInventoryBranch = isNonRetail && !stockBranchId;
  const missingInventoryBranchText = useMemo(() => {
    if (!missingInventoryBranch) return '';
    return inventoryType === 'warehouse'
      ? t('No warehouse branch configured yet')
      : t('No distribution branch configured yet');
  }, [inventoryType, missingInventoryBranch, t]);
  const allowedPriceTiers = useMemo(() => getAllowedPriceTiers(auth), [auth]);
  const initialVisiblePriceTier = useMemo(() => getPreferredPriceTier(allowedPriceTiers, initialPriceTier), [allowedPriceTiers, initialPriceTier]);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [trackTypeFilter, setTrackTypeFilter] = useState('all');
  const [payments, setPayments] = useState([{ type: 'cash', amount: '' }]);
  const [view, setView] = useState('grid');
  const [selectedPriceTier, setSelectedPriceTier] = useState(initialVisiblePriceTier);
  const [easyBuyEnabled, setEasyBuyEnabled] = useState(false);
  const [easyBuyAmountPaidNow, setEasyBuyAmountPaidNow] = useState('');
  const [easyBuyDueDate, setEasyBuyDueDate] = useState('');
  const [selectedCreditPackageName, setSelectedCreditPackageName] = useState('');
  const [taxOverridePct, setTaxOverridePct] = useState('');
  const [taxOverrideRemark, setTaxOverrideRemark] = useState('');
  const [saleDate, setSaleDate] = useState(() => getLocalSaleDateTimeParts().date);
  const [saleTime, setSaleTime] = useState(() => getLocalSaleDateTimeParts().time);
  const [saleDateTimeTouched, setSaleDateTimeTouched] = useState(false);
  const [saleDateTimeEditing, setSaleDateTimeEditing] = useState(false);
  const [reservationToken, setReservationToken] = useState(() => {
    try {
      return localStorage.getItem(reservationStorageKey) || createReservationToken();
    } catch {
      return createReservationToken();
    }
  });
  const [serializedPickerProduct, setSerializedPickerProduct] = useState(null);
  const [serializedUnits, setSerializedUnits] = useState([]);
  const [serializedUnitsQuery, setSerializedUnitsQuery] = useState('');
  const [serializedLoading, setSerializedLoading] = useState(false);
  const [serializedUnitsPage, setSerializedUnitsPage] = useState(1);
  const [serializedUnitsPageSize, setSerializedUnitsPageSize] = useState(25);
  const [serializedUnitsTotal, setSerializedUnitsTotal] = useState(0);
  const [serializedScanInput, setSerializedScanInput] = useState('');
  const [serializedCameraOpen, setSerializedCameraOpen] = useState(false);
  const [reservingSerializedKeys, setReservingSerializedKeys] = useState([]);
  const [liveSerializedUnits, setLiveSerializedUnits] = useState([]);
  const [liveSerializedLoading, setLiveSerializedLoading] = useState(false);
  const [deletingHeldId, setDeletingHeldId] = useState('');
  const serializedScanInputRef = useRef(null);
  const serializedLoadSeqRef = useRef(0);
  const serializedPickerKeyRef = useRef('');
  const liveSerializedSearchSeqRef = useRef(0);
  const preloadedInvoiceRef = useRef('');
  const completeSaleLockRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [quickCustomerForm, setQuickCustomerForm] = useState({ name: '', phone: '', address: '', customerType: defaultCustomerType });
  const [redeemPoints, setRedeemPoints] = useState('');
  const [heldOpen, setHeldOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountRequests, setDiscountRequests] = useState([]);
  const [discountLoading, setDiscountLoading] = useState(false);
  const [discountWorkingId, setDiscountWorkingId] = useState('');
  const [heldSort, setHeldSort] = useState(() => {
    try { return localStorage.getItem('ptSales:heldSort') || 'newest'; } catch { return 'newest'; }
  });
  const [heldQuery, setHeldQuery] = useState(() => {
    try { return localStorage.getItem('ptSales:heldQuery') || ''; } catch { return ''; }
  });
  const toast = useToast();
  const addItemToCart = (payload) => dispatch(addItem({ ...payload, scope: cartScope }));
  const removeItemFromCart = (id) => dispatch(removeItem({ id, scope: cartScope }));
  const removeUnitFromCart = (unitId) => dispatch(removeItemByUnitId({ unitId, scope: cartScope }));
  const setCartItemQuantity = (id, quantity) => dispatch(setQuantity({ id, quantity, scope: cartScope }));
  const setCartItemPricing = (payload) => dispatch(updateItemPricing({ ...payload, scope: cartScope }));
  const clearActiveCart = () => dispatch(clearCart({ scope: cartScope }));
  const replaceActiveCart = (payload) => dispatch(replaceCart({ ...payload, scope: cartScope }));
  const addHeldSale = (payload) => dispatch(addHeld({ ...payload, scope: cartScope }));
  const removeHeldSale = (id) => dispatch(removeHeld({ id, scope: cartScope }));
  const patchHeldSale = (payload) => dispatch(updateHeld({ ...payload, scope: cartScope }));
  const setCartDiscountValue = (value) => dispatch(setDiscount({ value, scope: cartScope }));
  const distributionDefaultPrintMode = useMemo(() => {
    const next = String(settings?.distributionPosDefaultPrintMode || '').trim().toLowerCase();
    return ['receipt', 'invoice', 'both'].includes(next) ? next : 'receipt';
  }, [settings?.distributionPosDefaultPrintMode]);
  const warehouseDefaultPrintMode = useMemo(() => {
    const next = String(settings?.warehousePosDefaultPrintMode || '').trim().toLowerCase();
    return ['receipt', 'invoice', 'both'].includes(next) ? next : 'receipt';
  }, [settings?.warehousePosDefaultPrintMode]);
  const posDefaultPrintMode = isWholesale ? distributionDefaultPrintMode : isWarehouse ? warehouseDefaultPrintMode : 'receipt';
  const canBackdateSales = useMemo(() => (
    roleLower === 'superadmin' || roleLower === 'admin' || (Array.isArray(auth.grants) && auth.grants.includes('backdate_sales'))
  ), [auth.grants, roleLower]);

  function resetSaleDateTime() {
    const next = getLocalSaleDateTimeParts();
    setSaleDate(next.date);
    setSaleTime(next.time);
    setSaleDateTimeTouched(false);
    setSaleDateTimeEditing(false);
  }

  useEffect(() => {
    if (!isFixedBranchUser) return;
    const current = String(branchId || '').trim();
    const next = String(activeBranchId || '').trim();
    if (!next || current === next) return;
    dispatch(setCurrentBranch(next));
  }, [activeBranchId, branchId, dispatch, isFixedBranchUser]);
  useEffect(() => {
    setLiveSerializedUnits([]);
    setLiveSerializedLoading(false);
    setSerializedUnits([]);
    setSerializedUnitsQuery('');
    setSerializedUnitsPage(1);
    setSerializedUnitsTotal(0);
    setSerializedPickerProduct(null);
    setSerializedScanInput('');
  }, [activeBranchId]);
  useEffect(() => {
    try { localStorage.setItem(reservationStorageKey, reservationToken); } catch {}
  }, [reservationStorageKey, reservationToken]);
  useEffect(() => {
    if (cart.items.length > 0 || !reservationToken) return;
    void productUnitsApi.releaseProductUnits({ unitIds: [], reservationToken }).catch(() => {});
  }, [cart.items.length, reservationToken]);
  useEffect(() => {
    setSelectedPriceTier(getPreferredPriceTier(allowedPriceTiers, initialPriceTier));
    setView('grid');
  }, [allowedPriceTiers, initialPriceTier]);
  const sellables = useMemo(() => {
    const out = [];
    products.forEach(p => {
      const basePrices = {
        retail: Number(p.retailPrice || p.price || 0),
        wholesale: Number(p.wholesalePrice || p.retailPrice || p.price || 0),
        warehouse: Number(p.warehousePrice || 0),
        agent: Number(p.agentPrice || p.wholesalePrice || p.retailPrice || p.price || 0)
      };
      if (Array.isArray(p.variants) && p.variants.length > 0) {
        p.variants.forEach(v => {
          const prices = {
            retail: getDisplayPrice({ ...p, ...v, price: v.price != null ? v.price : p.price, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice, agentPrice: v.agentPrice }, 'retail'),
            wholesale: getDisplayPrice({ ...p, ...v, price: v.price != null ? v.price : p.price, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice, agentPrice: v.agentPrice }, 'wholesale'),
            warehouse: getDisplayPrice({ ...p, ...v, price: v.price != null ? v.price : p.price, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice, warehousePrice: v.warehousePrice, agentPrice: v.agentPrice }, 'warehouse'),
            agent: getDisplayPrice({ ...p, ...v, price: v.price != null ? v.price : p.price, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice, agentPrice: v.agentPrice }, 'agent')
          };
          out.push({
            id: `${p.id}:${v.id}`,
            productId: p.id,
            variantId: v.id,
            variantLabel: v.label || '',
            productName: p.name,
            trackType: v.trackType || p.trackType || 'quantity',
            name: `${p.name} (${v.label})`,
            brand: getProductBrand(p),
            sku: v.sku || `${p.sku}-${v.label}`,
            price: prices[selectedPriceTier] ?? prices[getPreferredPriceTier(allowedPriceTiers, initialPriceTier)] ?? prices.retail,
            prices,
            image: v.image || p.image,
            category: p.category || '',
            stockByBranch: v.stockByBranch || {},
            wholesaleStockByBranch: v.wholesaleStockByBranch || {},
            warehouseStockByBranch: v.warehouseStockByBranch || {},
            lowStock: inventoryType === 'wholesale'
              ? Number(p.wholesaleLowStock != null ? p.wholesaleLowStock : (p.lowStock || 0))
              : inventoryType === 'warehouse'
                ? Number(p.warehouseLowStock != null ? p.warehouseLowStock : (p.lowStock || 0))
                : Number(p.lowStock || 0),
            attributes: p.attributes,
            unitKind: p.unitKind, unitValue: p.unitValue, unitSymbol: p.unitSymbol, sizeLabel: p.sizeLabel, shoeSize: p.shoeSize,
            allowCredit: p.allowCredit !== false,
            minimumCreditPercentage: Number(p.minimumCreditPercentage || 0)
          });
        });
      } else {
        out.push({
          ...p,
          brand: getProductBrand(p),
          price: basePrices[selectedPriceTier] ?? basePrices[getPreferredPriceTier(allowedPriceTiers, initialPriceTier)] ?? basePrices.retail,
          prices: basePrices,
          stockByBranch: inventoryType === 'wholesale' ? (p.wholesaleStockByBranch || {}) : inventoryType === 'warehouse' ? (p.warehouseStockByBranch || {}) : (p.stockByBranch || {}),
          lowStock: inventoryType === 'wholesale'
            ? Number(p.wholesaleLowStock != null ? p.wholesaleLowStock : (p.lowStock || 0))
            : inventoryType === 'warehouse'
              ? Number(p.warehouseLowStock != null ? p.warehouseLowStock : (p.lowStock || 0))
              : Number(p.lowStock || 0),
          allowCredit: p.allowCredit !== false,
          minimumCreditPercentage: Number(p.minimumCreditPercentage || 0)
        });
      }
    });
    return out;
  }, [allowedPriceTiers, initialPriceTier, inventoryType, products, selectedPriceTier]);
  const serializedStockRefreshKey = `${cart.items.length}:${liveSerializedUnits.length}:${reservingSerializedKeys.length}`;
  const categoryOptions = useMemo(() => (
    Array.from(new Set(sellables.map((item) => String(item.category || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
      .map((item) => ({ value: item, label: item }))
  ), [sellables]);
  const categoryScopedSellables = useMemo(() => (
    categoryFilter === 'all'
      ? sellables
      : sellables.filter((item) => String(item.category || '').trim() === String(categoryFilter))
  ), [categoryFilter, sellables]);
  const brandOptions = useMemo(() => (
    Array.from(new Set(categoryScopedSellables.map((item) => String(item.brand || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
      .map((item) => ({ value: item, label: item }))
  ), [categoryScopedSellables]);
  const trackTypeOptions = useMemo(() => ([
    { value: 'quantity', label: t('Quantity') },
    { value: 'serialized', label: t('Serialized') }
  ]), [t]);
  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryOptions.some((item) => item.value === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryOptions]);
  useEffect(() => {
    if (brandFilter !== 'all' && !brandOptions.some((item) => item.value === brandFilter)) {
      setBrandFilter('all');
    }
  }, [brandFilter, brandOptions]);
  const serializedStockCountMap = useMemo(() => {
    void serializedStockRefreshKey;
    if (!activeBranchId) return new Map();
    const cached = productUnitsApi.getCachedProductUnits({
      branchId: activeBranchId,
      inventoryType,
      page: 1,
      pageSize: 5000
    });
    const map = new Map();
    (Array.isArray(cached?.rows) ? cached.rows : []).forEach((row) => {
      const status = String(row.status || '');
      const reservedForCurrentCart = status === 'reserved' && reservationToken && String(row.reservationToken || '') === String(reservationToken);
      if (!(status === 'in_stock' || reservedForCurrentCart)) return;
      const key = `${String(row.productId || '')}:${String(row.variantId || '')}`;
      map.set(key, Number(map.get(key) || 0) + 1);
    });
    return map;
  }, [activeBranchId, inventoryType, reservationToken, serializedStockRefreshKey]);
  const filtered = useMemo(() => {
    if (missingInventoryBranch) return [];
    const q = query.trim().toLowerCase();
    return sellables.filter((p) => {
      if (categoryFilter !== 'all' && String(p.category || '').trim() !== String(categoryFilter)) return false;
      if (brandFilter !== 'all' && String(p.brand || '').trim() !== String(brandFilter)) return false;
      if (trackTypeFilter !== 'all' && getEffectiveTrackType(p) !== String(trackTypeFilter)) return false;
      if (!q) return true;
      return `${getProductSearchText(p)} ${productSpec(p)}`.toLowerCase().includes(q);
    });
  }, [brandFilter, categoryFilter, missingInventoryBranch, query, sellables, trackTypeFilter]);
  const liveSerializedMatches = useMemo(() => {
    const normalized = String(query || '').trim().toLowerCase();
    return liveSerializedUnits
      .map((unit) => {
        const product = sellables.find((p) =>
          String(p.productId || p.id) === String(unit.productId)
          && String(p.variantId || '') === String(unit.variantId || '')
        );
        if (!product) return null;
        const exactScore = (String(unit.imei || '').toLowerCase() === normalized || String(unit.serialNumber || '').toLowerCase() === normalized) ? 0 : 1;
        const suffixScore = (normalized.length >= 4 && (String(unit.imei || '').toLowerCase().endsWith(normalized) || String(unit.serialNumber || '').toLowerCase().endsWith(normalized))) ? 0 : 1;
        const matchLabel = exactScore === 0 ? 'Exact Match' : suffixScore === 0 ? 'Last Digits Match' : 'Related Match';
        return { unit, product, exactScore, suffixScore, matchLabel };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.exactScore !== b.exactScore) return a.exactScore - b.exactScore;
        if (a.suffixScore !== b.suffixScore) return a.suffixScore - b.suffixScore;
        return String(a.unit.imei || a.unit.serialNumber || '').localeCompare(String(b.unit.imei || b.unit.serialNumber || ''));
      });
  }, [liveSerializedUnits, query, sellables]);
  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find(c => String(c.id) === String(selectedCustomerId)) || null;
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    const invoice = location.state?.preloadInvoice;
    const preloadKey = String(invoice?.id || invoice?._id || invoice?.clientId || invoice?.number || '').trim();
    if (!invoice || !preloadKey || preloadedInvoiceRef.current === preloadKey) return;
    preloadedInvoiceRef.current = preloadKey;
    let cancelled = false;
    (async () => {
      const normalizedItems = (Array.isArray(invoice?.items) ? invoice.items : []).map((item, index) => ({
        id: `invoice-${preloadKey}-${index}`,
        productId: item?.productId || '',
        variantId: item?.variantId || '',
        name: item?.name || '',
        brand: item?.brand || '',
        sku: item?.sku || '',
        spec: item?.spec || '',
        quantity: Math.max(1, Number(item?.qty || 1)),
        price: Math.max(0, Number(item?.rate || 0)),
        priceTier: item?.priceTier || initialPriceTier
      }));
      const shortages = normalizedItems.filter((item) => {
        const product = products.find((row) => String(row.id || '') === String(item.productId || '')) || products.find((row) => String(row.sku || '') === String(item.sku || ''));
        const variant = item.variantId && Array.isArray(product?.variants)
          ? product.variants.find((row) => String(row.id || '') === String(item.variantId || ''))
          : null;
        if (!product && !variant) return false;
        const availableQty = getBranchStock(variant || product, stockBranchId, inventoryType);
        return Number(item.quantity || 0) > Math.max(0, Number(availableQty || 0));
      });
      let nextItems = normalizedItems;
      if (shortages.length > 0) {
        const removeShortages = await confirmDialog(`Some invoice items are above current stock for ${branchLabel || 'this branch'}.\n\n${shortages.map((item) => `${item.name || item.sku}: need ${item.quantity}`).join('\n')}\n\nPress OK to remove those items before opening POS. Press Cancel to continue anyway.`);
        if (cancelled) return;
        if (removeShortages) {
          const shortageKeys = new Set(shortages.map((item) => `${String(item.productId || '')}:${String(item.variantId || '')}:${String(item.sku || '')}`));
          nextItems = normalizedItems.filter((item) => !shortageKeys.has(`${String(item.productId || '')}:${String(item.variantId || '')}:${String(item.sku || '')}`));
        }
      }
      replaceActiveCart({ items: nextItems, discount: Number(invoice?.discount || 0), notes: String(invoice?.notes || '') });
      const invoiceCustomer = invoice?.customer || {};
      const matchedCustomer = String(invoiceCustomer?.customerId || '').trim()
        ? customers.find((row) => String(row.id || '') === String(invoiceCustomer.customerId || ''))
        : (String(invoiceCustomer?.customerCode || '').trim()
            ? customers.find((row) => String(row.customerCode || '') === String(invoiceCustomer.customerCode || ''))
            : null);
      setSelectedCustomerId(matchedCustomer ? String(matchedCustomer.id || '') : '');
      setCustomerQuery(matchedCustomer ? '' : String(invoiceCustomer?.name || ''));
      setQuickCustomerForm({
        name: String(invoiceCustomer?.name || ''),
        phone: String(invoiceCustomer?.phone || invoiceCustomer?.businessPhone || ''),
        address: String(invoiceCustomer?.address || invoiceCustomer?.businessAddress || ''),
        customerType: defaultCustomerType
      });
      setSelectedPriceTier(String(invoice?.items?.[0]?.priceTier || initialPriceTier));
      setQuery('');
      if (!cancelled) toast.show(`Invoice ${invoice?.number || ''} loaded into POS`, { type: 'success' });
    })();
    return () => {
      cancelled = true;
    };
  }, [branchLabel, customers, defaultCustomerType, dispatch, initialPriceTier, inventoryType, location.state, products, stockBranchId, toast]);

  const customerMatches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        String(c.customerCode || '').toLowerCase().includes(q) ||
        String(c.idCardNumber || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [customers, customerQuery]);

  const heldList = useMemo(() => {
    let list = Array.isArray(heldSales) ? heldSales.slice() : [];
    function ts(x) { try { return new Date(x || 0).getTime() || 0; } catch { return 0; } }
    if (heldSort === 'oldest') {
      list.sort((a,b) => ts(a.createdAt) - ts(b.createdAt));
    } else if (heldSort === 'labelAZ') {
      list.sort((a,b) => String(a.label || '').localeCompare(String(b.label || '')));
    } else if (heldSort === 'labelZA') {
      list.sort((a,b) => String(b.label || '').localeCompare(String(a.label || '')));
    } else {
      list.sort((a,b) => ts(b.createdAt) - ts(a.createdAt));
    }
    const q = String(heldQuery || '').trim().toLowerCase();
    if (q) {
      list = list.filter(h => {
        const label = String(h.label || '').toLowerCase();
        if (label.includes(q)) return true;
        const cust = customers.find(c => String(c.id) === String(h.selectedCustomerId));
        const cname = String(cust?.name || cust?.customerCode || '').toLowerCase();
        return cname.includes(q);
      });
    }
    return list;
  }, [heldSales, heldSort, heldQuery, customers]);
  const discountRequestList = useMemo(() => {
    return (Array.isArray(discountRequests) ? discountRequests : [])
      .filter((row) => !['completed', 'cancelled'].includes(String(row?.status || '')))
      .sort((a, b) => {
        const left = new Date(b?.updatedAt || b?.createdAt || 0).getTime() || 0;
        const right = new Date(a?.updatedAt || a?.createdAt || 0).getTime() || 0;
        return left - right;
      });
  }, [discountRequests]);

  const canQuickAddCustomer = useMemo(() => {
    const roleLower = String(auth.role || '').toLowerCase();
    const grants = Array.isArray(auth.grants) ? auth.grants : [];
    return roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('add_customers');
  }, [auth.grants, auth.role]);
  const quickCustomerHasAny = useMemo(() => (
    !!String(quickCustomerForm.name || '').trim()
    || !!String(quickCustomerForm.phone || '').trim()
    || !!String(quickCustomerForm.address || '').trim()
  ), [quickCustomerForm.address, quickCustomerForm.name, quickCustomerForm.phone]);
  const quickCustomerReady = useMemo(() => (
    !!String(quickCustomerForm.name || '').trim()
    && !!String(quickCustomerForm.phone || '').trim()
    && !!String(quickCustomerForm.address || '').trim()
  ), [quickCustomerForm.address, quickCustomerForm.name, quickCustomerForm.phone]);

  function updateCustomerLookup(value) {
    const nextValue = String(value || '');
    setCustomerQuery(nextValue);
    if (!selectedCustomerId) {
      setQuickCustomerForm((prev) => ({ ...prev, name: nextValue }));
    }
  }

  async function ensureCheckoutCustomer() {
    if (selectedCustomer) return selectedCustomer;
    if (!quickCustomerHasAny) return null;
    if (!canQuickAddCustomer) {
      throw new Error('Not authorized to register customers from POS');
    }
    if (!quickCustomerReady) {
      throw new Error('Enter customer name, phone, and address');
    }
    const payload = {
      name: String(quickCustomerForm.name || '').trim(),
      phone: String(quickCustomerForm.phone || '').trim(),
      address: String(quickCustomerForm.address || '').trim(),
      customerType: defaultCustomerType,
      registrationBranchId: String(stockBranchId || '').trim(),
      registrationBranchName: String(branchLabel || '').trim()
    };
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) throw new Error('Offline: connect internet and try again.');
      const clientId = `offline-customer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const offlineRow = { ...payload, id: clientId, clientId, customerCode: `OFF-${String(Date.now()).slice(-6)}`, loyaltyPoints: 0, offline: true };
      dispatch(addCustomer(offlineRow));
      await enqueueHttp({ collection: 'customers', label: 'Customer', path: '/api/customers', method: 'POST', body: { ...payload, clientId } });
      setSelectedCustomerId(String(clientId));
      return offlineRow;
    }
    const clientId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `cust-${Date.now()}`;
    const created = await customersApi.create({ ...payload, clientId });
    dispatch(addCustomer(created));
    setSelectedCustomerId(String(created?.id || created?._id || clientId));
    return created;
  }

  function resetCheckoutAfterSubmission() {
    clearActiveCart();
    rotateReservationToken();
    setSelectedCustomerId('');
    setCustomerQuery('');
    setQuickCustomerForm({ name: '', phone: '', address: '', customerType: defaultCustomerType });
    setRedeemPoints('');
    setEasyBuyEnabled(false);
    setEasyBuyAmountPaidNow('');
    setEasyBuyDueDate('');
    resetSaleDateTime();
  }

  const refreshDiscountRequests = useCallback(async () => {
    if (!navigator.onLine || !activeBranchId) {
      setDiscountRequests([]);
      return;
    }
    setDiscountLoading(true);
    try {
      const rows = await listDiscountApprovals({
        mine: true,
        posType: modeLower,
        branchId: activeBranchId
      });
      setDiscountRequests(Array.isArray(rows) ? rows : []);
    } catch {
      setDiscountRequests([]);
    } finally {
      setDiscountLoading(false);
    }
  }, [activeBranchId, modeLower]);
  useEffect(() => {
    void refreshDiscountRequests();
  }, [refreshDiscountRequests]);

  async function prepareSalePayload() {
    if (!easyBuyEnabled && due > 0) {
      throw new Error('Payment incomplete');
    }
    if (easyBuyEnabled) {
      const creditPaymentsTotal = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
      const creditPaidNow = Math.max(0, Number(easyBuyAmountPaidNow || 0));
      if (!easyBuyAllowed) throw new Error(`${creditModeLabel} requires items in cart`);
      if (!selectedCustomer && !quickCustomerReady) throw new Error(`${creditModeLabel} requires customer name, phone, and address`);
      if (easyBuyBlockedItem) throw new Error(`${easyBuyBlockedItem.name} is not allowed for ${creditModeLabel.toLowerCase()}`);
      if (!easyBuyDueDate) throw new Error(`Select a due date for ${creditModeLabel}`);
      const selectedSaleAt = buildSaleDateTimeValue(saleDate, saleTime);
      const saleDay = toDateInputValue(selectedSaleAt);
      if (saleDay && String(easyBuyDueDate || '') < saleDay) {
        throw new Error(`${creditModeLabel} due date cannot be earlier than the sale date`);
      }
      if (creditPaidNow >= (Number(total || 0) - 0.005)) {
        throw new Error(`${creditModeLabel} is selected but amount paid now covers the full sale. Please check again and use a normal sale if the customer is paying in full.`);
      }
      if ((Number(easyBuyAmountPaidNow || 0) + 0.0001) < Number(easyBuyMinimum || 0)) {
        throw new Error(`Minimum upfront payment is ${formatCurrency(easyBuyMinimum, settings)}`);
      }
      if (Math.abs(creditPaymentsTotal - Number(easyBuyAmountPaidNow || 0)) > 0.005) {
        throw new Error(`${creditModeLabel} payment breakdown must equal amount paid now`);
      }
      if (customerMaxCreditLimit > 0 && (customerOutstanding + due) > customerMaxCreditLimit) {
        throw new Error('Customer exceeds the configured credit limit');
      }
    }
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) throw new Error('Offline: connect internet and try again.');
    }
    if (canOverrideTax && taxOverridePct !== '' && String(Math.round((taxRate || 0) * 100)) !== String(Math.round((settings.taxRate || 0) * 100))) {
      if (!taxOverrideRemark.trim()) throw new Error('Enter a remark for tax override');
    }
    let checkoutCustomer = selectedCustomer;
    if (!checkoutCustomer && (easyBuyEnabled || quickCustomerHasAny)) {
      checkoutCustomer = await ensureCheckoutCustomer();
    }
    const branchName = activeBranch?.name || activeBranchId;
    const saleCapturedAt = new Date().toISOString();
    const selectedSaleAt = buildSaleDateTimeValue(saleDate, saleTime).toISOString();
    const effectiveSaleAt = canBackdateSales && saleDateTimeTouched ? selectedSaleAt : saleCapturedAt;
    const creditPackageName = easyBuyEnabled ? activeCreditPackageName : '';
    const sale = {
      branchId: activeBranchId,
      branchName,
      sellerName: auth.user?.name || 'unknown',
      sellerRole: auth.role || '',
      customerId: checkoutCustomer ? checkoutCustomer.id : '',
      customerCode: checkoutCustomer ? (checkoutCustomer.customerCode || '') : '',
      customerName: checkoutCustomer ? (checkoutCustomer.name || '') : '',
      customerPhone: checkoutCustomer ? (checkoutCustomer.phone || '') : '',
      customerAddress: checkoutCustomer ? (checkoutCustomer.address || '') : '',
      customerBusinessName: checkoutCustomer ? (checkoutCustomer.businessName || '') : '',
      customerBusinessAddress: checkoutCustomer ? (checkoutCustomer.businessAddress || '') : '',
      customerTaxId: checkoutCustomer ? (checkoutCustomer.taxId || '') : '',
      posType: modeLower,
      inventoryType,
      defaultPriceTier: selectedPriceTier,
      loyaltyPointsRedeemed: (settings.loyaltyEnabled && checkoutCustomer) ? redeemable : 0,
      items: cart.items.map(i => ({
        name: i.name,
        brand: i.brand || '',
        sku: i.sku,
        spec: i.spec,
        qty: i.quantity,
        price: i.price,
        priceTier: i.priceTier || selectedPriceTier,
        productId: i.productId,
        variantId: i.variantId || null,
        soldUnitIds: i.unitId ? [i.unitId] : [],
        soldUnits: i.unitId ? [{ unitId: i.unitId, imei: i.imei || '', serialNumber: i.serialNumber || '' }] : []
      })),
      subtotal,
      discount,
      tax,
      total,
      payment_methods: payments.map(p => ({ type: p.type, amount: Number(p.amount) || 0 })),
      creditMode: easyBuyEnabled ? (isNonRetail ? 'distribution_credit' : 'retail_easybuy') : 'none',
      creditPackageId: easyBuyEnabled ? creditPackageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '',
      creditPackageName,
      creditDueDate: easyBuyEnabled ? easyBuyDueDate : undefined,
      creditAmountPaidNow: easyBuyEnabled ? Number(easyBuyAmountPaidNow || 0) : 0,
      creditBalance: easyBuyEnabled ? due : 0,
      outstandingBalance: easyBuyEnabled ? due : 0,
      outstandingTotal: easyBuyEnabled ? due : 0,
      settlementStatus: easyBuyEnabled && due > 0 ? 'incomplete' : 'completed',
      paymentTimeline: easyBuyEnabled
        ? buildCreditUpfrontTimeline(total, estimatedCostTotal, easyBuyAmountPaidNow, effectiveSaleAt)
        : [{
            source: 'sale',
            amount: total,
            principalAmount: total,
            penaltyAmount: 0,
            recognizedCost: Number(estimatedCostTotal || 0),
            recognizedProfit: Number(total || 0) - Number(estimatedCostTotal || 0),
            paidAt: effectiveSaleAt
          }],
      creditSale: easyBuyEnabled ? {
        enabled: true,
        amountPaidNow: Number(easyBuyAmountPaidNow || 0),
        dueDate: easyBuyDueDate,
        creditPackageId: creditPackageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        creditPackageName
      } : undefined,
      status: 'completed',
      created_at: effectiveSaleAt,
      saleCapturedAt,
      saleDateTime: canBackdateSales && saleDateTimeTouched ? selectedSaleAt : undefined,
      reservationToken
    };
    return {
      sale,
      branchName,
      checkoutCustomer,
      soldUnitIdsForDebug: cart.items.map((item) => item.unitId).filter(Boolean).map(String),
      affectedProductIds: Array.from(new Set(cart.items.map(i => i.productId).filter(Boolean)))
    };
  }

  async function submitDiscountForReview() {
    if (saving) return;
    if (!requiresDiscountApproval) {
      toast.show('Enter a discount first', { type: 'error' });
      return;
    }
    if (!navigator.onLine) {
      toast.show('Discount review requires internet connection', { type: 'error' });
      return;
    }
    if (cart.items.length === 0) {
      toast.show('Cart is empty', { type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const { sale } = await prepareSalePayload();
      await requestDiscountApproval({
        requestKey: `${modeLower}:${activeBranchId}:${auth.user?.name || 'unknown'}:${Date.now()}`,
        salePayload: sale
      });
      resetCheckoutAfterSubmission();
      setDiscountOpen(true);
      await refreshDiscountRequests();
      toast.show('Discount sale sent for review', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to send discount for review'), { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function computeReviewTaxRate(subtotalValue, discountValue, taxValue) {
    const taxable = Math.max(0, Number(subtotalValue || 0) - Number(discountValue || 0));
    if (taxable <= 0) return 0;
    return Math.max(0, Number(taxValue || 0)) / taxable;
  }

  function adjustReviewPaymentMethods(paymentMethods = [], nextTotal = 0) {
    const methods = Array.isArray(paymentMethods) ? paymentMethods.map((entry) => ({
      ...entry,
      amount: Math.max(0, Number(entry?.amount || 0))
    })) : [];
    const currentTotal = methods.reduce((sum, entry) => sum + Math.max(0, Number(entry?.amount || 0)), 0);
    const delta = Number(nextTotal || 0) - currentTotal;
    if (methods.length === 0) return [{ type: 'cash', amount: Math.max(0, Number(nextTotal || 0)) }];
    const cashIndex = methods.findIndex((entry) => String(entry?.type || '').toLowerCase() === 'cash');
    const targetIndex = cashIndex >= 0 ? cashIndex : methods.length - 1;
    methods[targetIndex] = {
      ...methods[targetIndex],
      amount: Math.max(0, Number(methods[targetIndex]?.amount || 0) + delta)
    };
    return methods;
  }

  function buildDiscountCompletionPayload(row) {
    const status = String(row?.status || '');
    const basePayload = row?.salePayload && typeof row.salePayload === 'object' ? { ...row.salePayload } : {};
    if (status !== 'rejected') return basePayload;
    const subtotalValue = Math.max(0, Number(row?.subtotal || basePayload?.subtotal || 0));
    const nextTaxRate = computeReviewTaxRate(subtotalValue, row?.discount || basePayload?.discount || 0, row?.tax || basePayload?.tax || 0);
    const nextTax = Math.max(0, subtotalValue * nextTaxRate);
    const nextTotal = Math.max(0, subtotalValue + nextTax);
    return {
      ...basePayload,
      subtotal: subtotalValue,
      discount: 0,
      tax: nextTax,
      total: nextTotal,
      payment_methods: adjustReviewPaymentMethods(basePayload?.payment_methods, nextTotal)
    };
  }

  function getDiscountRequestUnitIds(row) {
    const payloadItems = Array.isArray(row?.salePayload?.items) ? row.salePayload.items : [];
    return Array.from(new Set(
      payloadItems.flatMap((item) => {
        const soldUnitIds = Array.isArray(item?.soldUnitIds) ? item.soldUnitIds : [];
        const soldUnits = Array.isArray(item?.soldUnits) ? item.soldUnits.map((unit) => unit?.unitId) : [];
        return [...soldUnitIds, ...soldUnits].map(String).filter(Boolean);
      })
    ));
  }

  async function completeApprovedDiscountRequest(row) {
    const id = String(row?._id || '');
    if (!id || saving) return;
    const status = String(row?.status || '');
    if (!['approved', 'rejected'].includes(status)) return;
    if (!navigator.onLine) {
      toast.show('Connect internet to complete approved discounted sales', { type: 'error' });
      return;
    }
    setDiscountWorkingId(id);
    try {
      const saved = await createSale({
        ...buildDiscountCompletionPayload(row),
        clientId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `discount-sale-${Date.now()}`,
        discountApprovalId: id
      });
      const saleForPrint = {
        ...saved,
        branchName: row?.branchName || activeBranch?.name || activeBranchId
      };
      dispatch(recordSale(saleForPrint));
      const shouldPrint = await confirmDialog('Print receipt now?');
      if (shouldPrint) {
        printReceiptHtml(buildBrandedReceiptHtml({ settings, sale: saleForPrint }));
      }
      await refreshDiscountRequests();
      void refreshAffectedProducts(dispatch, Array.from(new Set((row?.salePayload?.items || []).map((item) => item.productId).filter(Boolean))));
      toast.show(status === 'rejected' ? 'Rejected discount sale completed without discount' : 'Approved discounted sale completed', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to complete approved discounted sale'), { type: 'error' });
    } finally {
      setDiscountWorkingId('');
    }
  }

  async function cancelRejectedDiscountRequest(row) {
    const id = String(row?._id || '');
    if (!id || saving) return;
    if (String(row?.status || '') !== 'rejected') return;
    const okay = await confirmDialog('Cancel this rejected discount sale?');
    if (!okay) return;
    setDiscountWorkingId(id);
    try {
      const unitIds = getDiscountRequestUnitIds(row);
      if (unitIds.length > 0 && row?.salePayload?.reservationToken) {
        await productUnitsApi.releaseProductUnits({
          unitIds,
          reservationToken: String(row.salePayload.reservationToken || '')
        });
      }
      await cancelDiscountApproval(id, {});
      await refreshDiscountRequests();
      toast.show('Rejected discount sale cancelled', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to cancel rejected discount sale'), { type: 'error' });
    } finally {
      setDiscountWorkingId('');
    }
  }

  function isSerializedAlreadyInCart(unit) {
    const unitId = String(unit?._id || unit?.unitId || '');
    const imei = String(unit?.imei || '').trim();
    const serialNumber = String(unit?.serialNumber || '').trim();
    return cart.items.some(item =>
      (unitId && String(item.unitId || '') === unitId)
      || (imei && String(item.imei || '').trim() === imei)
      || (serialNumber && String(item.serialNumber || '').trim() === serialNumber)
    );
  }

  function serializedUnitKey(unit) {
    return String(unit?._id || unit?.unitId || unit?.imei || unit?.serialNumber || '').trim();
  }

  function isSerializedPending(unit) {
    const key = serializedUnitKey(unit);
    return key ? reservingSerializedKeys.includes(key) : false;
  }

  function getSerializedVisibleStockForBranch(p) {
    const key = `${String(p.productId || p.id || '')}:${String(p.variantId || '')}`;
    if (serializedStockCountMap.has(key)) {
      return Number(serializedStockCountMap.get(key) || 0);
    }
    const exactCount = productUnitsApi.getEffectiveCachedProductUnitCount({
      productId: p.productId || p.id,
      variantId: p.variantId || '',
      branchId: activeBranchId,
      inventoryType,
      reservationToken
    });
    return exactCount?.hasCache ? Number(exactCount.count || 0) : 0;
  }

  function visibleStockForProduct(p) {
    if (getEffectiveTrackType(p) === 'serialized') {
      return getSerializedVisibleStockForBranch(p);
    }
    return getAvailableStockForBranch(p);
  }

  function getVisibleStockBadge(p) {
    const visible = Number(visibleStockForProduct(p) || 0);
    const lowStock = Number(p.lowStock ?? 0);
    if (visible <= 0) {
      return { text: t('Out of stock'), color: '#ef4444' };
    }
    if (lowStock > 0 && visible <= lowStock) {
      return { text: `${t('Stock')}: ${visible} • ${t('Low')}`, color: '#ef4444' };
    }
    return { text: `${t('Stock')}: ${visible}`, color: undefined };
  }

  function getAvailableStockForBranch(p) {
    return getBranchStock(p, stockBranchId, inventoryType);
  }

  function onChangeHeldSort(v) {
    setHeldSort(v);
    try { localStorage.setItem('ptSales:heldSort', v); } catch {}
  }
  function onChangeHeldQuery(v) {
    setHeldQuery(v);
    try { localStorage.setItem('ptSales:heldQuery', v); } catch {}
  }

  useEffect(() => {
    const normalized = String(query || '').trim();
    if (normalized.length < 4 || !activeBranchId) {
      setLiveSerializedUnits([]);
      setLiveSerializedLoading(false);
      return;
    }
    const requestId = ++liveSerializedSearchSeqRef.current;
    const cached = productUnitsApi.getCachedProductUnits({
      branchId: activeBranchId,
      inventoryType,
      status: 'available',
      reservationToken,
      query: normalized,
      page: 1,
      pageSize: 12
    });
    setLiveSerializedUnits(Array.isArray(cached?.rows) ? cached.rows : []);
    setLiveSerializedLoading(true);
    const likelyExactCode = normalized.length >= 8 && !/\s/.test(normalized);
    const timer = setTimeout(async () => {
      const mergeUniqueUnits = (rows = []) => {
        const seen = new Set();
        return rows.filter((row) => {
          const key = String(row?._id || `${row?.imei || ''}-${row?.serialNumber || ''}`);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };
      try {
        if (likelyExactCode) {
          try {
            const exact = await productUnitsApi.lookupProductUnit(normalized);
            if (requestId !== liveSerializedSearchSeqRef.current) return;
            const validExact = exact
              && String(exact.branchId || '') === String(activeBranchId || '')
              && String(exact.inventoryType || 'retail') === inventoryType
              && ['in_stock', 'reserved'].includes(String(exact.status || ''))
              && (String(exact.status || '') !== 'reserved' || String(exact.reservationToken || '') === String(reservationToken || ''));
            if (validExact) {
              setLiveSerializedUnits((prev) => mergeUniqueUnits([exact, ...(Array.isArray(prev) ? prev : [])]).slice(0, 12));
              setLiveSerializedLoading(false);
              return;
            }
          } catch {}
        }
      } catch {}
      try {
        const result = await productUnitsApi.listProductUnits({
          branchId: activeBranchId,
          inventoryType,
          status: 'available',
          reservationToken,
          query: normalized,
          page: 1,
          pageSize: 12
        });
        if (requestId !== liveSerializedSearchSeqRef.current) return;
        setLiveSerializedUnits(Array.isArray(result?.rows) ? result.rows : []);
      } catch {
        if (requestId !== liveSerializedSearchSeqRef.current) return;
        setLiveSerializedUnits([]);
      } finally {
        if (requestId === liveSerializedSearchSeqRef.current) setLiveSerializedLoading(false);
      }
    }, likelyExactCode ? 40 : 90);
    return () => clearTimeout(timer);
  }, [query, activeBranchId, inventoryType, reservationToken]);

  useEffect(() => {
    if (!activeBranchId) return;
    productUnitsApi.listProductUnits({
      branchId: activeBranchId,
      inventoryType,
      status: 'available',
      all: true,
      page: 1,
      pageSize: 5000
    }).catch(() => {});
  }, [activeBranchId, inventoryType]);

  const subtotal = cart.items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
  const serializedPickerCartItems = useMemo(() => {
    if (!serializedPickerProduct) return [];
    const productId = String(serializedPickerProduct.productId || serializedPickerProduct.id || '').trim();
    const variantId = String(serializedPickerProduct.variantId || '').trim();
    return cart.items.filter((item) => {
      const itemProductId = String(item.productId || item.id || '').trim();
      const itemVariantId = String(item.variantId || '').trim();
      const hasSerializedCode = String(item.imei || '').trim() || String(item.serialNumber || '').trim();
      return itemProductId === productId && itemVariantId === variantId && hasSerializedCode;
    });
  }, [cart.items, serializedPickerProduct]);
  const manualDiscount = cart.discount || 0;
  const canOverrideTax = ['Admin','Manager'].includes(auth.role) || String(auth.role || '').toLowerCase() === 'superadmin';
  const taxRate = canOverrideTax && taxOverridePct !== '' ? Math.max(0, Math.min(1, Number(taxOverridePct) / 100)) : Number(settings.taxRate ?? 0);
  const estimatedCostTotal = cart.items.reduce((sum, item) => {
    return sum + ((Number(item.costPrice || 0) || 0) * (Number(item.quantity || 0) || 0));
  }, 0);
  const maxRedeemPct = Math.max(0, Math.min(100, Number(settings.loyaltyMaxRedeemPercent ?? 50)));
  const redeemValue = Number(settings.loyaltyRedeemValue || 0);
  const availablePoints = Math.max(0, Math.floor(Number(selectedCustomer?.loyaltyPoints || 0)));
  const reqRedeem = Math.max(0, Math.floor(Number(redeemPoints || 0)));
  const redeemable = Math.min(reqRedeem, availablePoints);
  let loyaltyDiscount = (settings.loyaltyEnabled && selectedCustomer && redeemValue > 0) ? (redeemable * redeemValue) : 0;
  const cap = (subtotal > 0 ? (subtotal * (maxRedeemPct / 100)) : 0);
  if (loyaltyDiscount > cap) loyaltyDiscount = cap;
  const discount = Math.max(0, Number(manualDiscount || 0) + Number(loyaltyDiscount || 0));
  const requiresDiscountApproval = discount > 0;
  const tax = Math.max(0, (subtotal - discount) * taxRate);
  const total = Math.max(0, subtotal - discount + tax);
  const paid = easyBuyEnabled ? Math.max(0, Number(easyBuyAmountPaidNow || 0)) : payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const due = Math.max(0, total - paid);
  const change = easyBuyEnabled ? 0 : Math.max(0, paid - total);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const heldUiEnabled = isFeatureEnabled(settings, 'tabs.posHeldSales');
  const easyBuyAllowed = cart.items.length > 0;
  const easyBuyBlockedItem = cart.items.find(item => item.allowCredit === false);
  const easyBuyMinimum = cart.items.reduce((sum, item) => {
    const pct = Math.max(0, Number(item.minimumCreditPercentage || 0));
    return sum + ((Number(item.price || 0) * Number(item.quantity || 0)) * (pct / 100));
  }, 0);
  const customerOutstanding = Number(selectedCustomer?.outstandingBalance || 0);
  const customerMaxCreditLimit = Number(selectedCustomer?.maxCreditLimit || settings.maxCreditLimitPerCustomer || 0);
  const customerCreditScore = Number(selectedCustomer?.creditScore || 0);
  const creditPackageOptions = useMemo(() => {
    const configured = Array.isArray(settings.creditPackages) ? settings.creditPackages : [];
    const defaultLabel = isNonRetail ? 'Credit Sale' : 'Credit';
    return Array.from(new Set([defaultLabel, ...configured.map((item) => String(item || '').trim()).filter(Boolean)]));
  }, [isNonRetail, settings.creditPackages]);
  const activeCreditPackageName = useMemo(() => {
    const selected = String(selectedCreditPackageName || '').trim();
    if (selected) return selected;
    return creditPackageOptions[0] || (isNonRetail ? 'Credit Sale' : 'Credit');
  }, [creditPackageOptions, isNonRetail, selectedCreditPackageName]);

  useEffect(() => {
    if (selectedCreditPackageName && !creditPackageOptions.includes(selectedCreditPackageName)) {
      setSelectedCreditPackageName('');
    }
  }, [creditPackageOptions, selectedCreditPackageName]);

  async function loadSerializedUnits(product, search = '', pageValue = 1, pageSizeValue = serializedUnitsPageSize) {
    if (!product) return;
    const requestId = ++serializedLoadSeqRef.current;
    const productKey = `${product.productId || product.id || ''}:${product.variantId || ''}`;
    serializedPickerKeyRef.current = productKey;
    const cached = productUnitsApi.getCachedProductUnits({
      productId: product.productId || product.id,
      variantId: product.variantId || '',
      branchId: activeBranchId,
      inventoryType,
      status: 'available',
      reservationToken,
      query: search,
      page: pageValue,
      pageSize: pageSizeValue
    });
    if (requestId === serializedLoadSeqRef.current) {
      setSerializedUnits(Array.isArray(cached?.rows) ? cached.rows : []);
      setSerializedUnitsTotal(Number(cached?.total || 0));
    }
    setSerializedLoading(true);
    try {
      const result = await productUnitsApi.listProductUnits({
        productId: product.productId || product.id,
        variantId: product.variantId || '',
        branchId: activeBranchId,
        inventoryType,
        status: 'available',
        reservationToken,
        query: search,
        page: pageValue,
        pageSize: pageSizeValue
      });
      const sameProduct = serializedPickerKeyRef.current === productKey;
      if (requestId !== serializedLoadSeqRef.current || !sameProduct) return;
      setSerializedUnits(Array.isArray(result?.rows) ? result.rows : []);
      setSerializedUnitsTotal(Number(result?.total || 0));
    } catch (e) {
      if (requestId !== serializedLoadSeqRef.current) return;
      toast.show(String(e?.message || 'Failed to load serialized units'), { type: 'error' });
      setSerializedUnits([]);
      setSerializedUnitsTotal(0);
    } finally {
      if (requestId === serializedLoadSeqRef.current) setSerializedLoading(false);
    }
  }

  async function releaseSerializedCartItems(itemsToRelease) {
    return releaseSerializedCartItemsWithToken(itemsToRelease, reservationToken);
  }

  async function releaseSerializedCartItemsWithToken(itemsToRelease, token) {
    const unitIds = (Array.isArray(itemsToRelease) ? itemsToRelease : []).map(item => item.unitId).filter(Boolean);
    if (unitIds.length === 0) return;
    try {
      await productUnitsApi.releaseProductUnits({ unitIds, reservationToken: token });
    } catch {}
  }

  function rotateReservationToken() {
    const next = createReservationToken();
    setReservationToken(next);
    try { localStorage.setItem(reservationStorageKey, next); } catch {}
    return next;
  }

  async function addSerializedUnitToCart(product, unit) {
    const optimisticUnitId = String(unit?._id || serializedUnitKey(unit) || '');
    const optimisticCode = unit?.imei || unit?.serialNumber || '';
    const reservationKey = serializedUnitKey(unit);
    if (isSerializedAlreadyInCart(unit)) {
      toast.show('Serialized item already selected in cart', { type: 'error' });
      return;
    }
    if (reservationKey && reservingSerializedKeys.includes(reservationKey)) {
      toast.show('Serialized item is already being added', { type: 'error' });
      return;
    }
    if (reservationKey) setReservingSerializedKeys(prev => prev.includes(reservationKey) ? prev : [...prev, reservationKey]);
    addItemToCart({
      name: product.name,
      brand: product.brand || getProductBrand(product),
      sku: product.sku,
      price: product.price,
      priceTier: selectedPriceTier,
      prices: product.prices || { retail: product.price, wholesale: product.price, warehouse: product.warehousePrice || 0, agent: product.price },
      allowCredit: product.allowCredit !== false,
      minimumCreditPercentage: Number(product.minimumCreditPercentage || 0),
      spec: productSpec(product),
      productId: product.productId || product.id,
      variantId: product.variantId || null,
      unitId: optimisticUnitId,
      imei: unit?.imei || '',
      serialNumber: unit?.serialNumber || ''
    });
    setSerializedScanInput('');
    try {
      const reservedUnit = await (unit?._id ? productUnitsApi.reserveProductUnit({
        unitId: unit._id,
        productId: product.productId || product.id,
        variantId: product.variantId || '',
        branchId: activeBranchId,
        inventoryType,
        reservationToken
      }) : productUnitsApi.scanProductUnit({
        productId: product.productId || product.id,
        variantId: product.variantId || '',
        branchId: activeBranchId,
        inventoryType,
        reservationToken,
        imei: unit?.imei || unit?.serialNumber || ''
      }));
      const resolvedUnitId = String(reservedUnit?._id || '');
      if (resolvedUnitId && resolvedUnitId !== optimisticUnitId) {
        removeUnitFromCart(optimisticUnitId);
        addItemToCart({
          name: product.name,
          brand: product.brand || getProductBrand(product),
          sku: product.sku,
          price: product.price,
          priceTier: selectedPriceTier,
          prices: product.prices || { retail: product.price, wholesale: product.price, warehouse: product.warehousePrice || 0, agent: product.price },
          allowCredit: product.allowCredit !== false,
          minimumCreditPercentage: Number(product.minimumCreditPercentage || 0),
          spec: productSpec(product),
          productId: product.productId || product.id,
          variantId: product.variantId || null,
          unitId: resolvedUnitId,
          imei: reservedUnit?.imei || unit?.imei || '',
          serialNumber: reservedUnit?.serialNumber || unit?.serialNumber || ''
        });
      }
      toast.show(`Added unit ${optimisticCode}`, { type: 'success' });
    } catch (e) {
      removeUnitFromCart(optimisticUnitId);
      setSerializedPickerProduct(product);
      void loadSerializedUnits(product, serializedUnitsQuery, 1, serializedUnitsPageSize);
      toast.show(String(e?.message || 'Failed to reserve serialized unit'), { type: 'error' });
    } finally {
      if (reservationKey) setReservingSerializedKeys(prev => prev.filter(key => key !== reservationKey));
    }
  }

  async function removeSerializedUnitFromCart(item) {
    if (!item) return;
    removeItemFromCart(item.id);
    setSerializedScanInput('');
    void releaseSerializedCartItems([item]);
    if (serializedPickerProduct) {
      void loadSerializedUnits(serializedPickerProduct, serializedUnitsQuery, serializedUnitsPage, serializedUnitsPageSize);
    }
  }

  async function addToCart(p) {
    const available = getAvailableStockForBranch(p);
    const visible = visibleStockForProduct(p);
    const decisionAvailable = getEffectiveTrackType(p) === 'serialized' ? visible : available;
    const inCart = cart.items
      .filter((item) =>
        String(item.productId || '') === String(p.productId || p.id || '')
        && String(item.variantId || '') === String(p.variantId || '')
      )
      .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    if (decisionAvailable - inCart <= 0) {
      toast.show('Out of stock for current branch', { type: 'error' });
      return;
    }
    if (getEffectiveTrackType(p) === 'serialized') {
      setSerializedPickerProduct(p);
      serializedPickerKeyRef.current = `${p.productId || p.id || ''}:${p.variantId || ''}`;
      setSerializedUnitsQuery('');
      setSerializedScanInput('');
      setSerializedUnitsPage(1);
      setSerializedUnitsPageSize(25);
      setSerializedUnits([]);
      setSerializedUnitsTotal(0);
      loadSerializedUnits(p, '', 1, 25);
      return;
    }
    const spec = productSpec(p);
    addItemToCart({
      name: p.name,
      brand: p.brand || getProductBrand(p),
      sku: p.sku,
      price: p.price,
      priceTier: selectedPriceTier,
      prices: p.prices || { retail: p.price, wholesale: p.price, warehouse: p.warehousePrice || 0, agent: p.price },
      allowCredit: p.allowCredit !== false,
      minimumCreditPercentage: Number(p.minimumCreditPercentage || 0),
      spec,
      productId: p.productId || p.id,
      variantId: p.variantId || null
    });
  }

  function addPaymentRow() {
    setPayments(p => [...p, { type: 'cash', amount: '' }]);
  }
  function updatePayment(i, field, value) {
    setPayments(p => p.map((row, idx) => idx === i ? { ...row, [field]: value } : row));
  }
  function removePaymentRow(i) {
    setPayments(p => p.filter((_, idx) => idx !== i));
  }

  async function holdCurrentSale() {
    if (cart.items.length === 0) {
      toast.show('Cart is empty', { type: 'error' });
      return;
    }
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `HOLD-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const customerName = selectedCustomer ? (selectedCustomer.name || selectedCustomer.customerCode || 'Customer') : 'Walk-in';
    let label = `${customerName} • ${new Date().toLocaleTimeString()}`;
    try {
      const name = await promptDialog('Enter a label for this held sale (optional)', customerName);
      if (name && String(name).trim()) {
        label = String(name).trim();
      }
    } catch {}
    const payload = {
      id,
      label,
      createdAt: new Date().toISOString(),
      branchId: activeBranchId,
      reservationToken,
      items: cart.items.map(i => ({ ...i })),
      discount: manualDiscount,
      notes: cart.notes || '',
      selectedCustomerId,
      quickCustomerForm: { ...quickCustomerForm },
      redeemPoints,
      taxOverridePct,
      taxOverrideRemark,
      easyBuyEnabled,
      easyBuyAmountPaidNow,
      easyBuyDueDate,
      selectedCreditPackageName: activeCreditPackageName,
      saleDate,
      saleTime,
      saleDateTimeTouched,
      selectedPriceTier,
      payments: payments.map(p => ({ type: p.type, amount: p.amount })),
      view
    };
    addHeldSale(payload);
    clearActiveCart();
    rotateReservationToken();
    setSelectedCustomerId('');
    setCustomerQuery('');
    setQuickCustomerForm({ name: '', phone: '', address: '', customerType: defaultCustomerType });
    setRedeemPoints('');
    setTaxOverridePct('');
    setTaxOverrideRemark('');
    setEasyBuyEnabled(false);
    setEasyBuyAmountPaidNow('');
    setEasyBuyDueDate('');
    setSelectedCreditPackageName('');
    resetSaleDateTime();
    resetSaleDateTime();
    setPayments([{ type: 'cash', amount: '' }]);
    toast.show('Sale held', { type: 'success' });
  }

  async function startNewSale() {
    if (cart.items.length > 0) {
      const ok = await confirmDialog('Clear current cart and start a new sale?');
      if (!ok) return;
    }
    void releaseSerializedCartItems(cart.items);
    clearActiveCart();
    rotateReservationToken();
    setSelectedCustomerId('');
    setCustomerQuery('');
    setQuickCustomerForm({ name: '', phone: '', address: '', customerType: defaultCustomerType });
    setRedeemPoints('');
    setTaxOverridePct('');
    setTaxOverrideRemark('');
    setEasyBuyEnabled(false);
    setEasyBuyAmountPaidNow('');
    setEasyBuyDueDate('');
    resetSaleDateTime();
    setPayments([{ type: 'cash', amount: '' }]);
  }

  async function resumeHeld(h) {
    if (!h) return;
    if (cart.items.length > 0) {
      const ok = await confirmDialog('Replace current cart with held sale?');
      if (!ok) return;
    }
    void releaseSerializedCartItems(cart.items);
    const resumedToken = h.reservationToken || createReservationToken();
    setReservationToken(resumedToken);
    try { localStorage.setItem(reservationStorageKey, resumedToken); } catch {}
    replaceActiveCart({ items: Array.isArray(h.items) ? h.items : [], discount: h.discount || 0, notes: h.notes || '' });
    setSelectedCustomerId(h.selectedCustomerId || '');
    setCustomerQuery(h.selectedCustomerId ? '' : String(h.quickCustomerForm?.name || ''));
    setQuickCustomerForm(h.quickCustomerForm || { name: '', phone: '', address: '', customerType: defaultCustomerType });
    setRedeemPoints(h.redeemPoints || '');
    setTaxOverridePct(h.taxOverridePct ?? '');
    setTaxOverrideRemark(h.taxOverrideRemark ?? '');
    setEasyBuyEnabled(!!h.easyBuyEnabled);
    setEasyBuyAmountPaidNow(h.easyBuyAmountPaidNow || '');
    setEasyBuyDueDate(h.easyBuyDueDate || '');
    setSelectedCreditPackageName(h.selectedCreditPackageName || '');
    setSaleDate(h.saleDate || getLocalSaleDateTimeParts().date);
    setSaleTime(h.saleTime || getLocalSaleDateTimeParts().time);
    setSaleDateTimeTouched(!!h.saleDateTimeTouched);
    setSaleDateTimeEditing(!!h.saleDateTimeTouched);
    setSelectedPriceTier(h.selectedPriceTier || initialPriceTier);
    setPayments(Array.isArray(h.payments) && h.payments.length > 0 ? h.payments.map(p => ({ type: p.type, amount: p.amount })) : [{ type: 'cash', amount: '' }]);
    try { if (h.view) setView(h.view); } catch {}
    removeHeldSale(h.id);
    setHeldOpen(false);
    toast.show('Held sale resumed', { type: 'success' });
  }

  async function deleteHeld(h) {
    if (!h) return;
    const ok = await confirmDialog('Delete this held sale?');
    if (!ok) return;
    setDeletingHeldId(String(h.id || ''));
    void releaseSerializedCartItemsWithToken(h.items || [], h.reservationToken || reservationToken);
    removeHeldSale(h.id);
    toast.show('Held sale removed', { type: 'success' });
    setDeletingHeldId('');
  }
  async function renameHeld(h) {
    if (!h) return;
    let next = null;
    try {
      next = await promptDialog('Rename held sale', h.label || '');
    } catch {}
    if (next == null) return;
    const val = String(next).trim();
    if (!val) return;
    patchHeldSale({ id: h.id, label: val });
    toast.show('Held sale renamed', { type: 'success' });
  }

  async function completeSale(escpos = false) {
    if (saving || completeSaleLockRef.current) return;
    completeSaleLockRef.current = true;
    setSaving(true);
    try {
      if (!easyBuyEnabled && due > 0) {
        toast.show('Payment incomplete', { type: 'error' });
        return;
      }
      if (easyBuyEnabled) {
        const creditPaymentsTotal = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
        const creditPaidNow = Math.max(0, Number(easyBuyAmountPaidNow || 0));
        if (!easyBuyAllowed) {
          toast.show(`${creditModeLabel} requires items in cart`, { type: 'error' });
          return;
        }
        if (!selectedCustomer && !quickCustomerReady) {
          toast.show(`${creditModeLabel} requires customer name, phone, and address`, { type: 'error' });
          return;
        }
        if (easyBuyBlockedItem) {
          toast.show(`${easyBuyBlockedItem.name} is not allowed for ${creditModeLabel.toLowerCase()}`, { type: 'error' });
          return;
        }
        if (!easyBuyDueDate) {
          toast.show(`Select a due date for ${creditModeLabel}`, { type: 'error' });
          return;
        }
        const selectedSaleAt = buildSaleDateTimeValue(saleDate, saleTime);
        const saleDay = toDateInputValue(selectedSaleAt);
        if (saleDay && String(easyBuyDueDate || '') < saleDay) {
          toast.show(`${creditModeLabel} due date cannot be earlier than the sale date`, { type: 'error' });
          return;
        }
        if (creditPaidNow >= (Number(total || 0) - 0.005)) {
          toast.show(`${creditModeLabel} is selected but amount paid now covers the full sale. Please check again and use a normal sale if the customer is paying in full.`, { type: 'error' });
          return;
        }
        if ((Number(easyBuyAmountPaidNow || 0) + 0.0001) < Number(easyBuyMinimum || 0)) {
          toast.show(`Minimum upfront payment is ${formatCurrency(easyBuyMinimum, settings)}`, { type: 'error' });
          return;
        }
        if (Math.abs(creditPaymentsTotal - Number(easyBuyAmountPaidNow || 0)) > 0.005) {
          toast.show(`${creditModeLabel} payment breakdown must equal amount paid now`, { type: 'error' });
          return;
        }
        if (customerMaxCreditLimit > 0 && (customerOutstanding + due) > customerMaxCreditLimit) {
          toast.show('Customer exceeds the configured credit limit', { type: 'error' });
          return;
        }
      }
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return;
        }
      }
      if (canOverrideTax && taxOverridePct !== '' && String(Math.round((taxRate || 0)*100)) !== String(Math.round((settings.taxRate || 0)*100))) {
        if (!taxOverrideRemark.trim()) {
          toast.show('Enter a remark for tax override', { type: 'error' });
          return;
        }
      }
      let checkoutCustomer = selectedCustomer;
      try {
        if (!checkoutCustomer && (easyBuyEnabled || quickCustomerHasAny)) {
          checkoutCustomer = await ensureCheckoutCustomer();
        }
      } catch (e) {
        toast.show(String(e?.message || 'Failed to save customer'), { type: 'error' });
        return;
      }
      const branchName = activeBranch?.name || activeBranchId;
      const saleCapturedAt = new Date().toISOString();
      const selectedSaleAt = buildSaleDateTimeValue(saleDate, saleTime).toISOString();
      const effectiveSaleAt = canBackdateSales && saleDateTimeTouched ? selectedSaleAt : saleCapturedAt;
      const creditPackageName = easyBuyEnabled ? activeCreditPackageName : '';
      const sale = {
      branchId: activeBranchId,
      branchName,
      sellerName: auth.user?.name || 'unknown',
      sellerRole: auth.role || '',
      customerId: checkoutCustomer ? checkoutCustomer.id : '',
      customerCode: checkoutCustomer ? (checkoutCustomer.customerCode || '') : '',
      customerName: checkoutCustomer ? (checkoutCustomer.name || '') : '',
      customerPhone: checkoutCustomer ? (checkoutCustomer.phone || '') : '',
      customerAddress: checkoutCustomer ? (checkoutCustomer.address || '') : '',
      customerBusinessName: checkoutCustomer ? (checkoutCustomer.businessName || '') : '',
      customerBusinessAddress: checkoutCustomer ? (checkoutCustomer.businessAddress || '') : '',
      customerTaxId: checkoutCustomer ? (checkoutCustomer.taxId || '') : '',
      posType: modeLower,
      inventoryType,
      defaultPriceTier: selectedPriceTier,
      loyaltyPointsRedeemed: (settings.loyaltyEnabled && checkoutCustomer) ? redeemable : 0,
      items: cart.items.map(i => ({
        name: i.name,
        brand: i.brand || '',
        sku: i.sku,
        spec: i.spec,
        qty: i.quantity,
        price: i.price,
        priceTier: i.priceTier || selectedPriceTier,
        productId: i.productId,
        variantId: i.variantId || null,
        soldUnitIds: i.unitId ? [i.unitId] : [],
        soldUnits: i.unitId ? [{ unitId: i.unitId, imei: i.imei || '', serialNumber: i.serialNumber || '' }] : []
      })),
      subtotal,
      discount,
      tax,
      total,
      payment_methods: payments.map(p => ({ type: p.type, amount: Number(p.amount) || 0 })),
      creditMode: easyBuyEnabled ? (isNonRetail ? 'distribution_credit' : 'retail_easybuy') : 'none',
      creditPackageId: easyBuyEnabled ? creditPackageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '',
      creditPackageName,
      creditDueDate: easyBuyEnabled ? easyBuyDueDate : undefined,
      creditAmountPaidNow: easyBuyEnabled ? Number(easyBuyAmountPaidNow || 0) : 0,
      creditBalance: easyBuyEnabled ? due : 0,
      outstandingBalance: easyBuyEnabled ? due : 0,
      outstandingTotal: easyBuyEnabled ? due : 0,
      settlementStatus: easyBuyEnabled && due > 0 ? 'incomplete' : 'completed',
      paymentTimeline: easyBuyEnabled
        ? buildCreditUpfrontTimeline(total, estimatedCostTotal, easyBuyAmountPaidNow, effectiveSaleAt)
        : [{
            source: 'sale',
            amount: total,
            principalAmount: total,
            penaltyAmount: 0,
            recognizedCost: Number(estimatedCostTotal || 0),
            recognizedProfit: Number(total || 0) - Number(estimatedCostTotal || 0),
            paidAt: effectiveSaleAt
          }],
      creditSale: easyBuyEnabled ? {
        enabled: true,
        amountPaidNow: Number(easyBuyAmountPaidNow || 0),
        dueDate: easyBuyDueDate,
        creditPackageId: creditPackageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        creditPackageName
      } : undefined,
      status: 'completed',
      created_at: effectiveSaleAt,
      saleCapturedAt,
      saleDateTime: canBackdateSales && saleDateTimeTouched ? selectedSaleAt : undefined,
      reservationToken
      };
      const soldUnitIdsForDebug = cart.items.map((item) => item.unitId).filter(Boolean).map(String);
      let saleForUi = null;
      if (!navigator.onLine) {
        const offlineId = `offline-sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        sale.clientId = offlineId;
        const ref = `OFF-${String(Date.now()).padStart(6, '0').slice(-6)}`;
        try {
          await enqueueHttp({ collection: 'sales', label: 'Sale', path: '/api/sales', method: 'POST', body: sale });
          // #region debug-point A:pos-offline-queued
          reportQueuedSalesImeiDebug({
            hypothesisId: 'A',
            location: 'PosPage.js:completeSale:offline-queued',
            msg: '[DEBUG] POS sale queued offline before local sold mark',
            data: {
              clientId: String(sale?.clientId || ''),
              branchId: String(activeBranchId || ''),
              reservationToken: String(sale?.reservationToken || ''),
              soldUnitIds: soldUnitIdsForDebug,
              hasSerialized: soldUnitIdsForDebug.length > 0
            }
          });
          // #endregion
        } catch (e) {
          toast.show(String(e?.message || 'Failed to save offline'), { type: 'error' });
          return;
        }
        saleForUi = { ...sale, id: offlineId, invoiceSerial: ref, receiptNumber: ref, branchName, offline: true };
      } else {
        sale.clientId = crypto.randomUUID();
        const tmpRef = `TMP-${String(Date.now()).padStart(6, '0').slice(-6)}`;
        saleForUi = { ...sale, id: sale.clientId, invoiceSerial: tmpRef, receiptNumber: tmpRef, branchName };
      }
      // #region debug-point A:tmp-receipt-generated
      reportEbkTmpReceiptDebug({
        hypothesisId: 'A',
        location: 'PosPage.js:completeSale:tmp-receipt-generated',
        msg: '[DEBUG] POS generated local receipt references before remote sale confirmation',
        data: {
          clientId: String(sale?.clientId || ''),
          branchId: String(activeBranchId || ''),
          offline: !navigator.onLine,
          inventoryType: String(inventoryType || ''),
          receiptNumber: String(saleForUi?.receiptNumber || ''),
          invoiceSerial: String(saleForUi?.invoiceSerial || ''),
          itemCount: Array.isArray(sale?.items) ? sale.items.length : 0,
          hasSerialized: soldUnitIdsForDebug.length > 0
        }
      });
      // #endregion
      const receiptHtml = buildBrandedReceiptHtml({ settings, sale: saleForUi });
      const affectedProductIds = Array.from(new Set(cart.items.map(i => i.productId).filter(Boolean)));
      cart.items.forEach(i => {
        if (i.productId) {
          dispatch(adjustStock({ productId: i.productId, variantId: i.variantId || null, branchId: activeBranchId, inventoryType, delta: -i.quantity }));
        }
      });
      dispatch(recordSale(saleForUi));
      let invoiceForPrint = null;
      try {
      const payTerms = (saleForUi.payment_methods || [])
        .map(p => {
          const t = String(p.type || '').toLowerCase();
          if (t === 'cash') return 'Cash';
          if (t === 'card') return 'Card';
          if (t === 'mobile' || t === 'momo' || t === 'mobile money') return 'Mobile Money';
          if (t === 'wallet') return 'Wallet';
          return t ? (t[0].toUpperCase() + t.slice(1)) : 'Cash';
        })
        .join(', ');
      const invoicePrefix = isWholesale
        ? (settings.wholesaleInvoicePrefix || 'WINV')
        : isWarehouse
          ? (settings.warehouseInvoicePrefix || 'WHINV')
          : (settings.invoicePrefix || 'INV');
      const nextInvoiceNumber = isWholesale
        ? Number(settings.nextWholesaleInvoiceNumber || 1)
        : isWarehouse
          ? Number(settings.nextWarehouseInvoiceNumber || 1)
          : Number(settings.nextInvoiceNumber || 1);
      const invNumber = saleForUi.invoiceSerial || `${invoicePrefix}-${String(nextInvoiceNumber).padStart(Number(settings.invoiceNumberDigits || 6), '0')}`;
      const inv = {
        number: invNumber,
        date: saleForUi.created_at || new Date().toISOString(),
        saleId: saleForUi.id || saleForUi._id || '',
        paymentStatus: easyBuyEnabled ? 'active' : 'paid',
        source: isWholesale ? 'wholesale-pos' : isWarehouse ? 'warehouse-pos' : 'pos',
        customer: checkoutCustomer ? {
          name: checkoutCustomer.name || '',
          phone: checkoutCustomer.phone || '',
          email: checkoutCustomer.email || '',
          address: checkoutCustomer.address || '',
          businessName: checkoutCustomer.businessName || '',
          businessAddress: checkoutCustomer.businessAddress || '',
          taxId: checkoutCustomer.taxId || '',
          customerCode: checkoutCustomer.customerCode || '',
          customerId: checkoutCustomer.id
        } : (saleForUi.customerName ? {
          name: saleForUi.customerName,
          phone: saleForUi.customerPhone || '',
          address: saleForUi.customerAddress || '',
          businessName: saleForUi.customerBusinessName || '',
          businessAddress: saleForUi.customerBusinessAddress || '',
          taxId: saleForUi.customerTaxId || ''
        } : { name: '—' }),
        items: (saleForUi.items || []).map(i => ({ name: i.name, spec: i.spec, qty: i.qty, rate: i.price, per: 'pcs', soldUnits: Array.isArray(i.soldUnits) ? i.soldUnits : [] })),
        subtotal: saleForUi.subtotal || 0,
        tax: saleForUi.tax || 0,
        total: saleForUi.total || 0,
        deliveryNote: 'Physical',
        paymentTerms: payTerms,
        supplierRef: '',
        otherRef: '',
        buyerOrderNo: '',
        despatchDocNo: '',
        deliveryDate: '',
        despatchedThrough: 'In person',
        destination: '',
        termsOfDelivery: ''
      };
        invoiceForPrint = inv;
        dispatch(addInvoice(inv));
      } catch {}
      if (navigator.onLine && checkoutCustomer && saleForUi.customerPointsAfter != null) {
        dispatch(updateCustomer({ id: checkoutCustomer.id, loyaltyPoints: Number(saleForUi.customerPointsAfter || 0) }));
      }
      dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: isWholesale ? 'stock_wholesale_sale_deduct' : isWarehouse ? 'stock_warehouse_sale_deduct' : 'stock_sale_deduct',
      details: { items: sale.items.map(it => ({ sku: it.sku, qty: it.qty, priceTier: it.priceTier || selectedPriceTier })), branchId: activeBranchId, mode: modeLower },
      branchId: activeBranchId,
      offline: !navigator.onLine
    }));
    if (canOverrideTax && taxOverridePct !== '' && String(Math.round((taxRate || 0)*100)) !== String(Math.round((settings.taxRate || 0)*100))) {
      dispatch(addAudit({
        actor: auth.user?.name || 'unknown',
        actionType: 'pos_tax_override',
        details: { from: Math.round((settings.taxRate || 0) * 100), to: Math.round(taxRate * 100) },
        remark: taxOverrideRemark,
        branchId: activeBranchId,
        offline: !navigator.onLine
      }));
    }
      dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: easyBuyEnabled ? 'credit_sale_complete' : 'sale_complete',
      details: { total: sale.total, items: sale.items.length, mode: modeLower, easyBuy: easyBuyEnabled, branchId: activeBranchId },
      branchId: activeBranchId,
      offline: !navigator.onLine
    }));
      clearActiveCart();
      rotateReservationToken();
      setSelectedCustomerId('');
      setCustomerQuery('');
      setQuickCustomerForm({ name: '', phone: '', address: '', customerType: defaultCustomerType });
      setRedeemPoints('');
      setEasyBuyEnabled(false);
      setEasyBuyAmountPaidNow('');
      setEasyBuyDueDate('');
      resetSaleDateTime();
      if (escpos) {
        const text = escposReceipt({
        header: { title: settings.appName, store: settings.receiptHeader, branch: branchName, phone: settings.businessPhone || '', cashier: saleForUi.sellerName, customer: saleForUi.customerName ? `${saleForUi.customerName}${saleForUi.customerCode ? ` (${saleForUi.customerCode})` : ''}` : '', receiptId: saleForUi.id || saleForUi._id, receiptNumber: saleForUi.receiptNumber, invoiceSerial: saleForUi.invoiceSerial },
        items: saleForUi.items,
        totals: { subtotal, discount, tax, total },
        footer: { note: settings.receiptFooter },
        settings,
        sale: saleForUi
      });
        downloadText('receipt-escpos.txt', (settings.drawerOpenOnCash && payments.some(p => p.type === 'cash')) ? (escposOpenDrawer() + '\n' + text) : text);
      } else {
        // #region debug-point B:before-receipt-print
        reportEbkTmpReceiptDebug({
          hypothesisId: 'B',
          location: 'PosPage.js:completeSale:before-receipt-print',
          msg: '[DEBUG] POS is about to print local receipt before online sale confirmation',
          data: {
            clientId: String(sale?.clientId || ''),
            branchId: String(activeBranchId || ''),
            receiptNumber: String(saleForUi?.receiptNumber || ''),
            invoiceSerial: String(saleForUi?.invoiceSerial || ''),
            printMode: String(posDefaultPrintMode || 'receipt'),
            isNonRetail: !!isNonRetail
          }
        });
        // #endregion
        if (isNonRetail) {
          if (posDefaultPrintMode === 'invoice' && invoiceForPrint) {
            printInvoiceA4(buildInvoiceA4Html({ settings, invoice: invoiceForPrint }));
          } else if (posDefaultPrintMode === 'both' && invoiceForPrint) {
            printInvoiceA4(buildInvoiceA4Html({ settings, invoice: invoiceForPrint }));
            printReceiptHtml(receiptHtml);
          } else {
            printReceiptHtml(receiptHtml);
          }
        } else {
          printReceiptHtml(receiptHtml);
        }
      }
      if (navigator.onLine) {
        try {
          const saved = await createSale({ ...sale, clientId: sale.clientId });
          if (saved && (saved.invoiceSerial || saved.receiptNumber)) {
            // no-op: printed already; server holds the official refs
          }
          // #region debug-point C:online-save-succeeded
          reportEbkTmpReceiptDebug({
            hypothesisId: 'C',
            location: 'PosPage.js:completeSale:online-save-succeeded',
            msg: '[DEBUG] POS online sale save completed after local print path',
            data: {
              clientId: String(sale?.clientId || ''),
              serverSaleId: String(saved?._id || saved?.id || ''),
              serverReceiptNumber: String(saved?.receiptNumber || ''),
              serverInvoiceSerial: String(saved?.invoiceSerial || ''),
              branchId: String(activeBranchId || ''),
              hasSerialized: soldUnitIdsForDebug.length > 0
            }
          });
          // #endregion
          // #region debug-point B:pos-online-sale-saved
          reportQueuedSalesImeiDebug({
            hypothesisId: 'B',
            location: 'PosPage.js:completeSale:online-create-success',
            msg: '[DEBUG] POS online sale saved before local serialized cache mark',
            data: {
              clientId: String(sale?.clientId || ''),
              serverSaleId: String(saved?._id || saved?.id || ''),
              branchId: String(activeBranchId || ''),
              soldUnitIds: soldUnitIdsForDebug,
              hasSerialized: soldUnitIdsForDebug.length > 0
            }
          });
          // #endregion
          productUnitsApi.markSoldProductUnits(soldUnitIdsForDebug);
          void refreshAffectedProducts(dispatch, affectedProductIds);
          toast.show('Sale recorded', { type: 'success' });
        } catch (e) {
          // #region debug-point A:tamale-online-save-failed
          reportQuantityQueueTamaleDebug({
            hypothesisId: 'A',
            location: 'PosPage.js:completeSale:online-save-failed-before-queue',
            msg: '[DEBUG] POS online sale save failed before queue fallback decision',
            data: {
              clientId: String(sale?.clientId || ''),
              branchId: String(activeBranchId || ''),
              branchName: String(branchName || ''),
              online: typeof navigator !== 'undefined' ? !!navigator.onLine : null,
              status: Number(e?.status || 0),
              error: String(e?.message || ''),
              errorData: e?.data || null,
              hasSerialized: soldUnitIdsForDebug.length > 0,
              itemCount: Array.isArray(sale?.items) ? sale.items.length : 0
            }
          });
          // #endregion
          try {
            await enqueueHttp({ collection: 'sales', label: 'Sale', path: '/api/sales', method: 'POST', body: { ...sale, clientId: sale.clientId } });
            // #region debug-point A:tamale-queue-fallback
            reportQuantityQueueTamaleDebug({
              hypothesisId: 'A',
              location: 'PosPage.js:completeSale:queued-after-save-failure',
              msg: '[DEBUG] POS queued sale after online save failure',
              data: {
                clientId: String(sale?.clientId || ''),
                branchId: String(activeBranchId || ''),
                branchName: String(branchName || ''),
                online: typeof navigator !== 'undefined' ? !!navigator.onLine : null,
                createSaleStatus: Number(e?.status || 0),
                createSaleError: String(e?.message || ''),
                hasSerialized: soldUnitIdsForDebug.length > 0,
                itemCount: Array.isArray(sale?.items) ? sale.items.length : 0
              }
            });
            // #endregion
            // #region debug-point D:online-save-fell-back-to-queue
            reportEbkTmpReceiptDebug({
              hypothesisId: 'D',
              location: 'PosPage.js:completeSale:online-save-fell-back-to-queue',
              msg: '[DEBUG] POS online sale save failed after print and fell back to queue',
              data: {
                clientId: String(sale?.clientId || ''),
                branchId: String(activeBranchId || ''),
                reservationToken: String(sale?.reservationToken || ''),
                error: String(e?.message || ''),
                hasSerialized: soldUnitIdsForDebug.length > 0
              }
            });
            // #endregion
            // #region debug-point A:pos-online-fallback-queued
            reportQueuedSalesImeiDebug({
              hypothesisId: 'A',
              location: 'PosPage.js:completeSale:online-fallback-queued',
              msg: '[DEBUG] POS online sale fell back to queue before local serialized cache mark',
              data: {
                clientId: String(sale?.clientId || ''),
                branchId: String(activeBranchId || ''),
                reservationToken: String(sale?.reservationToken || ''),
                createSaleError: String(e?.message || ''),
                soldUnitIds: soldUnitIdsForDebug,
                hasSerialized: soldUnitIdsForDebug.length > 0
              }
            });
            // #endregion
            productUnitsApi.markSoldProductUnits(soldUnitIdsForDebug);
            toast.show(sale.items.some(item => Array.isArray(item.soldUnitIds) && item.soldUnitIds.length > 0) ? 'Saved offline. Serialized IMEI sale will sync later and conflicts will be flagged if found.' : 'Network issue: saved offline and will sync later', { type: 'warning' });
          } catch (err) {
            // #region debug-point E:online-save-and-queue-both-failed
            reportEbkTmpReceiptDebug({
              hypothesisId: 'E',
              location: 'PosPage.js:completeSale:online-save-and-queue-both-failed',
              msg: '[DEBUG] POS online sale save failed after print and queue fallback also failed',
              data: {
                clientId: String(sale?.clientId || ''),
                branchId: String(activeBranchId || ''),
                createSaleError: String(e?.message || ''),
                queueError: String(err?.message || ''),
                hasSerialized: soldUnitIdsForDebug.length > 0
              }
            });
            // #endregion
            await releaseSerializedCartItems(cart.items);
            cart.items.forEach(i => {
              if (i.productId) {
                dispatch(adjustStock({ productId: i.productId, variantId: i.variantId || null, branchId: activeBranchId, inventoryType, delta: i.quantity, syncPending: false }));
              }
            });
            toast.show(String(e?.message || 'Failed to record sale'), { type: 'error' });
          }
        }
      } else {
        // #region debug-point A:pos-offline-local-sold
        reportQueuedSalesImeiDebug({
          hypothesisId: 'A',
          location: 'PosPage.js:completeSale:offline-local-mark-sold',
          msg: '[DEBUG] POS offline sale marking serialized units sold locally',
          data: {
            clientId: String(sale?.clientId || ''),
            branchId: String(activeBranchId || ''),
            reservationToken: String(sale?.reservationToken || ''),
            soldUnitIds: soldUnitIdsForDebug,
            hasSerialized: soldUnitIdsForDebug.length > 0
          }
        });
        // #endregion
        productUnitsApi.markSoldProductUnits(soldUnitIdsForDebug);
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
      }
    } finally {
      completeSaleLockRef.current = false;
      setSaving(false);
    }
  }

  async function submitMainSearch() {
    const q = query.trim();
    if (!q) return;
    if (reservingSerializedKeys.includes(q)) {
      toast.show('Serialized item is already being added', { type: 'error' });
      return;
    }
    if (cart.items.some(item => String(item.imei || '').trim() === q || String(item.serialNumber || '').trim() === q)) {
      toast.show('Serialized item already selected in cart', { type: 'error' });
      return;
    }
    const exact = sellables.find(p =>
      (p.barcode && p.barcode === q) ||
      p.sku.toLowerCase() === q.toLowerCase()
    );
    if (exact) {
      await addToCart(exact);
      setQuery('');
      return;
    }
    try {
      let unit = null;
      let exactLookupFound = false;
      try {
        const lookedUp = await productUnitsApi.lookupProductUnit(q);
        if (!lookedUp) throw new Error('Serialized unit not found');
        exactLookupFound = true;
        if (String(lookedUp.branchId || '') !== String(activeBranchId || '')) {
          const unitBranch = (branches || []).find((branch) => String(branch.id) === String(lookedUp.branchId || ''));
          toast.show(`Serialized item exists in ${unitBranch?.name || 'another branch'}, not in the current branch`, { type: 'error' });
          return;
        }
        const expectedInventoryType = inventoryType;
        if (String(lookedUp.inventoryType || 'retail') !== expectedInventoryType) {
          toast.show(`Serialized item exists under ${String(lookedUp.inventoryType || 'retail')} inventory, not ${expectedInventoryType}`, { type: 'error' });
          return;
        }
        if (['sold', 'adjusted_out'].includes(String(lookedUp.status || ''))) {
          toast.show('Serialized item is already sold or unavailable', { type: 'error' });
          return;
        }
        unit = await productUnitsApi.reserveProductUnit({
          unitId: lookedUp._id,
          code: q,
          branchId: activeBranchId,
          inventoryType: expectedInventoryType,
          reservationToken
        });
      } catch (exactError) {
        if (exactLookupFound) {
          toast.show(String(exactError?.message || 'Failed to reserve serialized item'), { type: 'error' });
          return;
        }
        const result = await productUnitsApi.listProductUnits({
          branchId: activeBranchId,
          inventoryType,
          status: 'in_stock',
          query: q,
          page: 1,
          pageSize: 100
        });
        const rows = Array.isArray(result?.rows) ? result.rows : [];
        const normalized = q.toLowerCase();
        const exactMatches = rows.filter((row) => String(row.imei || '').toLowerCase() === normalized || String(row.serialNumber || '').toLowerCase() === normalized);
        const suffixMatches = rows.filter((row) => normalized.length >= 4 && (String(row.imei || '').toLowerCase().endsWith(normalized) || String(row.serialNumber || '').toLowerCase().endsWith(normalized)));
        const candidates = exactMatches.length > 0 ? exactMatches : suffixMatches.length > 0 ? suffixMatches : rows;
        if (candidates.length === 0) {
          toast.show('No product found for that barcode, IMEI, or serial number', { type: 'error' });
          return;
        }
        if (candidates.length > 1) {
          toast.show(`Found ${candidates.length} serialized matches. Enter more digits to narrow it down.`, { type: 'error' });
          return;
        }
        [unit] = candidates;
      }
      const product = sellables.find(p =>
        String(p.productId || p.id) === String(unit?.productId)
        && String(p.variantId || '') === String(unit?.variantId || '')
      );
      if (!product) {
        if (unit?._id) void productUnitsApi.releaseProductUnits({ unitIds: [unit._id].filter(Boolean), reservationToken });
        toast.show('Serialized unit exists, but the product is not available in this POS view', { type: 'error' });
        return;
      }
      await addSerializedUnitToCart(product, unit);
      setQuery('');
    } catch (e) {
      toast.show(String(e?.message || 'No product found for that barcode, IMEI, or serial number'), { type: 'error' });
    }
  }

  async function onSearchKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      await submitMainSearch();
    }
  }

  function renderHighlightedCode(value, searchValue) {
    const text = String(value || '');
    const needle = String(searchValue || '').trim();
    if (!text || !needle) return text || '—';
    const lowerText = text.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    const start = lowerText.indexOf(lowerNeedle);
    if (start === -1) return text;
    const end = start + needle.length;
    return (
      <>
        {text.slice(0, start)}
        <span style={{ background: '#fef3c7', color: '#92400e', padding: '0 2px', borderRadius: 4, fontWeight: 700 }}>
          {text.slice(start, end)}
        </span>
        {text.slice(end)}
      </>
    );
  }

  return (
    <div className="pos-layout">
      <div className="pos-products-pane">
        <div className="pos-sticky-search">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 style={{ marginBottom: 4 }}>{modeLabel}</h2>
              <div style={{ color: '#64748b', fontSize: 12 }}>
                {isWholesale
                  ? `${t('Distribution inventory')}${branchLabel ? ` • ${branchLabel}` : missingInventoryBranch ? ` • ${t(missingInventoryBranchText)}` : ''}`
                  : isWarehouse
                    ? `${t('Warehouse inventory')}${branchLabel ? ` • ${branchLabel}` : missingInventoryBranch ? ` • ${t(missingInventoryBranchText)}` : ''}`
                    : `${t('Retail inventory')}${branchLabel ? ` • ${branchLabel}` : ''} ${t('with Credit support')}`}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto', flexWrap: 'nowrap' }}>
              <OfflineQueueIndicator collection="sales" label={t('Sales queued')} />
              {isNonRetail ? (
                <div className="filter-actions" style={{ flexWrap: 'nowrap' }}>
                  <button className={`btn-toggle ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} aria-label={t('Card view')} title={t('Card view')}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" strokeWidth="2"/></svg>
                  </button>
                  <button className={`btn-toggle ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} aria-label={t('List view')} title={t('List view')}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2"/></svg>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="toolbar pos-toolbar">
            <input className="input pos-toolbar-search" placeholder={t('Search name, brand, SKU, barcode, IMEI, or serial number')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKeyDown} />
            <FilterSearchSelect
              className="pos-toolbar-filter"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={categoryOptions}
              allLabel={t('All Categories')}
              searchPlaceholder={t('Type category')}
            />
            <FilterSearchSelect
              className="pos-toolbar-filter"
              value={brandFilter}
              onChange={setBrandFilter}
              options={brandOptions}
              allLabel={t('All Brands')}
              searchPlaceholder={t('Type brand')}
            />
            <FilterSearchSelect
              className="pos-toolbar-filter"
              value={trackTypeFilter}
              onChange={setTrackTypeFilter}
              options={trackTypeOptions}
              allLabel={t('All Types')}
              searchPlaceholder={t('Type product type')}
            />
            {isNonRetail && (
            <select className="select pos-toolbar-tier" value={selectedPriceTier} onChange={e => setSelectedPriceTier(e.target.value)}>
              {allowedPriceTiers.map(tier => <option key={tier} value={tier}>{getPriceTierLabel(tier)}</option>)}
            </select>
            )}
            {!isNonRetail ? (
              <div className="filter-actions pos-toolbar-actions">
                <button className={`btn-toggle ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} aria-label={t('Card view')} title={t('Card view')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" strokeWidth="2"/></svg>
                </button>
                <button className={`btn-toggle ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')} aria-label={t('List view')} title={t('List view')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2"/></svg>
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="pos-products-scroll">
        {missingInventoryBranch && (
          <div className="card" style={{ marginTop: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a' }}>
            {isWarehouse
              ? t('Create a warehouse branch first before using Warehouse POS or recording warehouse stock.')
              : t('Create a distribution branch first before using Distribution POS or recording distribution stock.')}
          </div>
        )}
        {!missingInventoryBranch && query.trim().length >= 4 && (
          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <strong>{t('Serialized Matches')}</strong>
              {liveSerializedLoading ? <InlineSpinner label={t('Searching IMEI / serial...')} /> : null}
            </div>
            {liveSerializedMatches.length > 0 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {liveSerializedMatches.map(({ unit, product, matchLabel }) => (
                  <div key={String(unit._id || `${unit.imei || ''}-${unit.serialNumber || ''}`)} className="card" style={{ padding: 10, border: '1px solid #e2e8f0', boxShadow: 'none', background: '#fcfdff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, display: 'flex', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', flexShrink: 0 }}
                          />
                        ) : null}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                            <div style={{ fontWeight: 800 }}>{product.name}</div>
                            {product.brand ? <span style={{ color: '#64748b', fontSize: 12 }}>{product.brand}</span> : null}
                            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#dbeafe', color: '#1d4ed8' }}>{matchLabel}</span>
                            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#ecfccb', color: '#3f6212' }}>
                              {branchNameById.get(String(unit.branchId || '')) || activeBranch?.name || 'Branch'}
                            </span>
                            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: String(unit.inventoryType || 'retail') === 'wholesale' ? '#ede9fe' : String(unit.inventoryType || 'retail') === 'warehouse' ? '#e0f2fe' : '#fee2e2', color: String(unit.inventoryType || 'retail') === 'wholesale' ? '#5b21b6' : String(unit.inventoryType || 'retail') === 'warehouse' ? '#0c4a6e' : '#991b1b' }}>
                              {String(unit.inventoryType || 'retail')}
                            </span>
                          </div>
                          {productSpec(product) ? <div style={{ color: '#64748b', fontSize: 12 }}>{productSpec(product)}</div> : null}
                          <div style={{ color: '#64748b', fontSize: 12 }}>{t('SKU')}: {product.sku}</div>
                          {Array.isArray(product.attributes) && product.attributes.length > 0 ? (
                            <div style={{ color: '#64748b', fontSize: 12 }}>
                              {product.attributes
                                .filter(attr => String(attr?.key || '').trim() && String(attr?.value || '').trim())
                                .slice(0, 3)
                                .map(attr => `${attr.key}: ${attr.value}`)
                                .join(' • ')}
                            </div>
                          ) : null}
                          <div style={{ color: '#64748b', fontSize: 12 }}>{t('IMEI')}: {renderHighlightedCode(unit.imei || '—', query)}</div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>{t('Serial')}: {renderHighlightedCode(unit.serialNumber || '—', query)}</div>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                        <div style={{ fontWeight: 800, fontSize: 18 }}>{formatCurrency(product.price, settings)}</div>
                        {isSerializedAlreadyInCart(unit) ? (
                          <span style={{ color: '#b45309', fontSize: 12, fontWeight: 700 }}>{t('Already in cart')}</span>
                        ) : null}
                        <button
                          className="btn btn-primary"
                          onClick={() => addSerializedUnitToCart(product, unit)}
                          disabled={isSerializedAlreadyInCart(unit) || isSerializedPending(unit)}
                        >
                          {isSerializedAlreadyInCart(unit) ? t('Selected') : isSerializedPending(unit) ? t('Adding...') : t('Add Unit')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !liveSerializedLoading ? (
              <div style={{ color: '#64748b', fontSize: 13 }}>
                {t('No serialized matches found in the current branch yet. Keep typing more digits if needed.')}
              </div>
            ) : null}
          </div>
        )}
        {view === 'grid' ? (
          <div className="product-grid">
            {filtered.map(p => (
              <button key={p.id} onClick={() => addToCart(p)} className="product-card">
                {p.image && <img src={p.image} alt={p.name} className="product-img" />}
                <div className="product-name">{p.name}</div>
                {p.variantLabel ? <div className="product-sku" style={{ color: '#64748b' }}>Variant: {p.variantLabel}</div> : null}
                {p.brand ? <div className="product-sku" style={{ color: '#64748b' }}>{p.brand}</div> : null}
                {productSpec(p) && <div className="product-sku" style={{ color: '#64748b' }}>{productSpec(p)}</div>}
                <div className="product-sku">{p.sku}</div>
                <div className="product-price">{formatCurrency(p.price, settings)}</div>
                <div className="product-stock" style={{ color: getVisibleStockBadge(p).color }}>
                  {getVisibleStockBadge(p).text}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="product-list">
            {filtered.map(p => (
              <button key={p.id} onClick={() => addToCart(p)} className="product-list-item">
                {p.image ? <img src={p.image} alt={p.name} className="thumb" /> : <div className="thumb-placeholder">---</div>}
                <div className="meta">
                  <div className="details">
                    <div className="title">{p.name}</div>
                    {p.variantLabel ? <div className="sku" style={{ color: '#64748b' }}>Variant: {p.variantLabel}</div> : null}
                    {p.brand ? <div className="sku" style={{ color: '#64748b' }}>{p.brand}</div> : null}
                    {productSpec(p) && <div className="sku" style={{ color: '#64748b' }}>{productSpec(p)}</div>}
                    <div className="sku">{p.sku}</div>
                  </div>
                  <div className="stock" style={{ color: getVisibleStockBadge(p).color }}>
                    {getVisibleStockBadge(p).text}
                  </div>
                </div>
                <div className="price">{formatCurrency(p.price, settings)}</div>
              </button>
            ))}
          </div>
        )}
        </div>
      </div>
      <div className="pos-cart-pane">
        <div className="pos-cart-sticky">
        <div className="pos-cart-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{t('Cart')}</h2>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {heldUiEnabled && (
                <>
                  <button className="btn" onClick={holdCurrentSale} disabled={cart.items.length === 0 || saving}>
                    <svg viewBox="0 0 24 24" fill="none"><path d="M6 6h12v12H6z" stroke="currentColor" strokeWidth="2"/><path d="M9 6v12M15 6v12" stroke="currentColor" strokeWidth="2"/></svg>
                    {t('Hold')}
                  </button>
                  <button className="btn" onClick={() => { setDiscountOpen(false); setHeldOpen(o => !o); }}>
                    <svg viewBox="0 0 24 24" fill="none"><path d="M7 7h10M7 12h10M7 17h10" stroke="currentColor" strokeWidth="2"/></svg>
                    {t('Held')} ({heldSales.length})
                  </button>
                </>
              )}
              <button className="btn" onClick={() => { setHeldOpen(false); setDiscountOpen(o => !o); }}>
                <svg viewBox="0 0 24 24" fill="none"><path d="M5 6h14v4H5z" stroke="currentColor" strokeWidth="2"/><path d="M8 10v8M16 10v8M5 18h14" stroke="currentColor" strokeWidth="2"/></svg>
                {t('Discount')} ({discountRequestList.length})
              </button>
              <button className="btn" onClick={startNewSale}>
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
                {t('New Sale')}
              </button>
            </div>
            {heldUiEnabled && heldOpen && (
              <div style={{ position: 'absolute', right: 0, marginTop: 6, width: 360, maxWidth: '90vw', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 10px 20px rgba(2,6,23,0.15)', zIndex: 30 }}>
                <div style={{ padding: 10, borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>{t('Held Sales')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, padding: 10, borderBottom: '1px solid #e2e8f0', alignItems: 'center' }}>
                  <input className="input" placeholder={t('Search label or customer')} value={heldQuery} onChange={e => onChangeHeldQuery(e.target.value)} />
                  <label style={{ color: '#64748b', fontSize: 12 }}>{t('Sort')}</label>
                  <select className="select" value={heldSort} onChange={e => onChangeHeldSort(e.target.value)} style={{ flex: '1 1 auto' }}>
                    <option value="newest">{t('Newest first')}</option>
                    <option value="oldest">{t('Oldest first')}</option>
                    <option value="labelAZ">{t('Label A-Z')}</option>
                    <option value="labelZA">{t('Label Z-A')}</option>
                  </select>
                </div>
                <div style={{ maxHeight: 320, overflow: 'auto' }}>
                  {heldList.map(h => (
                    <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: 8, padding: 10, borderTop: '1px solid #f1f5f9', opacity: deletingHeldId === String(h.id || '') ? 0.55 : 1 }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{h.label || 'Held sale'}</div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>{new Date(h.createdAt).toLocaleString()} • {t('Items')}: {Array.isArray(h.items) ? h.items.length : 0}</div>
                      </div>
                      <button className="btn" onClick={() => renameHeld(h)} disabled={deletingHeldId === String(h.id || '')}>{t('Rename')}</button>
                      <button className="btn" onClick={() => resumeHeld(h)} disabled={deletingHeldId === String(h.id || '')}>{t('Resume')}</button>
                      <button className="btn" onClick={() => deleteHeld(h)} disabled={deletingHeldId === String(h.id || '')}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {deletingHeldId === String(h.id || '') && <InlineSpinner />}
                          {deletingHeldId === String(h.id || '') ? t('Deleting...') : t('Delete')}
                        </span>
                      </button>
                    </div>
                  ))}
                  {heldList.length === 0 && <div style={{ padding: 12, color: '#64748b' }}>{t('No held sales')}</div>}
                </div>
              </div>
            )}
            {discountOpen && (
              <div style={{ position: 'absolute', right: 0, marginTop: 6, width: 420, maxWidth: '92vw', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 10px 20px rgba(2,6,23,0.15)', zIndex: 30 }}>
                <div style={{ padding: 10, borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>{t('Discount Sales')}</div>
                <div style={{ maxHeight: 360, overflow: 'auto' }}>
                  {discountLoading && <div style={{ padding: 12, color: '#64748b' }}>{t('Loading...')}</div>}
                  {!discountLoading && discountRequestList.map((row) => {
                    const id = String(row?._id || '');
                    const isApproved = String(row?.status || '') === 'approved';
                    const isRejected = String(row?.status || '') === 'rejected';
                    const isWorking = discountWorkingId === id;
                    return (
                      <div key={id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: 10, borderTop: '1px solid #f1f5f9', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{row?.customerName || 'Walk-in customer'}</div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>
                            {new Date(row?.createdAt || Date.now()).toLocaleString()} • {formatCurrency(row?.total || 0, settings)} • {String(row?.status || '').replace('_', ' ')}
                          </div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>
                            {t('Discount')}: {formatCurrency(row?.discount || 0, settings)}{row?.approvedByName ? ` • ${t('Approver')}: ${row.approvedByName}` : row?.rejectedByName ? ` • ${t('Approver')}: ${row.rejectedByName}` : ''}
                          </div>
                          {row?.rejectionRemark ? (
                            <div style={{ color: '#b91c1c', fontSize: 12 }}>{t('Remark')}: {row.rejectionRemark}</div>
                          ) : null}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-primary" onClick={() => completeApprovedDiscountRequest(row)} disabled={(!isApproved && !isRejected) || isWorking}>
                            {isWorking ? t('Processing...') : t('Complete')}
                          </button>
                          {isRejected ? (
                            <button className="btn" onClick={() => cancelRejectedDiscountRequest(row)} disabled={isWorking}>
                              {isWorking ? t('Processing...') : t('Cancel')}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {!discountLoading && discountRequestList.length === 0 && <div style={{ padding: 12, color: '#64748b' }}>{t('No discount requests')}</div>}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="card pos-customer-card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 700 }}>{t('Customer (optional)')}</div>
          </div>
          {selectedCustomer ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{selectedCustomer.name}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>
                    {selectedCustomer.customerCode || '—'} {selectedCustomer.phone ? `• ${selectedCustomer.phone}` : ''}
                  </div>
                  {(selectedCustomer.idType || selectedCustomer.idCardNumber) ? (
                    <div style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>
                      ID: <strong>{selectedCustomer.idType || '—'}</strong>{selectedCustomer.idCardNumber ? ` • ${selectedCustomer.idCardNumber}` : ''}
                    </div>
                  ) : null}
                </div>
                <button
                  className="btn"
                  aria-label={t('Remove selected customer')}
                  title={t('Remove selected customer')}
                  onClick={() => { setSelectedCustomerId(''); setCustomerQuery(''); }}
                  style={{ width: 32, height: 32, padding: 0, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  X
                </button>
              </div>
              <div style={{ display: 'grid', gap: 4, color: '#475569', fontSize: 13 }}>
                <div>{t('Credit Rank')}: <strong>{selectedCustomer.creditRank || 'Bronze'}</strong> • {t('Score')}: <strong>{customerCreditScore}</strong></div>
                <div>{t('Outstanding')}: <strong>{formatCurrency(customerOutstanding, settings)}</strong></div>
                <div>{t('On-time')}: <strong>{Number(selectedCustomer.onTimePayments || 0)}</strong> • {t('Late')}: <strong>{Number(selectedCustomer.latePayments || 0)}</strong></div>
              </div>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <div>
                <input
                  className="input"
                  placeholder={t('Search by phone, customer ID, name, ID card or enter new customer name')}
                  value={customerQuery}
                  onChange={e => updateCustomerLookup(e.target.value)}
                />
                {customerMatches.length > 0 && (
                  <div style={{ position: 'absolute', top: 44, left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', zIndex: 20 }}>
                    {customerMatches.map(c => (
                      <button
                        key={c.id}
                        className="btn"
                        onClick={() => {
                          setSelectedCustomerId(c.id);
                          setCustomerQuery('');
                          setQuickCustomerForm((prev) => ({ ...prev, name: '' }));
                        }}
                        style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0 }}
                      >
                        <span style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 700 }}>{c.name}</div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>{c.customerCode || '—'} {c.phone ? `• ${c.phone}` : ''}</div>
                        </span>
                        <span>{t('Select')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {canQuickAddCustomer ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                  <div>
                    <input className="input" value={quickCustomerForm.phone} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder={t('Phone number')} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <input className="input" value={quickCustomerForm.address} onChange={(e) => setQuickCustomerForm((prev) => ({ ...prev, address: e.target.value }))} placeholder={t('Address')} />
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
        </div>
        <div className="pos-cart-scroll">
        <ul className="cart-list">
          {cart.items.map(item => (
            <li key={item.id} className="cart-item">
              <div className="cart-title">
                <div>{item.name}</div>
                {item.brand ? <small style={{ color: '#64748b' }}>{item.brand}</small> : null}
                {item.spec && <small style={{ color: '#64748b' }}>{item.spec}</small>}
                <small>{item.sku}</small>
                {item.imei ? <small style={{ color: '#1d4ed8', fontWeight: 700 }}>IMEI: {item.imei}</small> : null}
                {item.serialNumber ? <small style={{ color: '#64748b' }}>Serial: {item.serialNumber}</small> : null}
              </div>
              <input
                className="input"
                type="number"
                min="1"
                value={item.quantity}
                onChange={e => {
                  if (item.unitId) return;
                  setCartItemQuantity(item.id, Number(e.target.value));
                }}
                style={{ width: 70 }}
                disabled={!!item.unitId}
              />
              <div style={{ display: 'grid', gap: 6 }}>
                {isNonRetail ? (
                <>
                <select
                  className="select"
                  value={item.priceTier || selectedPriceTier}
                  onChange={e => {
                    const tier = e.target.value;
                    const nextPrice = Number(item.prices?.[tier] ?? item.price ?? 0);
                    setCartItemPricing({ id: item.id, priceTier: tier, price: nextPrice });
                  }}
                >
                  <option value="retail">Retail</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="warehouse">Warehouse</option>
                  <option value="agent">Agent</option>
                </select>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.price}
                  onChange={e => setCartItemPricing({ id: item.id, priceTier: item.priceTier || selectedPriceTier, price: Number(e.target.value) || 0 })}
                  style={{ width: 110 }}
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  R: {formatCurrency(item.prices?.retail ?? item.price, settings)} • W: {formatCurrency(item.prices?.wholesale ?? item.price, settings)} • WH: {formatCurrency(item.prices?.warehouse ?? item.price, settings)} • A: {formatCurrency(item.prices?.agent ?? item.price, settings)}
                </span>
                </>
                ) : (
                <span style={{ fontWeight: 700 }}>{formatCurrency(item.price, settings)}</span>
                )}
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  {t('Unit')}: {formatCurrency(item.price, settings)}
                </span>
              </div>
              <div style={{ minWidth: 120, textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>{t('Line Total')}</div>
                <strong>{formatCurrency((Number(item.price) || 0) * (Number(item.quantity) || 0), settings)}</strong>
              </div>
              <button className="btn" onClick={() => {
                removeItemFromCart(item.id);
                void releaseSerializedCartItems([item]);
              }}>
                <svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12M10 11v6M14 11v6M9 7l1-2h4l1 2M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="2"/></svg>
                {t('Remove')}
              </button>
            </li>
          ))}
        </ul>
        <div className="totals-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ color: '#64748b' }}>{t('Manual discount')}</label>
            <input className="input" type="number" min="0" value={manualDiscount} onChange={e => setCartDiscountValue(Number(e.target.value))} style={{ width: 140 }} />
          </div>
          {settings.loyaltyEnabled && selectedCustomer && (
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ color: '#64748b' }}>{t('Redeem points')}</label>
                <input className="input" type="number" min="0" step="1" value={redeemPoints} onChange={e => setRedeemPoints(e.target.value)} style={{ width: 140 }} />
                <span style={{ color: '#64748b' }}>{t('Available')}: {availablePoints}</span>
              </div>
              <div style={{ color: '#64748b' }}>{t('Loyalty discount')}: {formatCurrency(loyaltyDiscount, settings)}</div>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <div>{t('Subtotal')}: {formatCurrency(subtotal, settings)}</div>
            <div>{t('Discount')}: {formatCurrency(discount, settings)}</div>
            <div>{t('Tax')} ({Math.round((taxRate || 0) * 100)}%): {formatCurrency(tax, settings)}</div>
            <div><strong>{t('Total')}: {formatCurrency(total, settings)}</strong></div>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{t('Payments')}</h3>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={easyBuyEnabled}
                  disabled={!easyBuyAllowed}
                  onChange={e => setEasyBuyEnabled(e.target.checked)}
                />
                {creditModeLabel}
              </label>
            </div>
            {easyBuyEnabled ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ color: easyBuyBlockedItem ? '#b91c1c' : '#64748b', fontSize: 12 }}>
                  {easyBuyBlockedItem
                    ? `${easyBuyBlockedItem.name} ${t('does not allow')} ${creditModeLabel.toLowerCase()}`
                    : `${t('Minimum upfront')}: ${formatCurrency(easyBuyMinimum, settings)}${customerMaxCreditLimit > 0 ? ` • ${t('Limit')}: ${formatCurrency(customerMaxCreditLimit, settings)}` : ''}`}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label>
                    <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Amount paid now')}</div>
                    <input className="input" type="number" min="0" value={easyBuyAmountPaidNow} onChange={e => setEasyBuyAmountPaidNow(e.target.value)} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Due date')}</div>
                    <input className="input" type="date" min={toDateInputValue(buildSaleDateTimeValue(saleDate, saleTime)) || toDateInputValue(new Date())} value={easyBuyDueDate} onChange={e => setEasyBuyDueDate(e.target.value)} />
                  </label>
                </div>
                <label>
                  <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Credit package')}</div>
                  <select className="select" value={activeCreditPackageName} onChange={e => setSelectedCreditPackageName(e.target.value)}>
                    {creditPackageOptions.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{t('Payment method breakdown must equal the amount paid now')}</div>
                  {payments.map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select className="select" value={p.type} onChange={e => updatePayment(i, 'type', e.target.value)} style={{ width: 112, minWidth: 112, flex: '0 0 112px' }}>
                        <option value="cash">{t('Cash')}</option>
                        <option value="card">{t('Card')}</option>
                        <option value="mobile">{t('Mobile')}</option>
                        <option value="wallet">{t('Wallet')}</option>
                      </select>
                      <input className="input" type="number" placeholder={t('amount')} value={p.amount} onChange={e => updatePayment(i, 'amount', e.target.value)} style={{ width: 140, flex: '1 1 160px', minWidth: 0 }} />
                      {payments.length > 1 && <button className="btn" onClick={() => removePaymentRow(i)}>{t('Remove')}</button>}
                    </div>
                  ))}
                  <button className="btn" onClick={addPaymentRow}>{t('Add Payment')}</button>
                </div>
                <div style={{ color: '#64748b' }}>{t('Paid now')}: {formatCurrency(paid, settings)} | {t('Breakdown total')}: {formatCurrency(payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0), settings)} | {t('Remaining balance')}: {formatCurrency(due, settings)}</div>
              </div>
            ) : (
              <>
                {payments.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <select className="select" value={p.type} onChange={e => updatePayment(i, 'type', e.target.value)} style={{ width: 112, minWidth: 112, flex: '0 0 112px' }}>
                      <option value="cash">{t('Cash')}</option>
                      <option value="card">{t('Card')}</option>
                      <option value="mobile">{t('Mobile')}</option>
                      <option value="wallet">{t('Wallet')}</option>
                    </select>
                    <input className="input" type="number" placeholder={t('amount')} value={p.amount} onChange={e => updatePayment(i, 'amount', e.target.value)} style={{ width: 140, flex: '1 1 160px', minWidth: 0 }} />
                    {payments.length > 1 && <button className="btn" onClick={() => removePaymentRow(i)}>
                      <svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12M10 11v6M14 11v6M9 7l1-2h4l1 2M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="2"/></svg>
                      {t('Remove')}
                    </button>}
                  </div>
                ))}
                <button className="btn" onClick={addPaymentRow}>
                  <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
                  {t('Add Payment')}
                </button>
                <div style={{ marginTop: 6, color: '#64748b' }}>{t('Paid')}: {formatCurrency(paid, settings)} | {t('Due')}: {formatCurrency(due, settings)} | {t('Change')}: {formatCurrency(change, settings)}</div>
              </>
            )}
          </div>
          {canBackdateSales && (
            <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ color: '#64748b', fontSize: 12 }}>{t('Sale date/time for reports, refunds, and reconciliation')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {saleDateTimeTouched && (
                    <button className="btn" type="button" onClick={resetSaleDateTime}>{t('Use current time')}</button>
                  )}
                  <button className="btn" type="button" onClick={() => setSaleDateTimeEditing((prev) => !prev)} title={t('Edit sale date/time')} style={{ padding: '6px 8px' }}>
                    <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" strokeWidth="2"/><path d="M13 7l4 4" stroke="currentColor" strokeWidth="2"/></svg>
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label>
                  <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Sale date')}</div>
                  <input className="input" type="date" max={getLocalSaleDateTimeParts().date} disabled={!saleDateTimeEditing} value={saleDate} onChange={e => { setSaleDate(e.target.value); setSaleDateTimeTouched(true); }} />
                </label>
                <label>
                  <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Sale time')}</div>
                  <input className="input" type="time" disabled={!saleDateTimeEditing} value={saleTime} onChange={e => { setSaleTime(e.target.value); setSaleDateTimeTouched(true); }} />
                </label>
              </div>
            </div>
          )}
          {canOverrideTax && (
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ color: '#64748b' }}>{t('Tax override (%)')}</label>
                <input className="input" type="number" min="0" max="100" step="0.01" value={taxOverridePct} onChange={e => setTaxOverridePct(e.target.value)} style={{ width: 140 }} />
              </div>
              {taxOverridePct !== '' && (
                <input className="input" placeholder={t('Remark for override (required)')} value={taxOverrideRemark} onChange={e => setTaxOverrideRemark(e.target.value)} />
              )}
            </div>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          {requiresDiscountApproval ? (
            <button className="btn btn-primary" onClick={submitDiscountForReview} disabled={cart.items.length === 0 || saving}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 12h10" stroke="currentColor" strokeWidth="2"/><path d="M11 7l5 5-5 5" stroke="currentColor" strokeWidth="2"/><path d="M18 5h2v14h-2" stroke="currentColor" strokeWidth="2"/></svg>
              {saving ? t('Processing...') : t('Send for Review')}
            </button>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => completeSale(false)} disabled={cart.items.length === 0 || saving}>
                <svg viewBox="0 0 24 24" fill="none"><path d="M6 9V3h12v6" stroke="currentColor" strokeWidth="2"/><path d="M6 17h12v4H6z" stroke="currentColor" strokeWidth="2"/><path d="M4 9h16a2 2 0 012 2v2H2v-2a2 2 0 012-2z" stroke="currentColor" strokeWidth="2"/></svg>
                {saving ? t('Processing...') : t('Complete & Print')}
              </button>
              <button className="btn" onClick={() => completeSale(true)} style={{ marginLeft: 8 }} disabled={cart.items.length === 0 || saving}>
                <svg viewBox="0 0 24 24" fill="none"><path d="M6 9V3h12v6" stroke="currentColor" strokeWidth="2"/><path d="M6 17h12v4H6z" stroke="currentColor" strokeWidth="2"/><path d="M4 9h16a2 2 0 012 2v2H2v-2a2 2 0 012-2z" stroke="currentColor" strokeWidth="2"/></svg>
                {saving ? t('Processing...') : t('Complete (ESC/POS)')}
              </button>
            </>
          )}
          <button className="btn" onClick={() => { void releaseSerializedCartItems(cart.items); clearActiveCart(); rotateReservationToken(); }} style={{ marginLeft: 8 }} disabled={cart.items.length === 0}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M6 7l1 12h10l1-12M9 7l1-2h4l1 2" stroke="currentColor" strokeWidth="2"/></svg>
            {t('Clear')}
          </button>
        </div>
        </div>
        {serializedPickerProduct && (
          <Modal
            title={`${t('Select Serialized Unit')} • ${serializedPickerProduct.name}`}
            onClose={() => setSerializedPickerProduct(null)}
            panelClassName="modal-panel-serialized"
            footer={<button className="btn" onClick={() => setSerializedPickerProduct(null)}>{t('Close')}</button>}
          >
            <div style={{ display: 'grid', gap: 12 }}>
              <input
                ref={serializedScanInputRef}
                className="input"
                autoFocus
                placeholder={t('Scan IMEI barcode or type and press Enter')}
                value={serializedScanInput}
                onChange={e => setSerializedScanInput(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && serializedScanInput.trim()) {
                    e.preventDefault();
                    if (reservingSerializedKeys.includes(serializedScanInput.trim())) {
                      toast.show(t('Serialized item is already being added'), { type: 'error' });
                      return;
                    }
                    await addSerializedUnitToCart(serializedPickerProduct, { imei: serializedScanInput.trim(), serialNumber: serializedScanInput.trim() });
                  }
                }}
                style={{ color: '#111827', background: '#ffffff' }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => setSerializedCameraOpen(true)}>{t('Camera Scan')}</button>
              </div>
              <input
                className="input"
                placeholder={t('Search existing units')}
                value={serializedUnitsQuery}
                onChange={async e => {
                  const value = e.target.value;
                  setSerializedUnitsQuery(value);
                  setSerializedUnitsPage(1);
                  await loadSerializedUnits(serializedPickerProduct, value, 1, serializedUnitsPageSize);
                }}
                style={{ color: '#111827', background: '#ffffff' }}
              />
              <div className="serialized-picker-layout">
                <div style={{ overflowX: 'auto', maxHeight: 420, minWidth: 0 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th align="left">{t('IMEI')}</th>
                        <th align="left">{t('Serial')}</th>
                        <th align="left"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {serializedUnits.map(unit => (
                        <tr key={unit._id}>
                          <td style={{ color: '#111827' }}>{unit.imei || '—'}</td>
                          <td style={{ color: '#111827' }}>{unit.serialNumber || '—'}</td>
                          <td style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
                            {isSerializedAlreadyInCart(unit) && <span style={{ color: '#b45309', fontSize: 12 }}>{t('In Cart')}</span>}
                            {!isSerializedAlreadyInCart(unit) && isSerializedPending(unit) && <span style={{ color: '#2563eb', fontSize: 12 }}>{t('Adding...')}</span>}
                            <button className="btn btn-primary" onClick={() => addSerializedUnitToCart(serializedPickerProduct, unit)} disabled={isSerializedAlreadyInCart(unit) || isSerializedPending(unit)}>
                              {isSerializedAlreadyInCart(unit) ? t('Selected') : isSerializedPending(unit) ? t('Adding...') : t('Select')}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!serializedLoading && serializedUnits.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>{t('No serialized units available')}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="serialized-picker-cart">
                  <div className="serialized-picker-cart-title">{t('In Cart')} ({serializedPickerCartItems.length})</div>
                  <div className="serialized-picker-cart-list">
                    {serializedPickerCartItems.map((item) => (
                      <div key={item.id} className="serialized-picker-cart-item">
                        <div className="serialized-picker-cart-code">{item.imei || item.serialNumber || '—'}</div>
                        <div className="serialized-picker-cart-meta">{item.serialNumber && item.imei && item.serialNumber !== item.imei ? item.serialNumber : (item.spec || '—')}</div>
                        <button
                          type="button"
                          className="serialized-picker-delete"
                          onClick={() => removeSerializedUnitFromCart(item)}
                          aria-label={t('Remove')}
                          title={t('Remove')}
                        >
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M4 7h16M9 7V5h6v2M8 10v7M12 10v7M16 10v7M6 7l1 12h10l1-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    {serializedPickerCartItems.length === 0 ? (
                      <div className="serialized-picker-cart-empty">{t('No serialized units in cart yet')}</div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <button className="btn" onClick={() => { const next = Math.max(1, serializedUnitsPage - 1); setSerializedUnitsPage(next); loadSerializedUnits(serializedPickerProduct, serializedUnitsQuery, next, serializedUnitsPageSize); }} disabled={serializedUnitsPage <= 1 || serializedLoading}>{t('Prev')}</button>
                  <span style={{ color: '#111827' }}>{t('Page')} {serializedUnitsPage} {t('of')} {Math.max(1, Math.ceil(serializedUnitsTotal / serializedUnitsPageSize))}</span>
                  <button className="btn" onClick={() => { const next = Math.min(Math.max(1, Math.ceil(serializedUnitsTotal / serializedUnitsPageSize)), serializedUnitsPage + 1); setSerializedUnitsPage(next); loadSerializedUnits(serializedPickerProduct, serializedUnitsQuery, next, serializedUnitsPageSize); }} disabled={serializedUnitsPage >= Math.max(1, Math.ceil(serializedUnitsTotal / serializedUnitsPageSize)) || serializedLoading}>{t('Next')}</button>
                </div>
                <label style={{ color: '#111827' }}>
                  <span style={{ marginRight: 6 }}>{t('Rows')}</span>
                  <select className="select" value={serializedUnitsPageSize} onChange={e => { const nextSize = Number(e.target.value); setSerializedUnitsPageSize(nextSize); setSerializedUnitsPage(1); loadSerializedUnits(serializedPickerProduct, serializedUnitsQuery, 1, nextSize); }} style={{ color: '#111827', background: '#ffffff' }}>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>
            </div>
          </Modal>
        )}
        <BarcodeScannerModal
          title={t('Scan IMEI Barcode')}
          open={serializedCameraOpen}
          onClose={() => setSerializedCameraOpen(false)}
          onDetected={async (value) => {
            setSerializedCameraOpen(false);
            setSerializedScanInput(value);
            if (serializedPickerProduct) {
              await addSerializedUnitToCart(serializedPickerProduct, { imei: value, serialNumber: value });
            }
          }}
        />
      </div>
    </div>
  );
}

export default PosPage;
