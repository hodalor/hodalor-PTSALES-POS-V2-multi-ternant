import { useDispatch, useSelector } from 'react-redux';
import { addItem, removeItem, removeItemByUnitId, setQuantity, updateItemPricing, clearCart, setDiscount, addHeld, removeHeld, replaceCart, updateHeld } from '../store/cartSlice';
import { adjustStock, setStock } from '../store/productsSlice';
import { recordSale } from '../store/salesSlice';
import { addInvoice } from '../store/invoicesSlice';
import { updateCustomer } from '../store/customersSlice';
import { buildBrandedReceiptHtml, printReceiptHtml } from '../utils/print';
import { escposReceipt, escposOpenDrawer, downloadText } from '../utils/escpos';
import { useToast } from '../components/ToastProvider';
import { formatCurrency } from '../utils/currency';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addAudit } from '../store/auditSlice';
import { productSpec } from '../utils/productSpec';
import { createSale } from '../api/sales';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import { confirmDialog, promptDialog } from '../utils/dialogs';
import { isFeatureEnabled } from '../utils/featureFlags';
import * as productUnitsApi from '../api/productUnits';
import Modal from '../components/Modal';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { getAllowedPriceTiers, getDisplayPrice, getPreferredPriceTier, getPriceTierLabel } from '../utils/priceVisibility';
import InlineSpinner from '../components/InlineSpinner';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';

