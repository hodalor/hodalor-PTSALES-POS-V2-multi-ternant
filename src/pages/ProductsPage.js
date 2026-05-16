import { useDispatch, useSelector } from 'react-redux';
import { addProduct, updateProduct, removeProduct, mergeProducts, setStock } from '../store/productsSlice';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency } from '../utils/currency';
import { addAudit } from '../store/auditSlice';
import { useToast } from '../components/ToastProvider';
import { promptDialog } from '../utils/dialogs';
import { productSpec } from '../utils/productSpec';
import * as productsApi from '../api/products';
import * as stockApi from '../api/stock';
import * as productUnitsApi from '../api/productUnits';
import * as settingsApi from '../api/settings';
import Modal from '../components/Modal';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import { getAllowedPriceTiers, getDisplayPrice, getPreferredPriceTier } from '../utils/priceVisibility';
import { setAllSettings } from '../store/settingsSlice';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import { useAppLanguage } from '../utils/localization';
import { getProductBrand, getProductSearchText } from '../utils/productSearch';

function stripInventoryMapsForProductUpdate(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const next = { ...payload };
  delete next.stockByBranch;
  delete next.wholesaleStockByBranch;
  delete next.warehouseStockByBranch;
  if (Array.isArray(next.variants)) {
    next.variants = next.variants.map((variant) => {
      if (!variant || typeof variant !== 'object') return variant;
      const cleanVariant = { ...variant };
      delete cleanVariant.stockByBranch;
      delete cleanVariant.wholesaleStockByBranch;
      delete cleanVariant.warehouseStockByBranch;
      return cleanVariant;
    });
  }
  return next;
}