function createReservationToken() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `RES-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function PosPage({ mode = 'retail' }) {
  const cart = useSelector(state => state.cart);
  const heldSales = useMemo(() => cart.heldSales || [], [cart.heldSales]);
  const products = useSelector(s => s.products.products);
  const customers = useSelector(s => s.customers.customers);
  const branches = useSelector(s => s.branches.branches);
  const branchId = useSelector(s => s.settings.currentBranchId);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const isWholesale = String(mode || '').toLowerCase() === 'wholesale';
  const creditModeLabel = isWholesale ? 'Credit Sale' : 'EasyBuy';
  const modeLabel = isWholesale ? 'Distribution POS' : 'POS';
  const reservationStorageKey = `ptsales:pos-reservation-token:${String(mode || 'retail').toLowerCase()}`;
  const initialPriceTier = isWholesale ? 'wholesale' : 'retail';
  const activeBranchId = useMemo(() => {
    const currentBranch = (branches || []).find(branch => String(branch.id) === String(branchId));
    const expectedType = isWholesale ? 'wholesale' : 'retail';
    if (String(currentBranch?.branchType || 'retail').toLowerCase() === expectedType) return branchId;
    const fallback = (branches || []).find(branch => String(branch.branchType || 'retail').toLowerCase() === expectedType);
    return fallback?.id || branchId;
  }, [branchId, branches, isWholesale]);
  const activeBranch = useMemo(() => (branches || []).find(branch => String(branch.id) === String(activeBranchId)) || null, [activeBranchId, branches]);
  const branchNameById = useMemo(() => new Map((branches || []).map(branch => [String(branch.id), branch.name])), [branches]);
  const allowedPriceTiers = useMemo(() => getAllowedPriceTiers(auth), [auth]);
  const initialVisiblePriceTier = useMemo(() => getPreferredPriceTier(allowedPriceTiers, initialPriceTier), [allowedPriceTiers, initialPriceTier]);
  const [query, setQuery] = useState('');
  const [payments, setPayments] = useState([{ type: 'cash', amount: '' }]);
  const [view, setView] = useState(isWholesale ? 'list' : 'grid');
  const [selectedPriceTier, setSelectedPriceTier] = useState(initialVisiblePriceTier);
  const [easyBuyEnabled, setEasyBuyEnabled] = useState(false);
  const [easyBuyAmountPaidNow, setEasyBuyAmountPaidNow] = useState('');
  const [easyBuyDueDate, setEasyBuyDueDate] = useState('');
  const [taxOverridePct, setTaxOverridePct] = useState('');
  const [taxOverrideRemark, setTaxOverrideRemark] = useState('');
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
  const [saving, setSaving] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [redeemPoints, setRedeemPoints] = useState('');
  const [heldOpen, setHeldOpen] = useState(false);
  const [heldSort, setHeldSort] = useState(() => {
    try { return localStorage.getItem('ptSales:heldSort') || 'newest'; } catch { return 'newest'; }
  });
  const [heldQuery, setHeldQuery] = useState(() => {
    try { return localStorage.getItem('ptSales:heldQuery') || ''; } catch { return ''; }
  });
  const toast = useToast();
  useEffect(() => {
    try { localStorage.setItem(reservationStorageKey, reservationToken); } catch {}
  }, [reservationStorageKey, reservationToken]);
  useEffect(() => {
    if (cart.items.length > 0 || !reservationToken) return;
    void productUnitsApi.releaseProductUnits({ unitIds: [], reservationToken });
  }, [cart.items.length, reservationToken]);
  useEffect(() => {
    setSelectedPriceTier(getPreferredPriceTier(allowedPriceTiers, initialPriceTier));
    setView(isWholesale ? 'list' : 'grid');
  }, [allowedPriceTiers, initialPriceTier, isWholesale]);
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
            agent: getDisplayPrice({ ...p, ...v, price: v.price != null ? v.price : p.price, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice, agentPrice: v.agentPrice }, 'agent')
          };
          out.push({
            id: `${p.id}:${v.id}`,
            productId: p.id,
            variantId: v.id,
            trackType: p.trackType,
            name: `${p.name} (${v.label})`,
            sku: v.sku || `${p.sku}-${v.label}`,
            price: prices[selectedPriceTier] ?? prices[getPreferredPriceTier(allowedPriceTiers, initialPriceTier)] ?? prices.retail,
            prices,
            image: p.image,
            stockByBranch: isWholesale ? (v.wholesaleStockByBranch || {}) : (v.stockByBranch || {}),
            lowStock: isWholesale ? Number(p.wholesaleLowStock != null ? p.wholesaleLowStock : (p.lowStock || 0)) : Number(p.lowStock || 0),
            attributes: p.attributes,
            unitKind: p.unitKind, unitValue: p.unitValue, unitSymbol: p.unitSymbol, sizeLabel: p.sizeLabel, shoeSize: p.shoeSize,
            allowCredit: p.allowCredit !== false,
            minimumCreditPercentage: Number(p.minimumCreditPercentage || 0)
          });
        });
      } else {
        out.push({
          ...p,
          price: basePrices[selectedPriceTier] ?? basePrices[getPreferredPriceTier(allowedPriceTiers, initialPriceTier)] ?? basePrices.retail,
          prices: basePrices,
          stockByBranch: isWholesale ? (p.wholesaleStockByBranch || {}) : (p.stockByBranch || {}),
          lowStock: isWholesale ? Number(p.wholesaleLowStock != null ? p.wholesaleLowStock : (p.lowStock || 0)) : Number(p.lowStock || 0),
          allowCredit: p.allowCredit !== false,
          minimumCreditPercentage: Number(p.minimumCreditPercentage || 0)
        });
      }
    });
    return out;
  }, [allowedPriceTiers, initialPriceTier, isWholesale, products, selectedPriceTier]);
  const serializedStockRefreshKey = `${cart.items.length}:${liveSerializedUnits.length}:${reservingSerializedKeys.length}`;
  const serializedStockCountMap = useMemo(() => {
    void serializedStockRefreshKey;
    const inventoryType = isWholesale ? 'wholesale' : 'retail';
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
  }, [activeBranchId, isWholesale, reservationToken, serializedStockRefreshKey]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sellables;
    return sellables.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q) ||
      productSpec(p).toLowerCase().includes(q)
    );
  }, [sellables, query]);
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
  const dispatch = useDispatch();

  const selectedCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find(c => String(c.id) === String(selectedCustomerId)) || null;
  }, [customers, selectedCustomerId]);

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

  function visibleStockForProduct(p) {
    if (String(p.trackType || 'quantity') === 'serialized') {
      const key = `${String(p.productId || p.id || '')}:${String(p.variantId || '')}`;
      return Number(serializedStockCountMap.get(key) || 0);
    }
    const stockMap = isWholesale ? (p.wholesaleStockByBranch || p.stockByBranch || {}) : (p.stockByBranch || {});
    const available = Number(stockMap?.[activeBranchId] || 0);
    return available;
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
    if (normalized.length < 4) {
      setLiveSerializedUnits([]);
      setLiveSerializedLoading(false);
      return;
    }
    const requestId = ++liveSerializedSearchSeqRef.current;
    const inventoryType = isWholesale ? 'wholesale' : 'retail';
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
  }, [query, activeBranchId, isWholesale, reservationToken]);

  const subtotal = cart.items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0);
  const manualDiscount = cart.discount || 0;
  const canOverrideTax = ['Admin','Manager'].includes(auth.role) || String(auth.role || '').toLowerCase() === 'superadmin';
  const taxRate = canOverrideTax && taxOverridePct !== '' ? Math.max(0, Math.min(1, Number(taxOverridePct) / 100)) : Number(settings.taxRate ?? 0);
  const maxRedeemPct = Math.max(0, Math.min(100, Number(settings.loyaltyMaxRedeemPercent ?? 50)));
  const redeemValue = Number(settings.loyaltyRedeemValue || 0);
  const availablePoints = Math.max(0, Math.floor(Number(selectedCustomer?.loyaltyPoints || 0)));
  const reqRedeem = Math.max(0, Math.floor(Number(redeemPoints || 0)));
  const redeemable = Math.min(reqRedeem, availablePoints);
  let loyaltyDiscount = (settings.loyaltyEnabled && selectedCustomer && redeemValue > 0) ? (redeemable * redeemValue) : 0;
  const cap = (subtotal > 0 ? (subtotal * (maxRedeemPct / 100)) : 0);
  if (loyaltyDiscount > cap) loyaltyDiscount = cap;
  const discount = Math.max(0, Number(manualDiscount || 0) + Number(loyaltyDiscount || 0));
  const tax = Math.max(0, (subtotal - discount) * taxRate);
  const total = Math.max(0, subtotal - discount + tax);
  const paid = easyBuyEnabled ? Math.max(0, Number(easyBuyAmountPaidNow || 0)) : payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const due = Math.max(0, total - paid);
  const change = easyBuyEnabled ? 0 : Math.max(0, paid - total);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const heldUiEnabled = isFeatureEnabled(settings, 'tabs.posHeldSales');
  const easyBuyAllowed = !!selectedCustomer && cart.items.length > 0;
  const easyBuyBlockedItem = cart.items.find(item => item.allowCredit === false);
  const easyBuyMinimum = cart.items.reduce((sum, item) => {
    const pct = Math.max(0, Number(item.minimumCreditPercentage || 0));
    return sum + ((Number(item.price || 0) * Number(item.quantity || 0)) * (pct / 100));
  }, 0);
  const customerOutstanding = Number(selectedCustomer?.outstandingBalance || 0);
  const customerMaxCreditLimit = Number(selectedCustomer?.maxCreditLimit || settings.maxCreditLimitPerCustomer || 0);
  const customerCreditScore = Number(selectedCustomer?.creditScore || 0);

  async function loadSerializedUnits(product, search = '', pageValue = 1, pageSizeValue = serializedUnitsPageSize) {
    if (!product) return;
    const requestId = ++serializedLoadSeqRef.current;
    const productKey = `${product.productId || product.id || ''}:${product.variantId || ''}`;
    serializedPickerKeyRef.current = productKey;
    const cached = productUnitsApi.getCachedProductUnits({
      productId: product.productId || product.id,
      variantId: product.variantId || '',
      branchId: activeBranchId,
      inventoryType: isWholesale ? 'wholesale' : 'retail',
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
        inventoryType: isWholesale ? 'wholesale' : 'retail',
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
      dispatch(setStock({
        productId: product.productId || product.id,
        variantId: product.variantId || null,
        branchId: activeBranchId,
        inventoryType: isWholesale ? 'wholesale' : 'retail',
        quantity: Number(result?.total || 0)
      }));
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
    const optimisticUnitId = String(unit?._id || '');
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
    dispatch(addItem({
      name: product.name,
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
    }));
    setSerializedScanInput('');
    try {
      await (unit?._id ? productUnitsApi.reserveProductUnit({
        unitId: unit._id,
        productId: product.productId || product.id,
        variantId: product.variantId || '',
        branchId: activeBranchId,
        inventoryType: isWholesale ? 'wholesale' : 'retail',
        reservationToken
      }) : productUnitsApi.scanProductUnit({
        productId: product.productId || product.id,
        variantId: product.variantId || '',
        branchId: activeBranchId,
        inventoryType: isWholesale ? 'wholesale' : 'retail',
        reservationToken,
        imei: unit?.imei || unit?.serialNumber || ''
      }));
      toast.show(`Added unit ${optimisticCode}`, { type: 'success' });
    } catch (e) {
      dispatch(removeItemByUnitId(optimisticUnitId));
      setSerializedPickerProduct(product);
      void loadSerializedUnits(product, serializedUnitsQuery, 1, serializedUnitsPageSize);
      toast.show(String(e?.message || 'Failed to reserve serialized unit'), { type: 'error' });
    } finally {
      if (reservationKey) setReservingSerializedKeys(prev => prev.filter(key => key !== reservationKey));
    }
  }

  async function addToCart(p) {
    const available = p.stockByBranch?.[activeBranchId] || 0;
    const inCart = cart.items.filter(i => i.sku === p.sku).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    if (available - inCart <= 0) {
      toast.show('Out of stock for current branch', { type: 'error' });
      return;
    }
    if (String(p.trackType || 'quantity') === 'serialized') {
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
    dispatch(addItem({
      name: p.name,
      sku: p.sku,
      price: p.price,
      priceTier: selectedPriceTier,
      prices: p.prices || { retail: p.price, wholesale: p.price, agent: p.price },
      allowCredit: p.allowCredit !== false,
      minimumCreditPercentage: Number(p.minimumCreditPercentage || 0),
      spec,
      productId: p.productId || p.id,
      variantId: p.variantId || null
    }));
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
      redeemPoints,
      taxOverridePct,
      taxOverrideRemark,
      easyBuyEnabled,
      easyBuyAmountPaidNow,
      easyBuyDueDate,
      selectedPriceTier,
      payments: payments.map(p => ({ type: p.type, amount: p.amount })),
      view
    };
    dispatch(addHeld(payload));
    dispatch(clearCart());
    rotateReservationToken();
    setSelectedCustomerId('');
    setCustomerQuery('');
    setRedeemPoints('');
    setTaxOverridePct('');
    setTaxOverrideRemark('');
    setEasyBuyEnabled(false);
    setEasyBuyAmountPaidNow('');
    setEasyBuyDueDate('');
    setPayments([{ type: 'cash', amount: '' }]);
    toast.show('Sale held', { type: 'success' });
  }

  async function startNewSale() {
    if (cart.items.length > 0) {
      const ok = await confirmDialog('Clear current cart and start a new sale?');
      if (!ok) return;
    }
    void releaseSerializedCartItems(cart.items);
    dispatch(clearCart());
    rotateReservationToken();
    setSelectedCustomerId('');
    setCustomerQuery('');
    setRedeemPoints('');
    setTaxOverridePct('');
    setTaxOverrideRemark('');
    setEasyBuyEnabled(false);
    setEasyBuyAmountPaidNow('');
    setEasyBuyDueDate('');
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
    dispatch(replaceCart({ items: Array.isArray(h.items) ? h.items : [], discount: h.discount || 0, notes: h.notes || '' }));
    setSelectedCustomerId(h.selectedCustomerId || '');
    setRedeemPoints(h.redeemPoints || '');
    setTaxOverridePct(h.taxOverridePct ?? '');
    setTaxOverrideRemark(h.taxOverrideRemark ?? '');
    setEasyBuyEnabled(!!h.easyBuyEnabled);
    setEasyBuyAmountPaidNow(h.easyBuyAmountPaidNow || '');
    setEasyBuyDueDate(h.easyBuyDueDate || '');
    setSelectedPriceTier(h.selectedPriceTier || initialPriceTier);
    setPayments(Array.isArray(h.payments) && h.payments.length > 0 ? h.payments.map(p => ({ type: p.type, amount: p.amount })) : [{ type: 'cash', amount: '' }]);
    try { if (h.view) setView(h.view); } catch {}
    dispatch(removeHeld(h.id));
    setHeldOpen(false);
    toast.show('Held sale resumed', { type: 'success' });
  }

  async function deleteHeld(h) {
    if (!h) return;
    const ok = await confirmDialog('Delete this held sale?');
    if (!ok) return;
    setDeletingHeldId(String(h.id || ''));
    void releaseSerializedCartItemsWithToken(h.items || [], h.reservationToken || reservationToken);
    dispatch(removeHeld(h.id));
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
    dispatch(updateHeld({ id: h.id, label: val }));
    toast.show('Held sale renamed', { type: 'success' });
  }

  async function completeSale(escpos = false) {
    if (saving) return;
    if (!easyBuyEnabled && due > 0) {
      toast.show('Payment incomplete', { type: 'error' });
      return;
    }
    if (easyBuyEnabled) {
      if (!easyBuyAllowed || !selectedCustomer) {
        toast.show(`${creditModeLabel} requires a registered customer`, { type: 'error' });
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
      if ((Number(easyBuyAmountPaidNow || 0) + 0.0001) < Number(easyBuyMinimum || 0)) {
        toast.show(`Minimum upfront payment is ${formatCurrency(easyBuyMinimum, settings)}`, { type: 'error' });
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
    const branchName = activeBranch?.name || activeBranchId;
    const sale = {
      branchId: activeBranchId,
      branchName,
      sellerName: auth.user?.name || 'unknown',
      sellerRole: auth.role || '',
      customerId: selectedCustomer ? selectedCustomer.id : '',
      customerCode: selectedCustomer ? (selectedCustomer.customerCode || '') : '',
      customerName: selectedCustomer ? (selectedCustomer.name || '') : '',
      customerPhone: selectedCustomer ? (selectedCustomer.phone || '') : '',
      posType: isWholesale ? 'wholesale' : 'retail',
      inventoryType: isWholesale ? 'wholesale' : 'retail',
      defaultPriceTier: selectedPriceTier,
      loyaltyPointsRedeemed: (settings.loyaltyEnabled && selectedCustomer) ? redeemable : 0,
      items: cart.items.map(i => ({
        name: i.name,
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
      payment_methods: easyBuyEnabled ? [{ type: 'easybuy', amount: due }] : payments.map(p => ({ type: p.type, amount: Number(p.amount) || 0 })),
      creditDueDate: easyBuyEnabled ? easyBuyDueDate : undefined,
      creditAmountPaidNow: easyBuyEnabled ? Number(easyBuyAmountPaidNow || 0) : 0,
      creditBalance: easyBuyEnabled ? due : 0,
      creditSale: easyBuyEnabled ? {
        enabled: true,
        amountPaidNow: Number(easyBuyAmountPaidNow || 0),
        dueDate: easyBuyDueDate
      } : undefined,
      status: 'completed',
      created_at: new Date().toISOString(),
      reservationToken
    };
    setSaving(true);
    let saleForUi = null;
    if (!navigator.onLine) {
      const offlineId = `offline-sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sale.clientId = offlineId;
      const ref = `OFF-${String(Date.now()).padStart(6, '0').slice(-6)}`;
      try {
        await enqueueHttp({ collection: 'sales', label: 'Sale', path: '/api/sales', method: 'POST', body: sale });
      } catch (e) {
        toast.show(String(e?.message || 'Failed to save offline'), { type: 'error' });
        setSaving(false);
        return;
      }
      saleForUi = { ...sale, id: offlineId, invoiceSerial: ref, receiptNumber: ref, branchName, offline: true };
    } else {
      sale.clientId = crypto.randomUUID();
      const tmpRef = `TMP-${String(Date.now()).padStart(6, '0').slice(-6)}`;
      saleForUi = { ...sale, id: sale.clientId, invoiceSerial: tmpRef, receiptNumber: tmpRef, branchName };
    }
    const receiptHtml = buildBrandedReceiptHtml({ settings, sale: saleForUi });
    const skuToRef = new Map();
    sellables.forEach(p => skuToRef.set(p.sku, { productId: p.productId || p.id, variantId: p.variantId || null }));
    const affectedProductIds = Array.from(new Set(cart.items.map(i => skuToRef.get(i.sku)?.productId).filter(Boolean)));
    cart.items.forEach(i => {
      const ref = skuToRef.get(i.sku);
      if (ref) {
        dispatch(adjustStock({ productId: ref.productId, variantId: ref.variantId, branchId: activeBranchId, inventoryType: isWholesale ? 'wholesale' : 'retail', delta: -i.quantity }));
      }
    });
    dispatch(recordSale(saleForUi));
    try {
      const payTerms = (saleForUi.payment_methods || [])
        .map(p => {
          const t = String(p.type || '').toLowerCase();
          if (t === 'cash') return 'Cash';
          if (t === 'card') return 'Card';
          if (t === 'mobile' || t === 'momo' || t === 'mobile money') return 'Mobile Money';
          if (t === 'wallet') return 'Wallet';
          if (t === 'easybuy') return isWholesale ? 'Credit Sale' : 'EasyBuy';
          return t ? (t[0].toUpperCase() + t.slice(1)) : 'Cash';
        })
        .join(', ');
      const invNumber = saleForUi.invoiceSerial || `${settings.invoicePrefix || 'INV'}-${String(settings.nextInvoiceNumber || 1).padStart(Number(settings.invoiceNumberDigits || 6), '0')}`;
      const inv = {
        number: invNumber,
        date: saleForUi.created_at || new Date().toISOString(),
        saleId: saleForUi.id || saleForUi._id || '',
        paymentStatus: easyBuyEnabled ? 'active' : 'paid',
        source: isWholesale ? 'wholesale-pos' : 'pos',
        customer: selectedCustomer ? {
          name: selectedCustomer.name || '',
          phone: selectedCustomer.phone || '',
          email: selectedCustomer.email || '',
          address: selectedCustomer.address || '',
          customerCode: selectedCustomer.customerCode || '',
          customerId: selectedCustomer.id
        } : (saleForUi.customerName ? {
          name: saleForUi.customerName,
          phone: saleForUi.customerPhone || ''
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
      dispatch(addInvoice(inv));
    } catch {}
    if (navigator.onLine && selectedCustomer && saleForUi.customerPointsAfter != null) {
      dispatch(updateCustomer({ id: selectedCustomer.id, loyaltyPoints: Number(saleForUi.customerPointsAfter || 0) }));
    }
    dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: isWholesale ? 'stock_wholesale_sale_deduct' : 'stock_sale_deduct',
      details: { items: sale.items.map(it => ({ sku: it.sku, qty: it.qty, priceTier: it.priceTier || selectedPriceTier })), branchId: activeBranchId, mode: isWholesale ? 'wholesale' : 'retail' },
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
      details: { total: sale.total, items: sale.items.length, mode: isWholesale ? 'wholesale' : 'retail', easyBuy: easyBuyEnabled, branchId: activeBranchId },
      branchId: activeBranchId,
      offline: !navigator.onLine
    }));
    dispatch(clearCart());
    rotateReservationToken();
    setSelectedCustomerId('');
    setCustomerQuery('');
    setRedeemPoints('');
    setEasyBuyEnabled(false);
    setEasyBuyAmountPaidNow('');
    setEasyBuyDueDate('');
    if (escpos) {
      const text = escposReceipt({
        header: { title: settings.appName, store: settings.receiptHeader, branch: branchName, phone: settings.businessPhone || '', cashier: saleForUi.sellerName, customer: saleForUi.customerName ? `${saleForUi.customerName}${saleForUi.customerCode ? ` (${saleForUi.customerCode})` : ''}` : '', receiptId: saleForUi.id || saleForUi._id, receiptNumber: saleForUi.receiptNumber, invoiceSerial: saleForUi.invoiceSerial },
        items: saleForUi.items,
        totals: { subtotal, discount, tax, total },
        footer: { note: settings.receiptFooter },
        settings
      });
      downloadText('receipt-escpos.txt', (settings.drawerOpenOnCash && payments.some(p => p.type === 'cash')) ? (escposOpenDrawer() + '\n' + text) : text);
    } else {
      printReceiptHtml(receiptHtml);
    }
    if (navigator.onLine) {
      try {
        const saved = await createSale({ ...sale, clientId: sale.clientId });
        if (saved && (saved.invoiceSerial || saved.receiptNumber)) {
          // no-op: printed already; server holds the official refs
        }
        productUnitsApi.markSoldProductUnits(cart.items.map(item => item.unitId).filter(Boolean));
        void refreshAffectedProducts(dispatch, affectedProductIds);
        toast.show('Sale recorded', { type: 'success' });
      } catch (e) {
        try {
          await enqueueHttp({ collection: 'sales', label: 'Sale', path: '/api/sales', method: 'POST', body: { ...sale, clientId: sale.clientId } });
          productUnitsApi.markSoldProductUnits(cart.items.map(item => item.unitId).filter(Boolean));
          toast.show(sale.items.some(item => Array.isArray(item.soldUnitIds) && item.soldUnitIds.length > 0) ? 'Saved offline. Serialized IMEI sale will sync later and conflicts will be flagged if found.' : 'Network issue: saved offline and will sync later', { type: 'warning' });
        } catch (err) {
          await releaseSerializedCartItems(cart.items);
          cart.items.forEach(i => {
            const ref = skuToRef.get(i.sku);
            if (ref) {
              dispatch(adjustStock({ productId: ref.productId, variantId: ref.variantId, branchId: activeBranchId, inventoryType: isWholesale ? 'wholesale' : 'retail', delta: i.quantity, syncPending: false }));
            }
          });
          toast.show(String(e?.message || 'Failed to record sale'), { type: 'error' });
        }
      } finally {
        setSaving(false);
      }
    } else {
      productUnitsApi.markSoldProductUnits(cart.items.map(item => item.unitId).filter(Boolean));
      toast.show('Saved offline. Will backup when online.', { type: 'success' });
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
        const expectedInventoryType = isWholesale ? 'wholesale' : 'retail';
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
          inventoryType: isWholesale ? 'wholesale' : 'retail',
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
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{modeLabel}</h2>
            <div style={{ color: '#64748b', fontSize: 12 }}>{isWholesale ? `Distribution inventory${activeBranch ? ` • ${activeBranch.name}` : ''}` : `Retail inventory${activeBranch ? ` • ${activeBranch.name}` : ''} with EasyBuy support`}</div>
          </div>
          <OfflineQueueIndicator collection="sales" label="Sales queued" />
        </div>
        <div className="toolbar">
          <input className="input" placeholder="Search name, SKU, barcode, IMEI, or serial number" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKeyDown} style={{ width: '100%' }} />
          <button className="btn" onClick={submitMainSearch}>Search / Add</button>
          {isWholesale && (
          <select className="select" value={selectedPriceTier} onChange={e => setSelectedPriceTier(e.target.value)}>
            {allowedPriceTiers.map(tier => <option key={tier} value={tier}>{getPriceTierLabel(tier)}</option>)}
          </select>
          )}
          <div className="filter-actions">
            <button className={`btn-toggle ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" strokeWidth="2"/></svg>
            </button>
            <button className={`btn-toggle ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2"/></svg>
            </button>
          </div>
        </div>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
          Search by name, SKU, barcode, IMEI, or serial number. If a serialized unit exists in stock for this branch, it will be added directly to cart.
        </div>
        {query.trim().length >= 4 && (
          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <strong>Serialized Matches</strong>
              {liveSerializedLoading ? <InlineSpinner label="Searching IMEI / serial..." /> : null}
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
                            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#dbeafe', color: '#1d4ed8' }}>{matchLabel}</span>
                            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#ecfccb', color: '#3f6212' }}>
                              {branchNameById.get(String(unit.branchId || '')) || activeBranch?.name || 'Branch'}
                            </span>
                            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: String(unit.inventoryType || 'retail') === 'wholesale' ? '#ede9fe' : String(unit.inventoryType || 'retail') === 'warehouse' ? '#e0f2fe' : '#fee2e2', color: String(unit.inventoryType || 'retail') === 'wholesale' ? '#5b21b6' : String(unit.inventoryType || 'retail') === 'warehouse' ? '#0c4a6e' : '#991b1b' }}>
                              {String(unit.inventoryType || 'retail')}
                            </span>
                          </div>
                          {productSpec(product) ? <div style={{ color: '#64748b', fontSize: 12 }}>{productSpec(product)}</div> : null}
                          <div style={{ color: '#64748b', fontSize: 12 }}>SKU: {product.sku}</div>
                          {Array.isArray(product.attributes) && product.attributes.length > 0 ? (
                            <div style={{ color: '#64748b', fontSize: 12 }}>
                              {product.attributes
                                .filter(attr => String(attr?.key || '').trim() && String(attr?.value || '').trim())
                                .slice(0, 3)
                                .map(attr => `${attr.key}: ${attr.value}`)
                                .join(' • ')}
                            </div>
                          ) : null}
                          <div style={{ color: '#64748b', fontSize: 12 }}>IMEI: {renderHighlightedCode(unit.imei || '—', query)}</div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>Serial: {renderHighlightedCode(unit.serialNumber || '—', query)}</div>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                        <div style={{ fontWeight: 800, fontSize: 18 }}>{formatCurrency(product.price, settings)}</div>
                        {isSerializedAlreadyInCart(unit) ? (
                          <span style={{ color: '#b45309', fontSize: 12, fontWeight: 700 }}>Already in cart</span>
                        ) : null}
                        <button
                          className="btn btn-primary"
                          onClick={() => addSerializedUnitToCart(product, unit)}
                          disabled={isSerializedAlreadyInCart(unit) || isSerializedPending(unit)}
                        >
                          {isSerializedAlreadyInCart(unit) ? 'Selected' : isSerializedPending(unit) ? 'Adding...' : 'Add Unit'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !liveSerializedLoading ? (
              <div style={{ color: '#64748b', fontSize: 13 }}>
                No serialized matches found in the current branch yet. Keep typing more digits if needed.
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
                {productSpec(p) && <div className="product-sku" style={{ color: '#64748b' }}>{productSpec(p)}</div>}
                <div className="product-sku">{p.sku}</div>
                <div className="product-price">{formatCurrency(p.price, settings)}</div>
                <div className="product-stock" style={{ color: (p.lowStock ?? 0) > 0 && visibleStockForProduct(p) <= (p.lowStock ?? 0) ? '#ef4444' : undefined }}>
                  Stock: {visibleStockForProduct(p)}{(p.lowStock ?? 0) > 0 && visibleStockForProduct(p) <= (p.lowStock ?? 0) ? ' • Low' : ''}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="product-list">
            {filtered.map(p => (
              <button key={p.id} onClick={() => addToCart(p)} className="product-list-item">
                {p.image && <img src={p.image} alt={p.name} className="thumb" />}
                <div className="meta">
                  <div>
                    <div className="title">{p.name}</div>
                    {productSpec(p) && <div className="sku" style={{ color: '#64748b' }}>{productSpec(p)}</div>}
                    <div className="sku">{p.sku}</div>
                  </div>
                  <div className="stock" style={{ color: (p.lowStock ?? 0) > 0 && visibleStockForProduct(p) <= (p.lowStock ?? 0) ? '#ef4444' : undefined }}>
                    Stock: {visibleStockForProduct(p)}{(p.lowStock ?? 0) > 0 && visibleStockForProduct(p) <= (p.lowStock ?? 0) ? ' • Low' : ''}
                  </div>
                </div>
                <div style={{ fontWeight: 700 }}>{formatCurrency(p.price, settings)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2>Cart</h2>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {heldUiEnabled && (
                <>
                  <button className="btn" onClick={holdCurrentSale} disabled={cart.items.length === 0 || saving}>
                    <svg viewBox="0 0 24 24" fill="none"><path d="M6 6h12v12H6z" stroke="currentColor" strokeWidth="2"/><path d="M9 6v12M15 6v12" stroke="currentColor" strokeWidth="2"/></svg>
                    Hold
                  </button>
                  <button className="btn" onClick={() => setHeldOpen(o => !o)}>
                    <svg viewBox="0 0 24 24" fill="none"><path d="M7 7h10M7 12h10M7 17h10" stroke="currentColor" strokeWidth="2"/></svg>
                    Held ({heldSales.length})
                  </button>
                </>
              )}
              <button className="btn" onClick={startNewSale}>
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
                New Sale
              </button>
            </div>
            {heldUiEnabled && heldOpen && (
              <div style={{ position: 'absolute', right: 0, marginTop: 6, width: 360, maxWidth: '90vw', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 10px 20px rgba(2,6,23,0.15)', zIndex: 30 }}>
                <div style={{ padding: 10, borderBottom: '1px solid #e2e8f0', fontWeight: 700 }}>Held Sales</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, padding: 10, borderBottom: '1px solid #e2e8f0', alignItems: 'center' }}>
                  <input className="input" placeholder="Search label or customer" value={heldQuery} onChange={e => onChangeHeldQuery(e.target.value)} />
                  <label style={{ color: '#64748b', fontSize: 12 }}>Sort</label>
                  <select className="select" value={heldSort} onChange={e => onChangeHeldSort(e.target.value)} style={{ flex: '1 1 auto' }}>
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="labelAZ">Label A–Z</option>
                    <option value="labelZA">Label Z–A</option>
                  </select>
                </div>
                <div style={{ maxHeight: 320, overflow: 'auto' }}>
                  {heldList.map(h => (
                    <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: 8, padding: 10, borderTop: '1px solid #f1f5f9', opacity: deletingHeldId === String(h.id || '') ? 0.55 : 1 }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{h.label || 'Held sale'}</div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>{new Date(h.createdAt).toLocaleString()} • Items: {Array.isArray(h.items) ? h.items.length : 0}</div>
                      </div>
                      <button className="btn" onClick={() => renameHeld(h)} disabled={deletingHeldId === String(h.id || '')}>Rename</button>
                      <button className="btn" onClick={() => resumeHeld(h)} disabled={deletingHeldId === String(h.id || '')}>Resume</button>
                      <button className="btn" onClick={() => deleteHeld(h)} disabled={deletingHeldId === String(h.id || '')}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {deletingHeldId === String(h.id || '') && <InlineSpinner />}
                          {deletingHeldId === String(h.id || '') ? 'Deleting…' : 'Delete'}
                        </span>
                      </button>
                    </div>
                  ))}
                  {heldList.length === 0 && <div style={{ padding: 12, color: '#64748b' }}>No held sales</div>}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Customer (optional)</div>
          {selectedCustomer ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{selectedCustomer.name}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>
                    {selectedCustomer.customerCode || '—'} {selectedCustomer.phone ? `• ${selectedCustomer.phone}` : ''}
                  </div>
                </div>
                <button className="btn" onClick={() => { setSelectedCustomerId(''); setCustomerQuery(''); setEasyBuyEnabled(false); }}>
                  Clear
                </button>
              </div>
              <div style={{ display: 'grid', gap: 4, color: '#475569', fontSize: 13 }}>
                <div>Credit Rank: <strong>{selectedCustomer.creditRank || 'Bronze'}</strong> • Score: <strong>{customerCreditScore}</strong></div>
                <div>Outstanding: <strong>{formatCurrency(customerOutstanding, settings)}</strong></div>
                <div>On-time: <strong>{Number(selectedCustomer.onTimePayments || 0)}</strong> • Late: <strong>{Number(selectedCustomer.latePayments || 0)}</strong></div>
              </div>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <div>
                <input
                  className="input"
                  placeholder="Search by phone, customer ID, name, ID card"
                  value={customerQuery}
                  onChange={e => setCustomerQuery(e.target.value)}
                />
                {customerMatches.length > 0 && (
                  <div style={{ position: 'absolute', top: 44, left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', zIndex: 20 }}>
                    {customerMatches.map(c => (
                      <button
                        key={c.id}
                        className="btn"
                        onClick={() => { setSelectedCustomerId(c.id); setCustomerQuery(''); }}
                        style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0 }}
                      >
                        <span style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 700 }}>{c.name}</div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>{c.customerCode || '—'} {c.phone ? `• ${c.phone}` : ''}</div>
                        </span>
                        <span>Select</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <ul className="cart-list">
          {cart.items.map(item => (
            <li key={item.id} className="cart-item">
              <div className="cart-title">
                <div>{item.name}</div>
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
                  dispatch(setQuantity({ id: item.id, quantity: Number(e.target.value) }));
                }}
                style={{ width: 70 }}
                disabled={!!item.unitId}
              />
              <div style={{ display: 'grid', gap: 6 }}>
                {isWholesale ? (
                <>
                <select
                  className="select"
                  value={item.priceTier || selectedPriceTier}
                  onChange={e => {
                    const tier = e.target.value;
                    const nextPrice = Number(item.prices?.[tier] ?? item.price ?? 0);
                    dispatch(updateItemPricing({ id: item.id, priceTier: tier, price: nextPrice }));
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
                  onChange={e => dispatch(updateItemPricing({ id: item.id, priceTier: item.priceTier || selectedPriceTier, price: Number(e.target.value) || 0 }))}
                  style={{ width: 110 }}
                />
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  R: {formatCurrency(item.prices?.retail ?? item.price, settings)} • W: {formatCurrency(item.prices?.wholesale ?? item.price, settings)} • A: {formatCurrency(item.prices?.agent ?? item.price, settings)}
                </span>
                </>
                ) : (
                <span style={{ fontWeight: 700 }}>{formatCurrency(item.price, settings)}</span>
                )}
              </div>
              <button className="btn" onClick={() => {
                dispatch(removeItem(item.id));
                void releaseSerializedCartItems([item]);
              }}>
                <svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12M10 11v6M14 11v6M9 7l1-2h4l1 2M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="2"/></svg>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="totals-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ color: '#64748b' }}>Manual discount</label>
            <input className="input" type="number" min="0" value={manualDiscount} onChange={e => dispatch(setDiscount(Number(e.target.value)))} style={{ width: 140 }} />
          </div>
          {settings.loyaltyEnabled && selectedCustomer && (
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ color: '#64748b' }}>Redeem points</label>
                <input className="input" type="number" min="0" step="1" value={redeemPoints} onChange={e => setRedeemPoints(e.target.value)} style={{ width: 140 }} />
                <span style={{ color: '#64748b' }}>Available: {availablePoints}</span>
              </div>
              <div style={{ color: '#64748b' }}>Loyalty discount: {formatCurrency(loyaltyDiscount, settings)}</div>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <div>Subtotal: {formatCurrency(subtotal, settings)}</div>
            <div>Discount: {formatCurrency(discount, settings)}</div>
            <div>Tax ({Math.round((taxRate || 0) * 100)}%): {formatCurrency(tax, settings)}</div>
            <div><strong>Total: {formatCurrency(total, settings)}</strong></div>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Payments</h3>
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
                    ? `${easyBuyBlockedItem.name} does not allow ${creditModeLabel.toLowerCase()}`
                    : `Minimum upfront: ${formatCurrency(easyBuyMinimum, settings)}${customerMaxCreditLimit > 0 ? ` • Limit: ${formatCurrency(customerMaxCreditLimit, settings)}` : ''}`}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label>
                    <div style={{ marginBottom: 6, color: '#64748b' }}>Amount paid now</div>
                    <input className="input" type="number" min="0" value={easyBuyAmountPaidNow} onChange={e => setEasyBuyAmountPaidNow(e.target.value)} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#64748b' }}>Due date</div>
                    <input className="input" type="date" value={easyBuyDueDate} onChange={e => setEasyBuyDueDate(e.target.value)} />
                  </label>
                </div>
                <div style={{ color: '#64748b' }}>Paid now: {formatCurrency(paid, settings)} | Remaining balance: {formatCurrency(due, settings)}</div>
              </div>
            ) : (
              <>
                {payments.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <select className="select" value={p.type} onChange={e => updatePayment(i, 'type', e.target.value)}>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="mobile">Mobile</option>
                      <option value="wallet">Wallet</option>
                    </select>
                    <input className="input" type="number" placeholder="amount" value={p.amount} onChange={e => updatePayment(i, 'amount', e.target.value)} style={{ width: 140 }} />
                    {payments.length > 1 && <button className="btn" onClick={() => removePaymentRow(i)}>
                      <svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12M10 11v6M14 11v6M9 7l1-2h4l1 2M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="2"/></svg>
                      Remove
                    </button>}
                  </div>
                ))}
                <button className="btn" onClick={addPaymentRow}>
                  <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
                  Add Payment
                </button>
                <div style={{ marginTop: 6, color: '#64748b' }}>Paid: {formatCurrency(paid, settings)} | Due: {formatCurrency(due, settings)} | Change: {formatCurrency(change, settings)}</div>
              </>
            )}
          </div>
          {canOverrideTax && (
            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ color: '#64748b' }}>Tax override (%)</label>
                <input className="input" type="number" min="0" max="100" step="0.01" value={taxOverridePct} onChange={e => setTaxOverridePct(e.target.value)} style={{ width: 140 }} />
              </div>
              {taxOverridePct !== '' && (
                <input className="input" placeholder="Remark for override (required)" value={taxOverrideRemark} onChange={e => setTaxOverrideRemark(e.target.value)} />
              )}
            </div>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => completeSale(false)} disabled={cart.items.length === 0}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 9V3h12v6" stroke="currentColor" strokeWidth="2"/><path d="M6 17h12v4H6z" stroke="currentColor" strokeWidth="2"/><path d="M4 9h16a2 2 0 012 2v2H2v-2a2 2 0 012-2z" stroke="currentColor" strokeWidth="2"/></svg>
            {saving ? 'Processing…' : 'Complete & Print'}
          </button>
          <button className="btn" onClick={() => completeSale(true)} style={{ marginLeft: 8 }} disabled={cart.items.length === 0 || saving}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 9V3h12v6" stroke="currentColor" strokeWidth="2"/><path d="M6 17h12v4H6z" stroke="currentColor" strokeWidth="2"/><path d="M4 9h16a2 2 0 012 2v2H2v-2a2 2 0 012-2z" stroke="currentColor" strokeWidth="2"/></svg>
            {saving ? 'Processing…' : 'Complete (ESC/POS)'}
          </button>
          <button className="btn" onClick={() => { void releaseSerializedCartItems(cart.items); dispatch(clearCart()); rotateReservationToken(); }} style={{ marginLeft: 8 }} disabled={cart.items.length === 0}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M6 7l1 12h10l1-12M9 7l1-2h4l1 2" stroke="currentColor" strokeWidth="2"/></svg>
            Clear
          </button>
        </div>
        {serializedPickerProduct && (
          <Modal
            title={`Select Serialized Unit • ${serializedPickerProduct.name}`}
            onClose={() => setSerializedPickerProduct(null)}
            footer={<button className="btn" onClick={() => setSerializedPickerProduct(null)}>Close</button>}
          >
            <div style={{ display: 'grid', gap: 12 }}>
              <input
                ref={serializedScanInputRef}
                className="input"
                autoFocus
                placeholder="Scan IMEI barcode or type and press Enter"
                value={serializedScanInput}
                onChange={e => setSerializedScanInput(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && serializedScanInput.trim()) {
                    e.preventDefault();
                    if (reservingSerializedKeys.includes(serializedScanInput.trim())) {
                      toast.show('Serialized item is already being added', { type: 'error' });
                      return;
                    }
                    await addSerializedUnitToCart(serializedPickerProduct, { imei: serializedScanInput.trim(), serialNumber: serializedScanInput.trim() });
                  }
                }}
                style={{ color: '#111827', background: '#ffffff' }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => setSerializedCameraOpen(true)}>Camera Scan</button>
              </div>
              <input
                className="input"
                placeholder="Search existing units"
                value={serializedUnitsQuery}
                onChange={async e => {
                  const value = e.target.value;
                  setSerializedUnitsQuery(value);
                  setSerializedUnitsPage(1);
                  await loadSerializedUnits(serializedPickerProduct, value, 1, serializedUnitsPageSize);
                }}
                style={{ color: '#111827', background: '#ffffff' }}
              />
              <div style={{ overflowX: 'auto', maxHeight: 420 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th align="left">IMEI</th>
                      <th align="left">Serial</th>
                      <th align="left"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {serializedUnits.map(unit => (
                      <tr key={unit._id}>
                        <td style={{ color: '#111827' }}>{unit.imei || '—'}</td>
                        <td style={{ color: '#111827' }}>{unit.serialNumber || '—'}</td>
                        <td style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
                          {isSerializedAlreadyInCart(unit) && <span style={{ color: '#b45309', fontSize: 12 }}>In Cart</span>}
                          {!isSerializedAlreadyInCart(unit) && isSerializedPending(unit) && <span style={{ color: '#2563eb', fontSize: 12 }}>Adding…</span>}
                          <button className="btn btn-primary" onClick={() => addSerializedUnitToCart(serializedPickerProduct, unit)} disabled={isSerializedAlreadyInCart(unit) || isSerializedPending(unit)}>
                            {isSerializedAlreadyInCart(unit) ? 'Selected' : isSerializedPending(unit) ? 'Adding…' : 'Select'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!serializedLoading && serializedUnits.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>No serialized units available</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <button className="btn" onClick={() => { const next = Math.max(1, serializedUnitsPage - 1); setSerializedUnitsPage(next); loadSerializedUnits(serializedPickerProduct, serializedUnitsQuery, next, serializedUnitsPageSize); }} disabled={serializedUnitsPage <= 1 || serializedLoading}>Prev</button>
                  <span style={{ color: '#111827' }}>Page {serializedUnitsPage} of {Math.max(1, Math.ceil(serializedUnitsTotal / serializedUnitsPageSize))}</span>
                  <button className="btn" onClick={() => { const next = Math.min(Math.max(1, Math.ceil(serializedUnitsTotal / serializedUnitsPageSize)), serializedUnitsPage + 1); setSerializedUnitsPage(next); loadSerializedUnits(serializedPickerProduct, serializedUnitsQuery, next, serializedUnitsPageSize); }} disabled={serializedUnitsPage >= Math.max(1, Math.ceil(serializedUnitsTotal / serializedUnitsPageSize)) || serializedLoading}>Next</button>
                </div>
                <label style={{ color: '#111827' }}>
                  <span style={{ marginRight: 6 }}>Rows</span>
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
          title="Scan IMEI Barcode"
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