function ProductsPage() {
  const dispatch = useDispatch();
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const settings = useSelector(s => s.settings);
  const configuredCategories = useMemo(() => (Array.isArray(settings.categories) ? settings.categories : []), [settings.categories]);
  const availableCategories = useMemo(() => {
    const merged = [...configuredCategories, ...products.map(p => p.category).filter(Boolean)];
    const seen = new Set();
    return merged.filter((item) => {
      const key = String(item || '').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [configuredCategories, products]);
  const categoryOptions = useMemo(() => (availableCategories.length > 0 ? availableCategories : ['General']), [availableCategories]);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const sales = useSelector(s => s.sales.sales);
  const currentBranch = branches.find(b => b.id === currentBranchId);
  const currentBranchLabel = (currentBranch?.code) || (currentBranch?.name) || currentBranchId;
  const currentInventoryType = useMemo(() => (
    String(currentBranch?.branchType || 'retail').toLowerCase() === 'warehouse'
      ? 'warehouse'
      : String(currentBranch?.branchType || 'retail').toLowerCase() === 'wholesale'
        ? 'wholesale'
        : 'retail'
  ), [currentBranch]);
  const auth = useSelector(s => s.auth);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  function has(g) {
    if (!g) return false;
    if (roleLower === 'superadmin') return true;
    return grants.includes(g);
  }
  const canAddProducts = (['admin','manager'].includes(roleLower)) || has('add_products');
  const canEditProducts = (['admin','manager'].includes(roleLower)) || has('edit_products');
  const canEditStock = false;
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const visiblePriceTiers = useMemo(() => getAllowedPriceTiers(auth), [auth]);
  const primaryVisibleTier = useMemo(() => getPreferredPriceTier(visiblePriceTiers, 'retail'), [visiblePriceTiers]);

  const [modalMode, setModalMode] = useState('none'); // none, add, edit
  const [editingId, setEditingId] = useState(null);
  const [tab, setTab] = useState('catalog'); // catalog, reorder, expiry, profitability
  const [leadDays, setLeadDays] = useState(7);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('all');

  // Unified form state
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [warehousePrice, setWarehousePrice] = useState('');
  const [agentPrice, setAgentPrice] = useState('');
  const [category, setCategory] = useState(configuredCategories[0] || '');
  const [newCategory, setNewCategory] = useState('');
  const [initialStock, setInitialStock] = useState(0);
  const [editStockQty, setEditStockQty] = useState(0);
  const [lowStock, setLowStock] = useState(0);
  const [wholesaleLowStock, setWholesaleLowStock] = useState(0);
  const [warehouseLowStock, setWarehouseLowStock] = useState(0);
  const [imagePreview, setImagePreview] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [unitKind, setUnitKind] = useState('none');
  const [unitValue, setUnitValue] = useState('');
  const [unitSymbol, setUnitSymbol] = useState('');
  const [sizeLabel, setSizeLabel] = useState('');
  const [shoeSize, setShoeSize] = useState('');
  const [attrs, setAttrs] = useState([{ key: '', value: '' }]);
  const [packs, setPacks] = useState([{ name: '', quantity: '' }]);
  const [variants, setVariants] = useState([{ label: '', sku: '', price: '' }]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [attrsOpen, setAttrsOpen] = useState(false);
  const [packsOpen, setPacksOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [allowCredit, setAllowCredit] = useState(true);
  const [minimumCreditPercentage, setMinimumCreditPercentage] = useState('');
  const [trackType, setTrackType] = useState('quantity');
  const [serializedModalProduct, setSerializedModalProduct] = useState(null);
  const [serializedEntriesText, setSerializedEntriesText] = useState('');
  const [serializedUnits, setSerializedUnits] = useState([]);
  const [serializedQuery, setSerializedQuery] = useState('');
  const [loadingSerialized, setLoadingSerialized] = useState(false);
  const [serializedPage, setSerializedPage] = useState(1);
  const [serializedPageSize, setSerializedPageSize] = useState(25);
  const [serializedTotal, setSerializedTotal] = useState(0);
  const [serializedScanInput, setSerializedScanInput] = useState('');
  const [serializedBatchMode, setSerializedBatchMode] = useState(true);
  const [serializedCameraOpen, setSerializedCameraOpen] = useState(false);
  const serializedScanInputRef = useRef(null);
  
  const [openStockFor, setOpenStockFor] = useState(null);
  const toast = useToast();
  const { t } = useAppLanguage();
  const [saving, setSaving] = useState(false);

  const filteredCatalogProducts = useMemo(() => {
    const query = String(catalogQuery || '').trim().toLowerCase();
    return products.filter((p) => {
      if (catalogCategory !== 'all' && String(p.category || '') !== String(catalogCategory)) return false;
      if (!query) return true;
      const hay = `${getProductSearchText(p)} ${productSpec(p) || ''}`.toLowerCase();
      return hay.includes(query);
    });
  }, [products, catalogCategory, catalogQuery]);

  useEffect(() => {
    if (!category && categoryOptions.length > 0) setCategory(categoryOptions[0]);
  }, [category, categoryOptions]);

  function resetForm() {
    setName(''); setBrand(''); setSku(''); setPrice(''); setWholesalePrice(''); setWarehousePrice(''); setAgentPrice('');
    setCategory(categoryOptions[0] || 'General'); setNewCategory('');
    setInitialStock(0); setEditStockQty(0); setLowStock(0); setWholesaleLowStock(0); setWarehouseLowStock(0); setImagePreview('');
    setCostPrice(''); setExpiryDate('');
    setUnitKind('none'); setUnitValue(''); setUnitSymbol('');
    setSizeLabel(''); setShoeSize('');
    setAttrs([{ key: '', value: '' }]);
    setPacks([{ name: '', quantity: '' }]);
    setVariants([{ label: '', sku: '', price: '' }]);
    setAdvancedOpen(false);
    setPricingOpen(false);
    setCreditOpen(false);
    setUnitsOpen(false);
    setAttrsOpen(false);
    setPacksOpen(false);
    setVariantsOpen(false);
    setAllowCredit(true);
    setMinimumCreditPercentage('');
    setTrackType('quantity');
  }

  function populateForm(p) {
    const sb = p.stockByBranch || {};
    setEditStockQty(Number(sb?.[currentBranchId] || 0));
    setName(p.name);
    setBrand(getProductBrand(p));
    setSku(p.sku);
    setPrice(String(p.price || 0));
    setWholesalePrice(String(p.wholesalePrice != null ? p.wholesalePrice : (p.price || 0)));
    setWarehousePrice(String(p.warehousePrice != null ? p.warehousePrice : 0));
    setAgentPrice(String(p.agentPrice != null ? p.agentPrice : (p.price || 0)));
    setCostPrice(p.costPrice != null ? String(p.costPrice) : '');
    setExpiryDate(p.expiryDate ? String(p.expiryDate).slice(0, 10) : '');
    setCategory(p.category || '');
    setLowStock(p.lowStock || 0);
    setWholesaleLowStock(p.wholesaleLowStock != null ? p.wholesaleLowStock : (p.lowStock || 0));
    setWarehouseLowStock(p.warehouseLowStock != null ? p.warehouseLowStock : (p.lowStock || 0));
    setImagePreview(p.image || '');
    setUnitKind(p.unitKind || 'none');
    setUnitValue(p.unitValue != null ? String(p.unitValue) : '');
    setUnitSymbol(p.unitSymbol || '');
    setSizeLabel(p.sizeLabel || '');
    setShoeSize(p.shoeSize || '');
    setAllowCredit(p.allowCredit !== false);
    setMinimumCreditPercentage(p.minimumCreditPercentage != null ? String(p.minimumCreditPercentage) : '');
    setTrackType(p.trackType || 'quantity');
    const hasPricing = (p.costPrice != null && String(p.costPrice) !== '' && Number(p.costPrice) > 0) || !!p.expiryDate || Number(p.wholesalePrice || 0) > 0 || Number(p.warehousePrice || 0) > 0 || Number(p.agentPrice || 0) > 0;
    const hasCredit = p.allowCredit === false || Number(p.minimumCreditPercentage || 0) > 0;
    const hasUnits = (p.unitKind && p.unitKind !== 'none') || p.unitValue != null || !!p.unitSymbol || !!p.sizeLabel || !!p.shoeSize;
    const hasAttrs = Array.isArray(p.attributes) && p.attributes.length > 0;
    const hasPacks = Array.isArray(p.packs) && p.packs.length > 0;
    const hasVars = Array.isArray(p.variants) && p.variants.length > 0;
    setAdvancedOpen(hasPricing || hasCredit || hasUnits || hasAttrs || hasPacks || hasVars);
    setPricingOpen(hasPricing);
    setCreditOpen(hasCredit);
    setUnitsOpen(hasUnits);
    setAttrsOpen(hasAttrs);
    setPacksOpen(hasPacks);
    setVariantsOpen(hasVars);
    setAttrs(hasAttrs ? p.attributes.map(a => ({ key: a.key, value: a.value })) : [{ key: '', value: '' }]);
    setPacks(hasPacks ? p.packs.map(pk => ({ name: pk.name, quantity: String(pk.quantity) })) : [{ name: '', quantity: '' }]);
    setVariants(hasVars ? p.variants.map(v => ({ id: v.id, label: v.label, sku: v.sku || '', price: v.price != null ? String(v.price) : '' })) : [{ label: '', sku: '', price: '' }]);
  }

  function openAdd() {
    resetForm();
    setEditingId(null);
    setModalMode('add');
  }

  function startEdit(p) {
    if (!canEditProducts) { toast.show('Not authorized to edit products', { type: 'error' }); return; }
    setEditingId(p.id || p._id || p.sku);
    populateForm(p);
    setModalMode('edit');
  }

  function closeModal() {
    setModalMode('none');
    setEditingId(null);
  }

  async function openSerializedManager(product) {
    setSerializedModalProduct(product);
    setSerializedEntriesText('');
    setSerializedQuery('');
    setSerializedScanInput('');
    setSerializedPage(1);
    setSerializedPageSize(25);
    await loadSerializedUnitsPage(product, '', 1, 25);
  }

  async function loadSerializedUnitsPage(product, queryValue = serializedQuery, pageValue = serializedPage, pageSizeValue = serializedPageSize) {
    setLoadingSerialized(true);
    try {
      const inventoryType = String(currentBranch?.branchType || 'retail').toLowerCase() === 'warehouse'
        ? 'warehouse'
        : String(currentBranch?.branchType || 'retail').toLowerCase() === 'wholesale'
          ? 'wholesale'
          : 'retail';
      const result = await productUnitsApi.listProductUnits({
        productId: product?.id || product?._id || '',
        branchId: currentBranchId,
        inventoryType,
        query: queryValue,
        page: pageValue,
        pageSize: pageSizeValue
      });
      setSerializedUnits(Array.isArray(result?.rows) ? result.rows : []);
      setSerializedTotal(Number(result?.total || 0));
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load serialized units'), { type: 'error' });
      setSerializedUnits([]);
      setSerializedTotal(0);
    } finally {
      setLoadingSerialized(false);
    }
  }

  async function saveSerializedEntries() {
    if (!serializedModalProduct) return;
    const lines = String(serializedEntriesText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.show('Enter IMEI or serial numbers', { type: 'error' });
      return;
    }
    setLoadingSerialized(true);
    try {
      const inventoryType = String(currentBranch?.branchType || 'retail').toLowerCase() === 'warehouse'
        ? 'warehouse'
        : String(currentBranch?.branchType || 'retail').toLowerCase() === 'wholesale'
          ? 'wholesale'
          : 'retail';
      const entries = lines.map(line => {
        const parts = line.split(/[,\t|]/).map(part => part.trim()).filter(Boolean);
        return { imei: parts[0] || '', serialNumber: parts[1] || parts[0] || '' };
      });
      await productUnitsApi.bulkCreateProductUnits({
        productId: serializedModalProduct.id || serializedModalProduct._id,
        branchId: currentBranchId,
        inventoryType,
        entries
      });
      await loadSerializedUnitsPage(serializedModalProduct, serializedQuery, serializedPage, serializedPageSize);
      setSerializedEntriesText('');
      setSerializedScanInput('');
      toast.show('Serialized units added', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to add serialized units'), { type: 'error' });
    } finally {
      setLoadingSerialized(false);
    }
  }

  function appendSerializedEntry(value) {
    const text = String(value || '').trim();
    if (!text) return;
    setSerializedEntriesText(prev => prev ? `${prev}\n${text}` : text);
    setSerializedScanInput('');
    if (serializedBatchMode) {
      setTimeout(() => {
        try { serializedScanInputRef.current?.focus(); } catch {}
      }, 0);
    }
  }

  function copy(text) {
    try {
      navigator.clipboard.writeText(text);
    } catch {}
  }

  function onFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) { setImagePreview(''); return; }
    if (f.size > 2 * 1024 * 1024) {
      toast.show('Image is too large (max 2MB)', { type: 'error' });
      e.target.value = '';
      setImagePreview('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(String(reader.result || ''));
    reader.readAsDataURL(f);
  }

  async function save() {
    if (saving) return;
    const errors = [];
    if (!name.trim()) errors.push('Product name is required');
    if (!sku.trim()) errors.push('SKU is required');
    if (!price || Number(price) <= 0) errors.push('Price is required and must be > 0');

    for (let i = 0; i < packs.length; i++) {
        const p = packs[i];
        const hasName = p.name && p.name.trim();
        const hasQty = p.quantity && Number(p.quantity) > 0;
        const isEmpty = !hasName && !p.quantity;
        if (isEmpty) continue;
        if (hasName && !hasQty) errors.push(`Pack #${i+1}: Quantity is required`);
        else if (!hasName && hasQty) errors.push(`Pack #${i+1}: Name is required`);
    }

    for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const hasLabel = v.label && v.label.trim();
        const hasPrice = v.price !== '' && v.price != null;
        const isEmpty = !hasLabel && !v.sku && !hasPrice;
        if (isEmpty) continue;
        if (!hasLabel) errors.push(`Variant #${i+1}: Label is required (e.g. Size/Color)`);
    }

    if (errors.length > 0) {
        toast.show(errors[0], { type: 'error' });
        return;
    }
    if (trackType === 'serialized' && Number(initialStock || 0) > 0) {
        toast.show('Serialized products must be stocked with IMEI/serial units after saving', { type: 'error' });
        return;
    }

    if (modalMode === 'add') {
        if (!canAddProducts) { toast.show('Not authorized to add products', { type: 'error' }); return; }
        setSaving(true);
        
        const cleanAttrs = (attrs || []).filter(a => a.key && a.value).map(a => ({ key: a.key.trim(), value: a.value.trim() }));
        const qty = Number(initialStock) || 0;
        const branchStock = currentBranchId && qty > 0
          ? (currentInventoryType === 'warehouse'
              ? { warehouseStockByBranch: { [currentBranchId]: qty } }
              : currentInventoryType === 'wholesale'
                ? { wholesaleStockByBranch: { [currentBranchId]: qty } }
                : { stockByBranch: { [currentBranchId]: qty } })
          : {};
        const payload = {
            name: name.trim(),
            brand: brand.trim(),
            sku: sku.trim(),
            trackType,
            price: Number(price),
            retailPrice: Number(price),
            wholesalePrice: Number(wholesalePrice || price || 0),
            warehousePrice: Number(warehousePrice || 0),
            agentPrice: Number(agentPrice || warehousePrice || wholesalePrice || price || 0),
            costPrice: Number(costPrice) || 0,
            expiryDate: expiryDate ? new Date(expiryDate).toISOString() : null,
            category,
            lowStock: Number(lowStock) || 0,
            wholesaleLowStock: Number(wholesaleLowStock) || 0,
            warehouseLowStock: Number(warehouseLowStock) || 0,
            image: imagePreview || null,
            allowCredit,
            minimumCreditPercentage: Math.max(0, Number(minimumCreditPercentage) || 0),
            unitKind,
            unitValue: unitKind === 'volume' || unitKind === 'mass' || unitKind === 'length' ? Number(unitValue) || null : null,
            unitSymbol: unitKind === 'volume' || unitKind === 'mass' || unitKind === 'length' ? unitSymbol : '',
            sizeLabel: unitKind === 'size' ? sizeLabel.trim() : '',
            shoeSize: unitKind === 'shoe' ? shoeSize.trim() : '',
            attributes: cleanAttrs,
            packs: (packs || []).filter(p => p.name && Number(p.quantity) > 0).map(p => ({ name: p.name.trim(), quantity: Number(p.quantity) })),
            variants: (variants || []).filter(v => v.label).map(v => ({ id: crypto.randomUUID(), label: v.label.trim(), sku: v.sku?.trim() || '', price: v.price !== '' ? Number(v.price) : undefined, stockByBranch: {}, wholesaleStockByBranch: {}, warehouseStockByBranch: {} })),
            initialStock: qty,
            initialBranchId: currentBranchId,
            initialInventoryType: currentInventoryType,
            ...branchStock
        };

        if (!navigator.onLine && !offlineBackupAllowed) {
            toast.show('Offline: connect internet and try again.', { type: 'error' });
            setSaving(false); return;
        }

        const action = dispatch(addProduct({ ...payload, offline: !navigator.onLine }));
        const newId = action?.payload?.id;
        const barcode = action?.payload?.barcode;
        const serverPayload = { id: newId, barcode, ...payload };
        if (!navigator.onLine) {
            try {
                await enqueueHttp({ collection: 'products', label: 'Product', path: '/api/products', method: 'POST', body: serverPayload });
            } catch {
                if (newId) dispatch(removeProduct(newId));
                toast.show('Failed to save offline', { type: 'error' });
                setSaving(false); return;
            }
        } else {
            try {
                const created = await productsApi.create(serverPayload);
                if (created && newId) {
                    dispatch(updateProduct({ id: newId, ...created, offline: false, syncPending: true }));
                    dispatch(mergeProducts([created]));
                }
            } catch (e) {
                if (newId) dispatch(removeProduct(newId));
                toast.show(String(e?.message || 'Failed to add product'), { type: 'error' });
                setSaving(false); return;
            }
        }
        
        setSaving(false);
        closeModal();
        toast.show(navigator.onLine ? 'Product added' : 'Saved offline. Will backup when online.', { type: 'success' });

        if (String(trackType || 'quantity') !== 'serialized' && newId && qty > 0) {
            dispatch(addAudit({
                actor: auth.user?.name || 'unknown',
                actionType: 'stock_set_initial',
                details: { product: name.trim(), quantity: qty, branchId: currentBranchId },
                branchId: currentBranchId,
                offline: !navigator.onLine
            }));
        }
        
        dispatch(addAudit({
            actor: auth.user?.name || 'unknown',
            actionType: 'product_add',
            details: { name: name.trim(), sku: sku.trim(), price: Number(price) },
            branchId: currentBranchId,
            offline: !navigator.onLine
        }));

    } else if (modalMode === 'edit') {
        if (!canEditProducts) { toast.show('Not authorized to edit products', { type: 'error' }); return; }
        if (!editingId) return;

        const original = products.find(p => (p.id || p._id || p.sku) === editingId);
        let remark = '';
        if (original && Number(original.price) !== Number(price)) {
            remark = await promptDialog('Enter remark for price change');
            if (!remark || !remark.trim()) { toast.show('Remark is required when changing price', { type: 'error' }); return; }
        }
        setSaving(true);

        const cleanAttrs = (attrs || []).filter(a => a.key && a.value).map(a => ({ key: a.key.trim(), value: a.value.trim() }));
        const nextIdByIdx = new Map();
        const variantsLocal = (variants || []).filter(v => v.label).map((v, idx) => {
            const id = v.id || nextIdByIdx.get(idx) || crypto.randomUUID();
            nextIdByIdx.set(idx, id);
            const prev = original?.variants?.find(x => x.id === id);
            return {
              id,
              label: v.label.trim(),
              sku: v.sku?.trim() || '',
              price: v.price !== '' ? Number(v.price) : undefined,
              stockByBranch: prev?.stockByBranch || {},
              wholesaleStockByBranch: prev?.wholesaleStockByBranch || {},
              warehouseStockByBranch: prev?.warehouseStockByBranch || {}
            };
        });
        const variantsServer = variantsLocal.map(({ stockByBranch, wholesaleStockByBranch, warehouseStockByBranch, ...rest }) => rest);
        const updatedBaseLocal = {
            name: name.trim(),
            brand: brand.trim(),
            sku: sku.trim(),
            trackType,
            price: Number(price),
            retailPrice: Number(price),
            wholesalePrice: Number(wholesalePrice || price || 0),
            warehousePrice: Number(warehousePrice || 0),
            agentPrice: Number(agentPrice || warehousePrice || wholesalePrice || price || 0),
            costPrice: Number(costPrice) || 0,
            expiryDate: expiryDate ? new Date(expiryDate).toISOString() : null,
            category,
            lowStock: Number(lowStock) || 0,
            wholesaleLowStock: Number(wholesaleLowStock) || 0,
            warehouseLowStock: Number(warehouseLowStock) || 0,
            image: imagePreview || null,
            allowCredit,
            minimumCreditPercentage: Math.max(0, Number(minimumCreditPercentage) || 0),
            unitKind,
            unitValue: (unitKind === 'volume' || unitKind === 'mass' || unitKind === 'length') ? (Number(unitValue) || null) : null,
            unitSymbol: (unitKind === 'volume' || unitKind === 'mass' || unitKind === 'length') ? unitSymbol : '',
            sizeLabel: unitKind === 'size' ? sizeLabel.trim() : '',
            shoeSize: unitKind === 'shoe' ? shoeSize.trim() : '',
            attributes: cleanAttrs,
            packs: (packs || []).filter(p => p.name && Number(p.quantity) > 0).map(p => ({ name: p.name.trim(), quantity: Number(p.quantity) })),
            variants: variantsLocal
        };
        const sameImage = String(imagePreview || '') === String(original?.image || '');
        const updatedBaseServer = stripInventoryMapsForProductUpdate({
            ...updatedBaseLocal,
            image: sameImage ? undefined : (imagePreview || null),
            variants: variantsServer
        });

        const localId = original?.id || original?._id || editingId;
        const updated = { id: localId, ...updatedBaseLocal };
        
        const serverId = original?._id || original?.id || null;
        if (!navigator.onLine && !offlineBackupAllowed) {
            toast.show('Offline: connect internet and try again.', { type: 'error' });
            setSaving(false); return;
        }
        if (serverId) {
            if (!navigator.onLine) {
                dispatch(updateProduct({ ...updated, offline: true }));
                try {
                    await enqueueHttp({ collection: 'products', label: 'Product update', path: `/api/products/${encodeURIComponent(serverId)}`, method: 'PUT', body: stripInventoryMapsForProductUpdate({ id: original?.id, ...updatedBaseServer }) });
                } catch {
                    toast.show('Failed to save offline', { type: 'error' });
                    setSaving(false); return;
                }
            } else {
                try {
                    await productsApi.update(serverId, stripInventoryMapsForProductUpdate({ id: original?.id, ...updatedBaseServer }));
                    dispatch(updateProduct(updated));
                } catch (e) {
                    toast.show(String(e?.message || 'Failed to update product'), { type: 'error' });
                    setSaving(false); return;
                }
            }
        } else {
            dispatch(updateProduct({ ...updated, offline: !navigator.onLine }));
        }
        if (canEditStock && original && String(original.trackType || 'quantity') !== 'serialized') {
            const pid = original.id || original._id || editingId;
            const stockField = currentInventoryType === 'warehouse'
              ? 'warehouseStockByBranch'
              : currentInventoryType === 'wholesale'
                ? 'wholesaleStockByBranch'
                : 'stockByBranch';
            const prev = Number(original?.[stockField]?.[currentBranchId] || 0);
            const next = Number(editStockQty) || 0;
            if (prev !== next) {
                if (!navigator.onLine) {
                    if (!offlineBackupAllowed) {
                        toast.show('Offline: cannot save stock. Connect internet and try again.', { type: 'error' });
                        setSaving(false); return;
                    }
                    dispatch(setStock({ productId: pid, branchId: currentBranchId, quantity: next, inventoryType: currentInventoryType, syncPending: true }));
                    try {
                        await enqueueHttp({ collection: 'audits', label: 'Stock set', path: '/api/stock/set', method: 'POST', body: { productId: original._id || original.id || pid, branchId: currentBranchId, quantity: next, actor: auth.user?.name || 'unknown', inventoryType: currentInventoryType } });
                    } catch {
                        dispatch(setStock({ productId: pid, branchId: currentBranchId, quantity: prev, inventoryType: currentInventoryType, syncPending: false }));
                        toast.show('Failed to save offline', { type: 'error' });
                        setSaving(false); return;
                    }
                } else {
                    dispatch(setStock({ productId: pid, branchId: currentBranchId, quantity: next, inventoryType: currentInventoryType, syncPending: true }));
                    stockApi.setStock({
                        productId: original._id || original.id || pid,
                        branchId: currentBranchId,
                        quantity: next,
                        actor: auth.user?.name || 'unknown',
                        inventoryType: currentInventoryType
                    }).then(() => {
                        void refreshAffectedProducts(dispatch, [pid]);
                    }).catch(() => {
                        dispatch(setStock({ productId: pid, branchId: currentBranchId, quantity: prev, inventoryType: currentInventoryType, syncPending: false }));
                        toast.show('Failed to save stock. Check your permission or connection.', { type: 'error' });
                    });
                }
            }
        }

        const changed = {};
        if (original) {
            if (original.name !== name.trim()) changed.name = { from: original.name, to: name.trim() };
            if ((getProductBrand(original) || '') !== brand.trim()) changed.brand = { from: getProductBrand(original) || '', to: brand.trim() };
            if (original.sku !== sku.trim()) changed.sku = { from: original.sku, to: sku.trim() };
            if (Number(original.price) !== Number(price)) changed.price = { from: Number(original.price), to: Number(price) };
            if (Number(original.wholesalePrice || original.price || 0) !== (Number(wholesalePrice || price) || 0)) changed.wholesalePrice = { from: Number(original.wholesalePrice || original.price || 0), to: Number(wholesalePrice || price) || 0 };
            if (Number(original.warehousePrice || 0) !== (Number(warehousePrice || 0) || 0)) changed.warehousePrice = { from: Number(original.warehousePrice || 0), to: Number(warehousePrice || 0) || 0 };
            if (Number(original.agentPrice || original.price || 0) !== (Number(agentPrice || warehousePrice || wholesalePrice || price) || 0)) changed.agentPrice = { from: Number(original.agentPrice || original.price || 0), to: Number(agentPrice || warehousePrice || wholesalePrice || price) || 0 };
            if ((original.category || '') !== category) changed.category = { from: original.category || '', to: category };
            if ((original.lowStock || 0) !== Number(lowStock)) changed.lowStock = { from: original.lowStock || 0, to: Number(lowStock) };
            if ((original.wholesaleLowStock ?? original.lowStock ?? 0) !== Number(wholesaleLowStock)) changed.wholesaleLowStock = { from: original.wholesaleLowStock ?? original.lowStock ?? 0, to: Number(wholesaleLowStock) };
            if ((original.warehouseLowStock ?? original.lowStock ?? 0) !== Number(warehouseLowStock)) changed.warehouseLowStock = { from: original.warehouseLowStock ?? original.lowStock ?? 0, to: Number(warehouseLowStock) };
            if (Number(original.costPrice || 0) !== (Number(costPrice) || 0)) changed.costPrice = { from: Number(original.costPrice || 0), to: Number(costPrice) || 0 };
            if ((original.allowCredit !== false) !== allowCredit) changed.allowCredit = { from: original.allowCredit !== false, to: allowCredit };
            if (Number(original.minimumCreditPercentage || 0) !== (Number(minimumCreditPercentage) || 0)) changed.minimumCreditPercentage = { from: Number(original.minimumCreditPercentage || 0), to: Number(minimumCreditPercentage) || 0 };
            const oldExp = original.expiryDate ? String(original.expiryDate).slice(0, 10) : '';
            if (oldExp !== (expiryDate || '')) changed.expiryDate = { from: oldExp, to: expiryDate || '' };
            if ((original.unitKind || 'none') !== unitKind) changed.unitKind = { from: original.unitKind || 'none', to: unitKind };
        }
        
        dispatch(addAudit({
            actor: auth.user?.name || 'unknown',
            actionType: 'product_update',
            details: { id: editingId, changed },
            remark,
            branchId: currentBranchId,
            offline: !navigator.onLine
        }));
        
        setSaving(false);
        closeModal();
        toast.show(navigator.onLine ? 'Product updated' : 'Saved offline. Will backup when online.', { type: 'success' });
    }
  }

  async function addCat() {
    const value = String(newCategory || '').trim();
    if (!value) return;
    if (categoryOptions.some(item => String(item).toLowerCase() === value.toLowerCase())) {
      setCategory(categoryOptions.find(item => String(item).toLowerCase() === value.toLowerCase()) || value);
      setNewCategory('');
      return;
    }
    const nextCategories = [...configuredCategories, value];
    dispatch(setAllSettings({ ...(settings || {}), categories: nextCategories }));
    setCategory(value);
    setNewCategory('');
    try {
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return;
        }
        await enqueueHttp({ collection: 'settings', label: 'Category settings', path: '/api/settings', method: 'PUT', body: { categories: nextCategories } });
        toast.show('Category saved offline. Will backup when online.', { type: 'success' });
        return;
      }
      await settingsApi.save({ categories: nextCategories });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to save category'), { type: 'error' });
    }
  }

  const unitSymbolOptions = useMemo(() => {
    if (unitKind === 'volume') return ['mL', 'L'];
    if (unitKind === 'mass') return ['g', 'kg'];
    if (unitKind === 'length') return ['mm', 'cm', 'm', 'in'];
    return [];
  }, [unitKind]);

  const reorder = useMemo(() => {
    const fromTs = Date.now() - 14 * 24 * 3600 * 1000;
    const unitsByProduct = new Map();
    for (const s of sales) {
      const ts = new Date(s.created_at).getTime();
      if (ts < fromTs) continue;
      if (String(s.branchId || '') !== String(currentBranchId || '')) continue;
      for (const it of s.items || []) {
        const pid = String(it.productId || '');
        const qty = Number(it.qty) || 0;
        if (!pid || qty <= 0) continue;
        unitsByProduct.set(pid, (unitsByProduct.get(pid) || 0) + qty);
      }
    }
    const out = [];
    for (const p of products) {
      const cur = Number(p.stockByBranch?.[currentBranchId] || 0);
      const avgDaily = (unitsByProduct.get(String(p.id)) || 0) / 14;
      const target = Math.ceil(avgDaily * Math.max(0, Number(leadDays) || 0) + (Number(p.lowStock) || 0));
      const suggest = Math.max(0, target - cur);
      const low = Number(p.lowStock) || 0;
      const daysCover = avgDaily > 0 ? Math.round((cur / avgDaily) * 10) / 10 : null;
      if (suggest > 0 || (low > 0 && cur <= low)) {
        out.push({ id: p.id, name: p.name, sku: p.sku, current: cur, lowStock: low, avgDaily: Math.round(avgDaily * 100) / 100, daysCover, suggest });
      }
    }
    return out.sort((a, b) => b.suggest - a.suggest).slice(0, 50);
  }, [products, sales, currentBranchId, leadDays]);

  const expirySoon = useMemo(() => {
    const now = Date.now();
    const soonMs = 30 * 24 * 3600 * 1000;
    return products
      .filter(p => p.expiryDate)
      .map(p => ({ id: p.id, name: p.name, sku: p.sku, expiry: String(p.expiryDate).slice(0, 10), ts: new Date(p.expiryDate).getTime() }))
      .filter(x => x.ts >= now && x.ts <= now + soonMs)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 50);
  }, [products]);

  const productProfit = useMemo(() => {
    const fromTs = Date.now() - 30 * 24 * 3600 * 1000;
    const map = new Map();
    for (const s of sales) {
      const ts = new Date(s.created_at).getTime();
      if (ts < fromTs) continue;
      if (String(s.branchId || '') !== String(currentBranchId || '')) continue;
      for (const it of s.items || []) {
        const pid = it.productId || '';
        const key = `${pid}:${it.variantId || ''}`;
        if (!map.has(key)) map.set(key, { key, name: it.name || it.sku || '—', units: 0, revenue: 0, cost: 0, profit: 0 });
        const row = map.get(key);
        const qty = Number(it.qty) || 0;
        const price = Number(it.price) || 0;
        const prod = products.find(p => String(p.id) === String(pid));
        const cp = Number(prod?.costPrice || 0);
        row.units += qty;
        row.revenue += qty * price;
        row.cost += qty * (Number.isFinite(cp) ? cp : 0);
        row.profit = row.revenue - row.cost;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.profit - a.profit).slice(0, 20);
  }, [sales, products, currentBranchId]);

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>{t('Products')}</h1>
          <div className="page-subtitle-compact">{t('Manage catalog structure, pricing, stock signals, expiry, and profitability from one polished workspace.')}</div>
        </div>
        <div className="page-header-actions">
          <OfflineQueueIndicator collection="products" label={t('Products queued')} />
          <OfflineQueueIndicator collection="audits" label={t('Stock queued')} />
          {canAddProducts && (
            <button className="btn btn-primary" onClick={openAdd}>
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
              {t('Add Product')}
            </button>
          )}
        </div>
      </div>

      <div className="page-tabs">
        <button className={tab === 'catalog' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('catalog')}>{t('Catalog')}</button>
        <button className={tab === 'reorder' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('reorder')}>{t('Auto Reorder')}</button>
        <button className={tab === 'expiry' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('expiry')}>{t('Expiry Alerts')}</button>
        <button className={tab === 'profitability' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('profitability')}>{t('Profitability')}</button>
      </div>

      {tab === 'reorder' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="section-title">{t('Auto Reorder Suggestions')}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="section-note">{t('Lead days')}</span>
              <input className="input" type="number" min="0" max="60" value={leadDays} onChange={e => setLeadDays(Number(e.target.value))} style={{ width: 90 }} />
            </div>
          </div>
          <div className="section-note" style={{ marginBottom: 8 }}>{t('Based on last 14 days sales + low stock')} ({currentBranchLabel})</div>
          <table className="table">
            <thead>
              <tr>
                <th align="left">{t('Product')}</th>
                <th align="left">{t('SKU')}</th>
                <th align="left">{t('Current')}</th>
                <th align="left">{t('Low')}</th>
                <th align="left">{t('Avg/day')}</th>
                <th align="left">{t('Days cover')}</th>
                <th align="left">{t('Suggest')}</th>
              </tr>
            </thead>
            <tbody>
              {reorder.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.sku}</td>
                  <td>{r.current}</td>
                  <td>{r.lowStock}</td>
                  <td>{r.avgDaily}</td>
                  <td>{r.daysCover == null ? '—' : r.daysCover}</td>
                  <td style={{ fontWeight: 700 }}>{r.suggest}</td>
                </tr>
              ))}
              {reorder.length === 0 && <tr><td colSpan="7" style={{ padding: 12, color: '#64748b' }}>{t('No reorder suggestions')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'expiry' && (
        <div className="card">
          <h2 className="section-title">{t('Expiry Alerts (30 days)')}</h2>
          <table className="table">
            <thead>
              <tr>
                <th align="left">{t('Product')}</th>
                <th align="left">{t('SKU')}</th>
                <th align="left">{t('Expiry')}</th>
              </tr>
            </thead>
            <tbody>
              {expirySoon.map(x => (
                <tr key={x.id}>
                  <td>{x.name}</td>
                  <td>{x.sku}</td>
                  <td>{x.expiry}</td>
                </tr>
              ))}
              {expirySoon.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>{t('No expiring products')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'profitability' && (
        <div className="card">
          <h2 className="section-title">{t('Product-level Profitability (Top 20)')}</h2>
          <div className="section-note" style={{ marginBottom: 8 }}>{t('Last 30 days. Profit requires cost price.')} ({currentBranchLabel})</div>
          <table className="table">
            <thead>
              <tr>
                <th align="left">{t('Product')}</th>
                <th align="left">{t('Units')}</th>
                <th align="left">{t('Revenue')}</th>
                <th align="left">{t('Profit')}</th>
              </tr>
            </thead>
            <tbody>
              {productProfit.map(x => (
                <tr key={x.key}>
                  <td>{x.name}</td>
                  <td>{x.units}</td>
                  <td>{formatCurrency(x.revenue, settings)}</td>
                  <td>{formatCurrency(x.profit, settings)}</td>
                </tr>
              ))}
              {productProfit.length === 0 && <tr><td colSpan="4" style={{ padding: 12, color: '#64748b' }}>{t('No sales in range')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'catalog' && (
      <div className="card">
        <h2 className="section-title">{t('Catalog')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12, marginBottom: 12 }}>
          <label>
            <div className="field-label">{t('Search')}</div>
            <input className="input" value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder={t('Name, brand, SKU, barcode, spec')} />
          </label>
          <label>
            <div className="field-label">{t('Category')}</div>
            <select className="select" value={catalogCategory} onChange={(e) => setCatalogCategory(e.target.value)}>
              <option value="all">{t('All Categories')}</option>
              {categoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="table-wrap">
        <table className="table products-catalog-table">
          <thead>
            <tr>
              <th align="left">{t('Image')}</th>
              <th align="left">{t('Name')}</th>
              <th align="left">{t('Brand')}</th>
              <th align="left">{t('SKU')}</th>
              <th align="left">{t('Spec')}</th>
              <th align="left">{t('Barcode')}</th>
              <th align="left">{t('Price')}</th>
              <th align="left">{t('Category')}</th>
              <th align="left">{t('Low')}</th>
              <th align="left">{t('Stock')} ({currentBranchLabel})</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredCatalogProducts.map(p => (
              <tr key={p.id || p._id || p.sku}>
                <td>
                  {p.image ? <img src={p.image} alt={p.name} className="thumb" /> : <span style={{ color: '#94a3b8' }}>—</span>}
                </td>
                <td className="name-cell">{p.name}</td>
                <td>{getProductBrand(p) || '—'}</td>
                <td>{p.sku}</td>
                <td className="spec-cell"><span style={{ color: '#64748b' }}>{productSpec(p) || '—'}</span></td>
                <td>
                  {p.barcode ? (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <code style={{ fontSize: 12, color: '#0f172a' }}>{p.barcode}</code>
                      <button className="btn btn-compact" onClick={() => copy(p.barcode)} title={t('Copy barcode')}>
                        <svg viewBox="0 0 24 24" fill="none"><path d="M9 9h11v11H9z" stroke="currentColor" strokeWidth="2"/><path d="M5 5h11v11" stroke="currentColor" strokeWidth="2"/></svg>
                        {t('Copy')}
                      </button>
                    </div>
                  ) : '-'}
                </td>
                <td className="price-cell">{formatCurrency(getDisplayPrice(p, primaryVisibleTier), settings)}</td>
                <td className="category-cell">{p.category || '-'}</td>
                <td>{p.lowStock ?? 0}</td>
                <td>
                  {Array.isArray(p.variants) && p.variants.length > 0 ? (
                    <button className="btn btn-compact" onClick={() => {
                      const key = p.id || p._id || p.sku;
                      setOpenStockFor(o => o === key ? null : key);
                    }}>{t('Variants')}</button>
                  ) : (
                  <input
                    className="input stock-input"
                    type="number"
                    min="0"
                    value={(currentInventoryType === 'warehouse' ? p.warehouseStockByBranch : currentInventoryType === 'wholesale' ? p.wholesaleStockByBranch : p.stockByBranch)?.[currentBranchId] || 0}
                    onChange={e => {
                      if (String(p.trackType || 'quantity') === 'serialized') {
                        toast.show(t('Serialized stock changes only through IMEI or serial unit actions'), { type: 'warning' });
                        return;
                      }
                      if (!canEditStock) {
                        toast.show(t('Not authorized to edit stock'), { type: 'error' });
                        return;
                      }
                      const q = Number(e.target.value);
                      const pid = p.id || p._id || p.sku;
                      const prev = (currentInventoryType === 'warehouse' ? p.warehouseStockByBranch : currentInventoryType === 'wholesale' ? p.wholesaleStockByBranch : p.stockByBranch)?.[currentBranchId] || 0;
                      if (!navigator.onLine) {
                        if (!offlineBackupAllowed) {
                          toast.show(t('Offline: connect internet and try again.'), { type: 'error' });
                          return;
                        }
                        dispatch(setStock({ productId: pid, branchId: currentBranchId, quantity: q, inventoryType: currentInventoryType, syncPending: true }));
                        enqueueHttp({ collection: 'audits', label: 'Stock set', path: '/api/stock/set', method: 'POST', body: { productId: p.id || p._id || p.sku, branchId: currentBranchId, quantity: q, actor: auth.user?.name || 'unknown', inventoryType: currentInventoryType } })
                          .catch(() => {
                            dispatch(setStock({ productId: pid, branchId: currentBranchId, quantity: prev, inventoryType: currentInventoryType, syncPending: false }));
                            toast.show(t('Failed to save offline'), { type: 'error' });
                          });
                        return;
                      }
                      dispatch(setStock({ productId: pid, branchId: currentBranchId, quantity: q, inventoryType: currentInventoryType, syncPending: true }));
                      stockApi.setStock({
                        productId: p.id || p._id || p.sku,
                        branchId: currentBranchId,
                        quantity: q,
                        actor: auth.user?.name || 'unknown',
                        inventoryType: currentInventoryType
                      }).then(() => {
                        void refreshAffectedProducts(dispatch, [pid]);
                      }).catch(() => {
                        dispatch(setStock({ productId: pid, branchId: currentBranchId, quantity: prev, inventoryType: currentInventoryType, syncPending: false }));
                        toast.show(t('Failed to save stock. Check your permission or connection.'), { type: 'error' });
                      });
                    }}
                    disabled={!canEditStock || String(p.trackType || 'quantity') === 'serialized'}
                  />
                  )}
                </td>
                <td>
                  <div className="products-row-actions">
                  {canEditProducts && (
                  <button className="btn btn-compact" onClick={() => startEdit(p)}>
                    <svg viewBox="0 0 24 24" fill="none"><path d="M4 21h4l11-11-4-4L4 17v4z" stroke="currentColor" strokeWidth="2"/></svg>
                    {t('Edit')}
                  </button>
                  )}
                  {String(p.trackType || 'quantity') === 'serialized' && (
                  <button className="btn btn-compact" onClick={() => openSerializedManager(p)}>
                    {t('Units')}
                  </button>
                  )}
                  {(roleLower === 'admin' || roleLower === 'superadmin') && (
                  <button
                    className="btn btn-compact"
                    onClick={() => {
                      const localKey = p.id || p._id || p.sku;
                      const serverKey = p._id || p.id;
                      (async () => {
                        if (!navigator.onLine) {
                          if (!offlineBackupAllowed) {
                            toast.show(t('Offline: connect internet and try again.'), { type: 'error' });
                            return;
                          }
                          dispatch(removeProduct(localKey));
                          try {
                            await enqueueHttp({ collection: 'products', label: 'Product delete', path: `/api/products/${encodeURIComponent(serverKey || localKey)}`, method: 'DELETE', body: {} });
                            toast.show(t('Saved offline. Will backup when online.'), { type: 'success' });
                          } catch {
                            toast.show(t('Failed to save offline'), { type: 'error' });
                          }
                          return;
                        }
                        try {
                          if (serverKey) await productsApi.remove(serverKey);
                          dispatch(removeProduct(localKey));
                        } catch {
                          toast.show(t('Failed to remove product on server'), { type: 'error' });
                        }
                      })();
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none"><path d="M6 7h12M10 11v6M14 11v6M9 7l1-2h4l1 2M7 7l1 12h8l1-12" stroke="currentColor" strokeWidth="2"/></svg>
                    {t('Remove')}
                  </button>
                  )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredCatalogProducts.map(p => (
              (openStockFor === (p.id || p._id || p.sku) && Array.isArray(p.variants) && p.variants.length > 0) ? (
                <tr key={`${p.id || p._id || p.sku}-variants`} style={{ background: '#fbfdff' }}>
                  <td colSpan="11">
                    <div style={{ display: 'grid', gap: 6, padding: 8 }}>
                      {p.variants.map(v => (
                        <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, alignItems: 'center' }}>
                          <div><strong>{v.label}</strong> <span style={{ color: '#64748b' }}>{v.sku || ''}</span></div>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            value={(currentInventoryType === 'warehouse' ? v.warehouseStockByBranch : currentInventoryType === 'wholesale' ? v.wholesaleStockByBranch : v.stockByBranch)?.[currentBranchId] || 0}
                            onChange={e => {
                              if (String(v.trackType || p.trackType || 'quantity') === 'serialized') {
                                toast.show(t('Serialized stock changes only through IMEI or serial unit actions'), { type: 'warning' });
                                return;
                              }
                              if (!canEditStock) {
                                toast.show(t('Not authorized to edit stock'), { type: 'error' });
                                return;
                              }
                              const q = Number(e.target.value);
                              const pid = p.id || p._id || p.sku;
                              const prev = (currentInventoryType === 'warehouse' ? v.warehouseStockByBranch : currentInventoryType === 'wholesale' ? v.wholesaleStockByBranch : v.stockByBranch)?.[currentBranchId] || 0;
                              if (!navigator.onLine) {
                                if (!offlineBackupAllowed) {
                                  toast.show(t('Offline: connect internet and try again.'), { type: 'error' });
                                  return;
                                }
                                dispatch(setStock({ productId: p.id || p._id || p.sku, variantId: v.id, branchId: currentBranchId, quantity: q, inventoryType: currentInventoryType, syncPending: true }));
                                enqueueHttp({ collection: 'audits', label: 'Variant stock set', path: '/api/stock/set', method: 'POST', body: { productId: p.id || p._id || p.sku, variantId: v.id, branchId: currentBranchId, quantity: q, actor: auth.user?.name || 'unknown', inventoryType: currentInventoryType } })
                                  .catch(() => {
                                    dispatch(setStock({ productId: pid, variantId: v.id, branchId: currentBranchId, quantity: prev, inventoryType: currentInventoryType, syncPending: false }));
                                    toast.show(t('Failed to save offline'), { type: 'error' });
                                  });
                                return;
                              }
                              dispatch(setStock({ productId: p.id || p._id || p.sku, variantId: v.id, branchId: currentBranchId, quantity: q, inventoryType: currentInventoryType, syncPending: true }));
                              stockApi.setStock({
                                productId: p.id || p._id || p.sku,
                                variantId: v.id,
                                branchId: currentBranchId,
                                quantity: q,
                                actor: auth.user?.name || 'unknown',
                                inventoryType: currentInventoryType
                              }).then(() => {
                                void refreshAffectedProducts(dispatch, [pid]);
                              }).catch(() => {
                                dispatch(setStock({ productId: pid, variantId: v.id, branchId: currentBranchId, quantity: prev, inventoryType: currentInventoryType, syncPending: false }));
                                toast.show(t('Failed to save variant stock. Check your permission or connection.'), { type: 'error' });
                              });
                            }}
                            style={{ width: 120 }}
                            disabled={!canEditStock || String(v.trackType || p.trackType || 'quantity') === 'serialized'}
                          />
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ) : null
            ))}
            {filteredCatalogProducts.length === 0 ? (
              <tr>
                <td colSpan="11" style={{ padding: 12, color: '#64748b' }}>{t('No products match the current search or filter.')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </div>
      </div>
      )}

      {modalMode !== 'none' && (
        <Modal
          title={modalMode === 'add' ? t('Add Product') : t('Edit Product')}
          onClose={() => { if (!saving) closeModal(); }}
          footer={
            <>
              <button className="btn" onClick={closeModal} disabled={saving}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? t('Saving…') : (modalMode === 'add' ? t('Add Product') : t('Save Changes'))}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {modalMode === 'add' ? (
                <div>
                  <label className="label">{t('Initial Stock')} ({currentBranchLabel})</label>
                  <input className="input" type="number" min="0" value={initialStock} onChange={e => setInitialStock(Number(e.target.value))} style={{ display: 'block', width: '100%' }} disabled={trackType === 'serialized'} />
                  {trackType === 'serialized' && <div style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>{t('Serialized products are stocked only through IMEI or serial unit entry.')}</div>}
                </div>
              ) : (
                <div>
                  <label className="label">{t('Stock')} ({currentBranchLabel})</label>
                  <input className="input" type="number" min="0" value={editStockQty} onChange={e => setEditStockQty(Number(e.target.value))} style={{ display: 'block', width: '100%' }} disabled={!canEditStock || trackType === 'serialized'} />
                  {trackType === 'serialized' && <div style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>{t('Serialized stock changes only through IMEI or serial unit actions.')}</div>}
                </div>
              )}
              <div>
                <label className="label">{t('Low Stock Alert')}</label>
                <input className="input" type="number" min="0" value={lowStock} onChange={e => setLowStock(Number(e.target.value))} style={{ display: 'block', width: '100%' }} />
              </div>
              <div>
                <label className="label">{t('Wholesale Low Stock Alert')}</label>
                <input className="input" type="number" min="0" value={wholesaleLowStock} onChange={e => setWholesaleLowStock(Number(e.target.value))} style={{ display: 'block', width: '100%' }} />
              </div>
              <div>
                <label className="label">{t('Warehouse Low Stock Alert')}</label>
                <input className="input" type="number" min="0" value={warehouseLowStock} onChange={e => setWarehouseLowStock(Number(e.target.value))} style={{ display: 'block', width: '100%' }} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                    <label className="label">{t('Name')}</label>
                    <input className="input" placeholder={t('Name')} value={name} onChange={e => setName(e.target.value)} style={{ display: 'block', width: '100%' }} />
                </div>
                <div>
                    <label className="label">{t('Brand')}</label>
                    <input className="input" placeholder={t('Brand')} value={brand} onChange={e => setBrand(e.target.value)} style={{ display: 'block', width: '100%' }} />
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <div>
                    <label className="label">{t('SKU')}</label>
                    <input className="input" placeholder={t('SKU')} value={sku} onChange={e => setSku(e.target.value)} style={{ display: 'block', width: '100%' }} />
                </div>
                {visiblePriceTiers.includes('retail') && (
                  <div>
                      <label className="label">{t('Retail Price')}</label>
                      <input className="input" placeholder={t('Retail selling price')} type="number" value={price} onChange={e => setPrice(e.target.value)} style={{ display: 'block', width: '100%' }} />
                  </div>
                )}
                {visiblePriceTiers.includes('wholesale') && (
                  <div>
                      <label className="label">{t('Wholesale Price')}</label>
                      <input className="input" placeholder={t('Wholesale selling price')} type="number" value={wholesalePrice} onChange={e => setWholesalePrice(e.target.value)} style={{ display: 'block', width: '100%' }} />
                  </div>
                )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div>
                <label className="label">{t('Warehouse Price')}</label>
                <input className="input" placeholder={t('Warehouse selling price')} type="number" value={warehousePrice} onChange={e => setWarehousePrice(e.target.value)} style={{ display: 'block', width: '100%' }} />
              </div>
              {visiblePriceTiers.includes('agent') && (
                <div>
                  <label className="label">{t('Agent Price')}</label>
                  <input className="input" placeholder={t('Agent selling price')} type="number" value={agentPrice} onChange={e => setAgentPrice(e.target.value)} style={{ display: 'block', width: '100%' }} />
                </div>
              )}
              <div>
                <label className="label">{t('Track Type')}</label>
                <select className="select" value={trackType} onChange={e => setTrackType(e.target.value)} style={{ display: 'block', width: '100%' }}>
                  <option value="quantity">{t('Quantity')}</option>
                  <option value="serialized">{t('Serialized')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">{t('Credit Rules')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 42 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={allowCredit} onChange={e => setAllowCredit(e.target.checked)} />
                  {t('Allow EasyBuy')}
                </label>
              </div>
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>
              {t('Retail, Wholesale, Warehouse, and Agent prices are stored separately and used independently across POS, inventory, sales, and invoices.')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                    <label className="label">{t('Category')}</label>
                    <select className="select" value={category} onChange={e => setCategory(e.target.value)} style={{ display: 'block', width: '100%' }}>
                        {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div>
                     {/* Category add input */}
                     <label className="label">{t('New Category')}</label>
                     <div style={{ display: 'flex', gap: 8 }}>
                        <input className="input" placeholder={t('New category')} value={newCategory} onChange={e => setNewCategory(e.target.value)} style={{ flex: 1 }} />
                        <button className="btn" type="button" onClick={addCat}>{t('Add')}</button>
                     </div>
                </div>
            </div>

            <div>
              <button className="btn" onClick={() => setAdvancedOpen(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{t('More Fields')}</span>
                <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
                  {advancedOpen ? (
                    <svg viewBox="0 0 24 24" fill="none"><path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </span>
              </button>
            </div>

            {advancedOpen && (
              <>
                <div className="dark-panel">
                  <button className="btn" onClick={() => setPricingOpen(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('Pricing & Expiry')}</span>
                    <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
                      {pricingOpen ? (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      )}
                    </span>
                  </button>
                  {pricingOpen && (
                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <label>
                        <div className="label" style={{ color: '#cbd5e1' }}>{t('Cost Price (per unit)')}</div>
                        <div className="section-note" style={{ marginTop: 4 }}>{t('Your purchase price (capital). Used to calculate profit.')}</div>
                        <input className="input" type="number" min="0" step="0.01" placeholder={t('e.g. 10.00')} value={costPrice} onChange={e => setCostPrice(e.target.value)} />
                      </label>
                      <label>
                        <div className="label" style={{ color: '#cbd5e1' }}>{t('Expiry Date')}</div>
                        <div className="section-note" style={{ marginTop: 4 }}>{t('Use for products that expire (alerts and inventory planning).')}</div>
                        <input className="input" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
                      </label>
                    </div>
                  )}
                </div>

                <div className="dark-panel">
                  <button className="btn" onClick={() => setCreditOpen(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('EasyBuy Product Rules')}</span>
                    <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
                      {creditOpen ? (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      )}
                    </span>
                  </button>
                  {creditOpen && (
                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <label>
                        <div className="label" style={{ color: '#cbd5e1' }}>{t('Allow credit')}</div>
                        <select className="select" value={allowCredit ? 'yes' : 'no'} onChange={e => setAllowCredit(e.target.value === 'yes')}>
                          <option value="yes">{t('Yes')}</option>
                          <option value="no">{t('No')}</option>
                        </select>
                      </label>
                      <label>
                        <div className="label" style={{ color: '#cbd5e1' }}>{t('Minimum upfront %')}</div>
                        <input className="input" type="number" min="0" max="100" step="0.01" value={minimumCreditPercentage} onChange={e => setMinimumCreditPercentage(e.target.value)} />
                      </label>
                    </div>
                  )}
                </div>

                <div className="dark-panel">
                  <button className="btn" onClick={() => setUnitsOpen(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('Units & Size')}</span>
                    <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
                      {unitsOpen ? (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      )}
                    </span>
                  </button>
                  {unitsOpen && (
                    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div className="section-note" style={{ gridColumn: '1 / span 2' }}>
                        {t('Use this when the same product needs a clear size/measurement shown in POS and invoices.')}
                      </div>
                      <label>
                        <div className="label" style={{ color: '#cbd5e1' }}>{t('Type')}</div>
                        <div className="section-note" style={{ marginTop: 4 }}>{t('Choose how to describe the product (e.g. volume for drinks, size for clothing).')}</div>
                        <select className="select" value={unitKind} onChange={e => setUnitKind(e.target.value)}>
                          <option value="none">{t('None')}</option>
                          <option value="volume">{t('Volume')}</option>
                          <option value="mass">{t('Mass')}</option>
                          <option value="length">{t('Length')}</option>
                          <option value="size">{t('Clothing Size')}</option>
                          <option value="shoe">{t('Shoe Size')}</option>
                        </select>
                      </label>
                      {(unitKind === 'volume' || unitKind === 'mass' || unitKind === 'length') && (
                        <>
                          <label>
                            <div className="label" style={{ color: '#cbd5e1' }}>{t('Value')}</div>
                            <div className="section-note" style={{ marginTop: 4 }}>{t('Example: 500 with Unit mL means "500mL".')}</div>
                            <input className="input" type="number" placeholder={t('e.g. 500')} value={unitValue} onChange={e => setUnitValue(e.target.value)} />
                          </label>
                          <label>
                            <div className="label" style={{ color: '#cbd5e1' }}>{t('Unit')}</div>
                            <select className="select" value={unitSymbol} onChange={e => setUnitSymbol(e.target.value)}>
                              <option value="">{t('Select')}</option>
                              {unitSymbolOptions.map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </label>
                        </>
                      )}
                      {unitKind === 'size' && (
                        <label style={{ gridColumn: '1 / span 2' }}>
                          <div className="label" style={{ color: '#cbd5e1' }}>{t('Size')}</div>
                          <div className="section-note" style={{ marginTop: 4 }}>{t('Use for clothing sizes (shown on receipts and sales reports).')}</div>
                          <input className="input" value={sizeLabel} onChange={e => setSizeLabel(e.target.value)} placeholder={t('e.g. Shirt: L, XL')} />
                        </label>
                      )}
                      {unitKind === 'shoe' && (
                        <label style={{ gridColumn: '1 / span 2' }}>
                          <div className="label" style={{ color: '#cbd5e1' }}>{t('Shoe Size')}</div>
                          <div className="section-note" style={{ marginTop: 4 }}>{t('Use when shoes have different sizes (EU/US).')}</div>
                          <input className="input" value={shoeSize} onChange={e => setShoeSize(e.target.value)} placeholder={t('e.g. Shoe EU 46 / US 9')} />
                        </label>
                      )}
                    </div>
                  )}
                </div>

                <div className="dark-panel">
                  <button className="btn" onClick={() => setAttrsOpen(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('Attributes')}</span>
                    <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
                      {attrsOpen ? (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      )}
                    </span>
                  </button>
                  {attrsOpen && (
                    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                      <div className="section-note">
                        {t('Use attributes for extra details like Brand, Color, Model, Material. Helps searching and reporting.')}
                      </div>
                      {attrs.map((row, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                          <input className="input" placeholder={t('Key (e.g. Brand)')} value={row.key} onChange={e => {
                            const v = e.target.value;
                            setAttrs(prev => prev.map((r, i) => i === idx ? { ...r, key: v } : r));
                          }} />
                          <input className="input" placeholder={t('Value (e.g. Nike)')} value={row.value} onChange={e => {
                            const v = e.target.value;
                            setAttrs(prev => prev.map((r, i) => i === idx ? { ...r, value: v } : r));
                          }} />
                          <button className="btn" onClick={() => setAttrs(prev => prev.filter((_, i) => i !== idx))}>{t('Remove')}</button>
                        </div>
                      ))}
                      <button className="btn" onClick={() => setAttrs(prev => [...prev, { key: '', value: '' }])}>{t('Add Attribute')}</button>
                    </div>
                  )}
                </div>

                <div className="dark-panel">
                  <button className="btn" onClick={() => setPacksOpen(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('Packs')}</span>
                    <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
                      {packsOpen ? (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      )}
                    </span>
                  </button>
                  {packsOpen && (
                    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                      <div className="section-note">
                        {t('Use packs when you sell in multiples (e.g. Carton of 12). POS can use this for faster entry.')}
                      </div>
                      {packs.map((row, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: 8 }}>
                          <input className="input" placeholder={t('Name (e.g. Carton)')} value={row.name} onChange={e => {
                            const v = e.target.value;
                            setPacks(prev => prev.map((r, i) => i === idx ? { ...r, name: v } : r));
                          }} />
                          <input className="input" type="number" min="1" placeholder={t('Qty (e.g. 12)')} value={row.quantity} onChange={e => {
                            const v = e.target.value;
                            setPacks(prev => prev.map((r, i) => i === idx ? { ...r, quantity: v } : r));
                          }} />
                          <button className="btn" onClick={() => setPacks(prev => prev.filter((_, i) => i !== idx))}>{t('Remove')}</button>
                        </div>
                      ))}
                      <button className="btn" onClick={() => setPacks(prev => [...prev, { name: '', quantity: '' }])}>{t('Add Pack')}</button>
                    </div>
                  )}
                </div>

                <div className="dark-panel">
                  <button className="btn" onClick={() => setVariantsOpen(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{t('Variants')}</span>
                    <span style={{ display: 'inline-flex', width: 18, height: 18 }}>
                      {variantsOpen ? (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      )}
                    </span>
                  </button>
                  {variantsOpen && (
                    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                      <div className="section-note">
                        {t('Use variants when one product has different options with their own SKU/price/stock (e.g. colors, sizes, 500mL vs 1L).')}
                      </div>
                      {variants.map((row, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px auto', gap: 8 }}>
                          <input className="input" placeholder={t('Label (e.g. Red / XL / 1L)')} value={row.label} onChange={e => {
                            const v = e.target.value;
                            setVariants(prev => prev.map((r, i) => i === idx ? { ...r, label: v } : r));
                          }} />
                          <input className="input" placeholder={t('SKU (e.g. SKU-RED)')} value={row.sku} onChange={e => {
                            const v = e.target.value;
                            setVariants(prev => prev.map((r, i) => i === idx ? { ...r, sku: v } : r));
                          }} />
                          <input className="input" type="number" placeholder={t('Price (e.g. 25.00)')} value={row.price} onChange={e => {
                            const v = e.target.value;
                            setVariants(prev => prev.map((r, i) => i === idx ? { ...r, price: v } : r));
                          }} />
                          <button className="btn" onClick={() => setVariants(prev => prev.filter((_, i) => i !== idx))}>{t('Remove')}</button>
                        </div>
                      ))}
                      <button className="btn" onClick={() => setVariants(prev => [...prev, { label: '', sku: '', price: '' }])}>{t('Add Variant')}</button>
                    </div>
                  )}
                </div>
              </>
            )}

            <div>
                <label className="label">{t('Product Image')}</label>
                <input type="file" accept="image/*" onChange={onFileChange} />
                {imagePreview && <div style={{ marginTop: 8 }}><img src={imagePreview} alt={t('preview')} className="thumb" /></div>}
            </div>

          </div>
        </Modal>
      )}
      {serializedModalProduct && (
        <Modal
          title={`${t('Serialized Units')} • ${serializedModalProduct.name}`}
          onClose={() => { if (!loadingSerialized) setSerializedModalProduct(null); }}
          footer={(
            <>
              <button className="btn" onClick={() => setSerializedModalProduct(null)} disabled={loadingSerialized}>{t('Close')}</button>
              <button className="btn btn-primary" onClick={saveSerializedEntries} disabled={loadingSerialized}>
                {loadingSerialized ? t('Saving…') : t('Add Units')}
              </button>
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="section-note">
              {t('Enter one IMEI or serial per line. You can also use IMEI,SerialNumber on the same line.')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className={serializedBatchMode ? 'btn btn-primary' : 'btn'} onClick={() => { setSerializedBatchMode(v => !v); setTimeout(() => { try { serializedScanInputRef.current?.focus(); } catch {} }, 0); }}>
                {serializedBatchMode ? t('Batch Mode On') : t('Batch Mode Off')}
              </button>
              <button className="btn" onClick={() => setSerializedCameraOpen(true)}>
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
            <textarea className="input" rows={8} value={serializedEntriesText} onChange={e => setSerializedEntriesText(e.target.value)} placeholder={'IMEI123456789\nSN-0001\nIMEI987654321,SN-0002'} style={{ color: '#111827', background: '#ffffff' }} />
            <input className="input" placeholder={t('Search existing units')} value={serializedQuery} onChange={async e => {
              const value = e.target.value;
              setSerializedQuery(value);
              if (!serializedModalProduct) return;
              setSerializedPage(1);
              try { await loadSerializedUnitsPage(serializedModalProduct, value, 1, serializedPageSize); } catch {}
            }} style={{ color: '#111827', background: '#ffffff' }} />
            <div style={{ overflowX: 'auto', maxHeight: 360 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">{t('IMEI')}</th>
                    <th align="left">{t('Serial')}</th>
                    <th align="left">{t('Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {serializedUnits.map(unit => (
                    <tr key={unit._id}>
                      <td style={{ color: '#111827' }}>{unit.imei || '—'}</td>
                      <td style={{ color: '#111827' }}>{unit.serialNumber || '—'}</td>
                      <td style={{ color: '#111827' }}>{unit.status}</td>
                    </tr>
                  ))}
                  {!loadingSerialized && serializedUnits.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>{t('No serialized units found for this branch')}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="pagination-row">
              <div className="pagination-controls">
                <button className="btn" onClick={() => { const next = Math.max(1, serializedPage - 1); setSerializedPage(next); loadSerializedUnitsPage(serializedModalProduct, serializedQuery, next, serializedPageSize); }} disabled={serializedPage <= 1 || loadingSerialized}>{t('Prev')}</button>
                <span className="table-meta" style={{ color: '#111827' }}>{t('Page')} {serializedPage} {t('of')} {Math.max(1, Math.ceil(serializedTotal / serializedPageSize))}</span>
                <button className="btn" onClick={() => { const next = Math.min(Math.max(1, Math.ceil(serializedTotal / serializedPageSize)), serializedPage + 1); setSerializedPage(next); loadSerializedUnitsPage(serializedModalProduct, serializedQuery, next, serializedPageSize); }} disabled={serializedPage >= Math.max(1, Math.ceil(serializedTotal / serializedPageSize)) || loadingSerialized}>{t('Next')}</button>
              </div>
              <label style={{ color: '#111827' }}>
                <span className="field-label" style={{ marginBottom: 0, marginRight: 6, color: '#111827' }}>{t('Rows')}</span>
                <select className="select" value={serializedPageSize} onChange={e => { const nextSize = Number(e.target.value); setSerializedPageSize(nextSize); setSerializedPage(1); loadSerializedUnitsPage(serializedModalProduct, serializedQuery, 1, nextSize); }} style={{ color: '#111827', background: '#ffffff' }}>
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
        onDetected={(value) => {
          appendSerializedEntry(value);
          setSerializedCameraOpen(false);
        }}
      />
    </div>
  );
}

export default ProductsPage;
