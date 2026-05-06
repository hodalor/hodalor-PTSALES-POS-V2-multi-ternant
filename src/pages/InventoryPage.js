import { useDispatch, useSelector } from 'react-redux';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { setStock } from '../store/productsSlice';
import { addAudit } from '../store/auditSlice';
import BranchSelect from '../components/BranchSelect';
import * as stockApi from '../api/stock';
import { formatCurrency } from '../utils/currency';
import { useToast } from '../components/ToastProvider';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import { getAllowedPriceTiers, getDisplayPrice, getPriceTierLabel } from '../utils/priceVisibility';
import { refreshAffectedProducts } from '../utils/inventoryRefresh';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import Modal from '../components/Modal';
import { useAppLanguage } from '../utils/localization';
import { getBranchStock, getTotalStock } from '../utils/branchStock';
import { getProductBrand, getProductSearchText } from '../utils/productSearch';

function branchTypeBadgeStyle(branchType = 'retail') {
  const kind = String(branchType || 'retail').toLowerCase();
  if (kind === 'warehouse') return { background: '#ede9fe', color: '#6d28d9' };
  if (kind === 'wholesale') return { background: '#dbeafe', color: '#1d4ed8' };
  return { background: '#dcfce7', color: '#166534' };
}

function shouldShowBranchTypeBadge(branchType = 'retail') {
  return String(branchType || 'retail').toLowerCase() !== 'retail';
}

function normalizeInventoryType(value = 'retail') {
  const kind = String(value || 'retail').toLowerCase();
  if (kind === 'warehouse') return 'warehouse';
  if (kind === 'wholesale') return 'wholesale';
  return 'retail';
}

function InventoryPage() {
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const allowManualStockEdit = false;
  const [branchId, setBranchId] = useState(currentBranchId);
  const [viewInventoryType, setViewInventoryType] = useState('retail');
  const [modalId, setModalId] = useState(null);
  const [openVariantsFor, setOpenVariantsFor] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('pdf');
  const [exportIncludeVariants, setExportIncludeVariants] = useState(true);
  const [exportFieldKeys, setExportFieldKeys] = useState([]);
  const dispatch = useDispatch();
  const toast = useToast();
  const { t } = useAppLanguage();
  const visiblePriceTiers = useMemo(() => getAllowedPriceTiers(auth), [auth]);
  const isAllBranches = String(branchId || '') === 'all';
  const inventoryTypeLabel = useMemo(() => viewInventoryType === 'wholesale' ? t('Distribution') : viewInventoryType === 'warehouse' ? t('Warehouse') : t('Retail'), [t, viewInventoryType]);
  const inventoryPriceTierLabel = useMemo(() => getPriceTierLabel(viewInventoryType === 'wholesale' ? 'wholesale' : viewInventoryType === 'warehouse' ? 'warehouse' : 'retail'), [viewInventoryType]);

  const branch = useMemo(() => (isAllBranches ? null : (branches.find(b => b.id === branchId) || branches[0])), [branches, branchId, isAllBranches]);
  const selectedBranchInventoryType = useMemo(() => normalizeInventoryType(branch?.branchType), [branch?.branchType]);
  const inventoryTypeLocked = !isAllBranches && !!branch;
  const categoryOptions = useMemo(() => Array.from(new Set(products.map((p) => String(p.category || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [products]);
  const baseFilteredRows = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== 'all' && String(p.category || '') !== String(categoryFilter)) return false;
      if (term) {
        const hay = getProductSearchText(p);
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [products, categoryFilter, search]);
  const productOptions = useMemo(() => baseFilteredRows.map((p) => ({ id: p.id, name: p.name, brand: getProductBrand(p) })).sort((a, b) => a.name.localeCompare(b.name)), [baseFilteredRows]);
  const rows = useMemo(() => (
    productFilter === 'all'
      ? baseFilteredRows
      : baseFilteredRows.filter((p) => String(p.id) === String(productFilter))
  ), [baseFilteredRows, productFilter]);
  useEffect(() => { setBranchId(currentBranchId); }, [currentBranchId]);
  useEffect(() => {
    if (String(branchId || '') === 'all') return;
    const selectedBranch = branches.find((item) => String(item.id) === String(branchId));
    if (!selectedBranch) return;
    const nextType = normalizeInventoryType(selectedBranch.branchType);
    setViewInventoryType((prev) => prev === nextType ? prev : nextType);
  }, [branches, branchId]);
  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryOptions.includes(categoryFilter)) setCategoryFilter('all');
  }, [categoryOptions, categoryFilter]);
  useEffect(() => {
    if (productFilter !== 'all' && !productOptions.some((item) => String(item.id) === String(productFilter))) setProductFilter('all');
  }, [productFilter, productOptions]);
  const selected = useMemo(() => rows.find(p => p.id === modalId) || null, [rows, modalId]);

  const getStockForProduct = useCallback((product, targetBranchId = branchId) => {
    if (!targetBranchId || String(targetBranchId) === 'all') return getTotalStock(product, viewInventoryType);
    return getBranchStock(product, targetBranchId, viewInventoryType);
  }, [branchId, viewInventoryType]);

  const getSalePrice = useCallback((product) => {
    return Number(
      viewInventoryType === 'warehouse'
        ? (product.warehousePrice != null ? product.warehousePrice : 0)
        : viewInventoryType === 'wholesale'
          ? (product.wholesalePrice != null ? product.wholesalePrice : product.price || 0)
          : (product.retailPrice != null ? product.retailPrice : product.price || 0)
    );
  }, [viewInventoryType]);

  const summary = useMemo(() => {
    const stockTotals = rows.map((p) => getStockForProduct(p, branchId));
    const totalStock = stockTotals.reduce((sum, qty) => sum + (Number(qty) || 0), 0);
    const totalCost = rows.reduce((sum, p) => sum + ((Number(p.costPrice || 0) || 0) * getStockForProduct(p, branchId)), 0);
    const expectedRevenue = rows.reduce((sum, p) => sum + (getSalePrice(p) * getStockForProduct(p, branchId)), 0);
    const expectedProfit = rows.reduce((sum, p) => {
      const qty = getStockForProduct(p, branchId);
      const margin = getSalePrice(p) - Number(p.costPrice || 0);
      return sum + (margin * qty);
    }, 0);
    return {
      categories: new Set(rows.map((p) => String(p.category || 'Uncategorized'))).size,
      totalItems: rows.length,
      totalStock,
      totalCost,
      expectedRevenue,
      expectedProfit
    };
  }, [rows, branchId, getSalePrice, getStockForProduct]);

  const getEntityStock = useCallback((entity, targetBranchId = branchId) => {
    if (!targetBranchId || String(targetBranchId) === 'all') return getTotalStock(entity, viewInventoryType);
    return getBranchStock(entity, targetBranchId, viewInventoryType);
  }, [branchId, viewInventoryType]);

  const getEntitySalePrice = useCallback((entity, parent = null) => {
    const source = entity || parent || {};
    if (viewInventoryType === 'warehouse') return Number(source.warehousePrice != null ? source.warehousePrice : (parent?.warehousePrice != null ? parent.warehousePrice : 0));
    if (viewInventoryType === 'wholesale') return Number(source.wholesalePrice != null ? source.wholesalePrice : (parent?.wholesalePrice != null ? parent.wholesalePrice : source.price || parent?.price || 0));
    return Number(source.retailPrice != null ? source.retailPrice : (parent?.retailPrice != null ? parent.retailPrice : source.price || parent?.price || 0));
  }, [viewInventoryType]);

  const exportRows = useMemo(() => {
    const branchLabel = isAllBranches ? 'All Branches' : (branch?.name || branch?.code || branchId || '');
    const branchCode = isAllBranches ? 'ALL' : (branch?.code || '');
    const branchType = isAllBranches ? 'all' : String(branch?.branchType || 'retail');
    return rows.flatMap((product) => {
      const productRow = {
        name: product.name || '',
        variant: '',
        category: product.category || 'Uncategorized',
        sku: product.sku || '',
        barcode: product.barcode || '',
        branch: branchLabel,
        branchCode,
        branchType,
        inventoryType: inventoryTypeLabel,
        priceTier: inventoryPriceTierLabel,
        stock: getEntityStock(product, branchId),
        costPrice: Number(product.costPrice || 0),
        salePrice: getEntitySalePrice(product),
        lowStock: Number(product.lowStock ?? 0)
      };
      if (!exportIncludeVariants || !Array.isArray(product.variants) || product.variants.length === 0) return [productRow];
      const variantRows = product.variants.map((variant) => ({
        ...productRow,
        name: product.name || '',
        variant: variant.label || '',
        sku: variant.sku || product.sku || '',
        barcode: variant.barcode || product.barcode || '',
        stock: getEntityStock(variant, branchId),
        salePrice: getEntitySalePrice(variant, product)
      }));
      return [productRow, ...variantRows];
    });
  }, [branch, branchId, exportIncludeVariants, getEntitySalePrice, getEntityStock, inventoryPriceTierLabel, inventoryTypeLabel, isAllBranches, rows]);

  const exportHeaders = useMemo(() => [
    { key: 'name', label: 'Product' },
    { key: 'variant', label: 'Variant' },
    { key: 'category', label: 'Category' },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barcode' },
    { key: 'branch', label: 'Branch' },
    { key: 'branchCode', label: 'Branch Code' },
    { key: 'branchType', label: 'Branch Type' },
    { key: 'inventoryType', label: 'Inventory Type' },
    { key: 'priceTier', label: 'Price Tier' },
    { key: 'stock', label: 'Stock' },
    { key: 'costPrice', label: 'Cost Price' },
    { key: 'salePrice', label: 'Sale Price' },
    { key: 'lowStock', label: 'Low Stock Threshold' }
  ], []);
  useEffect(() => {
    setExportFieldKeys((prev) => {
      const nextDefault = exportHeaders.map((h) => h.key);
      if (!Array.isArray(prev) || prev.length === 0) return nextDefault;
      const allowed = new Set(nextDefault);
      const filtered = prev.filter((key) => allowed.has(key));
      return filtered.length > 0 ? filtered : nextDefault;
    });
  }, [exportHeaders]);
  const selectedExportHeaders = useMemo(() => {
    const selected = new Set(exportFieldKeys);
    return exportHeaders.filter((header) => selected.has(header.key));
  }, [exportFieldKeys, exportHeaders]);

  function exportInventory(format) {
    if (selectedExportHeaders.length === 0) {
      toast.show(t('Select at least one field to export'), { type: 'error' });
      return;
    }
    const branchPart = isAllBranches ? 'all-branches' : (branch?.code || branch?.name || branchId || 'branch');
    const categoryPart = categoryFilter === 'all' ? 'all-categories' : String(categoryFilter).replace(/\s+/g, '-').toLowerCase();
    const scope = isAllBranches ? 'All Branches' : (branch?.name || branch?.code || branchId || 'Branch');
    const category = categoryFilter === 'all' ? t('All Categories') : categoryFilter;
    const exportedAt = new Date().toLocaleString();
    if (format === 'csv') {
      exportCsv(`inventory-${viewInventoryType}-${branchPart}-${categoryPart}.csv`, selectedExportHeaders, exportRows);
      setExportOpen(false);
      return;
    }
    exportTablePdf(`${t('Inventory')} - ${inventoryTypeLabel} - ${scope} - ${category}`, selectedExportHeaders, exportRows, {
      letterhead: {
        logoUrl: settings?.clientLogoUrl || '/clientlogo512.png',
        companyName: settings?.receiptBrandName || settings?.clientAppName || settings?.appName || 'ptSales POS',
        branch: scope,
        phone: settings?.businessPhone || '',
        address: settings?.invoiceCompanyAddress || ''
      },
      meta: [
        { label: t('Price Tier'), value: inventoryPriceTierLabel },
        { label: t('Exported At'), value: exportedAt },
        { label: t('Generated By'), value: auth.user?.name || 'unknown' },
        { label: t('Category'), value: category },
        { label: t('Variant Rows'), value: exportIncludeVariants ? t('Included') : t('Products only') },
        { label: t('Fields'), value: selectedExportHeaders.map((h) => h.label).join(', ') }
      ]
    });
    setExportOpen(false);
  }

  function setStockWithAudit(p, variantId, bId, quantity) {
    if (String(p.trackType || 'quantity') === 'serialized') {
      toast.show(t('Serialized stock changes only through IMEI or serial unit actions'), { type: 'warning' });
      return;
    }
    if (!allowManualStockEdit) {
      toast.show(t('Manual stock editing is disabled'), { type: 'warning' });
      return;
    }
    const stockField = viewInventoryType === 'warehouse'
      ? 'warehouseStockByBranch'
      : viewInventoryType === 'wholesale'
        ? 'wholesaleStockByBranch'
        : 'stockByBranch';
    const oldQty = variantId
      ? ((p.variants?.find(v => v.id === variantId)?.[stockField] || {})[bId] || 0)
      : ((p[stockField] || {})[bId] || 0);
    const delta = Number(quantity) - Number(oldQty);
    if (!navigator.onLine && !offlineBackupAllowed) {
      toast.show(t('Offline: cannot save stock changes'), { type: 'error' });
      return;
    }
    dispatch(setStock({ productId: p.id, variantId: variantId || undefined, branchId: bId, quantity: Number(quantity), inventoryType: viewInventoryType, syncPending: true }));
    dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: 'stock_set_manual',
      details: { product: p.name, variant: (p.variants || []).find(v => v.id === variantId)?.label || '', quantity: Number(quantity), delta, branchId: bId },
      branchId: bId,
      offline: !navigator.onLine
    }));
    const payload = {
      productId: p.id,
      branchId: bId,
      quantity: Number(quantity),
      actor: auth.user?.name || 'unknown',
      variantId: variantId || undefined,
      inventoryType: viewInventoryType
    };
    if (!navigator.onLine) {
      enqueueHttp({ collection: 'audits', label: 'Stock set', path: '/api/stock/set', method: 'POST', body: payload })
        .catch(() => {
          dispatch(setStock({ productId: p.id, variantId: variantId || undefined, branchId: bId, quantity: Number(oldQty), inventoryType: viewInventoryType, syncPending: false }));
          toast.show(t('Failed to save offline'), { type: 'error' });
        });
      return;
    }
    stockApi.setStock(payload)
      .then(() => { void refreshAffectedProducts(dispatch, [p.id]); })
      .catch((e) => {
        dispatch(setStock({ productId: p.id, variantId: variantId || undefined, branchId: bId, quantity: Number(oldQty), inventoryType: viewInventoryType, syncPending: false }));
        toast.show(String(e?.message || t('Failed to save stock')), { type: 'error' });
      });
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>{t('Inventory')}</h1>
          <div className="page-subtitle-compact">{t('Search stock quickly by branch, category, brand, SKU, barcode, and active inventory type.')}</div>
        </div>
        <div className="page-header-actions">
          <button className="btn" onClick={() => setExportOpen(true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 3v12m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="2"/><path d="M5 21h14" stroke="currentColor" strokeWidth="2"/></svg>
            {t('Export')}
          </button>
          <OfflineQueueIndicator collection="audits" label={t('Stock queued')} />
        </div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="filter-grid-wide">
          <label>
            <div className="field-label">{t('Branch')}</div>
            <BranchSelect value={branchId} onChange={setBranchId} includeAll allLabel={t('All Branches')} style={{ minWidth: 180 }} />
          </label>
          <label>
            <div className="field-label">{t('Category')}</div>
            <select className="select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="all">{t('All Categories')}</option>
              {categoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <div className="field-label">{t('Product')}</div>
            <select className="select" value={productFilter} onChange={e => setProductFilter(e.target.value)}>
              <option value="all">{t('All Products')}</option>
              {productOptions.map((item) => <option key={item.id} value={item.id}>{item.brand ? `${item.name} (${item.brand})` : item.name}</option>)}
            </select>
          </label>
          <label>
            <div className="field-label">{t('Search')}</div>
            <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Name, brand, SKU, barcode')} />
          </label>
          {!isAllBranches && branch && shouldShowBranchTypeBadge(branch.branchType) && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, ...branchTypeBadgeStyle(branch.branchType) }}>
                {String(branch.branchType || 'retail')}
              </span>
            </div>
          )}
          <div className="filter-actions filter-actions-end" style={{ gridColumn: '1 / -1' }}>
            <button
              className={viewInventoryType === 'retail' ? 'btn btn-primary' : 'btn'}
              onClick={() => !inventoryTypeLocked && setViewInventoryType('retail')}
              disabled={inventoryTypeLocked}
              title={inventoryTypeLocked ? `${t('Locked to')} ${inventoryTypeLabel} ${t('for')} ${branch?.name || branch?.code || t('selected branch')}` : t('Show retail stock')}
            >
              {t('Retail')}
            </button>
            <button
              className={viewInventoryType === 'wholesale' ? 'btn btn-primary' : 'btn'}
              onClick={() => !inventoryTypeLocked && setViewInventoryType('wholesale')}
              disabled={inventoryTypeLocked}
              title={inventoryTypeLocked ? `${t('Locked to')} ${inventoryTypeLabel} ${t('for')} ${branch?.name || branch?.code || t('selected branch')}` : t('Show distribution stock')}
            >
              {t('Distribution')}
            </button>
            <button
              className={viewInventoryType === 'warehouse' ? 'btn btn-primary' : 'btn'}
              onClick={() => !inventoryTypeLocked && setViewInventoryType('warehouse')}
              disabled={inventoryTypeLocked}
              title={inventoryTypeLocked ? `${t('Locked to')} ${inventoryTypeLabel} ${t('for')} ${branch?.name || branch?.code || t('selected branch')}` : t('Show warehouse stock')}
            >
              {t('Warehouse')}
            </button>
            {inventoryTypeLocked ? (
              <span style={{ color: '#64748b', fontSize: 12 }}>
                {t('Locked to')} <strong>{selectedBranchInventoryType === 'wholesale' ? t('Distribution') : selectedBranchInventoryType === 'warehouse' ? t('Warehouse') : t('Retail')}</strong> {t('for')} <strong>{branch?.name || branch?.code || t('selected branch')}</strong>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-label">{t('Categories')}</div><div className="stat-value">{summary.categories}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Total Items')}</div><div className="stat-value">{summary.totalItems}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Total Stock')}</div><div className="stat-value">{summary.totalStock}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Total Cost')}</div><div className="stat-value-compact">{formatCurrency(summary.totalCost, settings)}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Expected Revenue')}</div><div className="stat-value-compact">{formatCurrency(summary.expectedRevenue, settings)}</div></div>
        <div className="card stat-card"><div className="stat-label">{t('Expected Profit')}</div><div className="stat-value-compact">{formatCurrency(summary.expectedProfit, settings)}</div></div>
      </div>
      {exportOpen && (
        <Modal
          title={t('Export Inventory')}
          variant="light"
          onClose={() => setExportOpen(false)}
          footer={(
            <>
              <button className="btn" onClick={() => setExportOpen(false)}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={() => exportInventory(exportFormat)}>{t('Export')}</button>
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <label>
                <div className="field-label">{t('Format')}</div>
                <select className="select" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                  <option value="pdf">PDF</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
              <label style={{ display: 'grid', alignContent: 'end' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={exportIncludeVariants} onChange={(e) => setExportIncludeVariants(e.target.checked)} />
                  {t('Include variant rows separately')}
                </span>
              </label>
            </div>
            <div className="card" style={{ padding: 12, display: 'grid', gap: 10, background: '#fff', boxShadow: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong>Fields To Export</strong>
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  <button type="button" className="btn" onClick={() => setExportFieldKeys(exportHeaders.map((h) => h.key))}>Select All</button>
                  <button type="button" className="btn" onClick={() => setExportFieldKeys([])}>Clear</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                {exportHeaders.map((header) => (
                  <label key={header.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={exportFieldKeys.includes(header.key)}
                      onChange={(e) => {
                        setExportFieldKeys((prev) => {
                          const set = new Set(prev);
                          if (e.target.checked) set.add(header.key);
                          else set.delete(header.key);
                          return exportHeaders.map((item) => item.key).filter((key) => set.has(key));
                        });
                      }}
                    />
                    <span>{header.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="card" style={{ padding: 12, display: 'grid', gap: 6, background: '#f8fafc', boxShadow: 'none' }}>
              <div><strong>Branch:</strong> {isAllBranches ? 'All Branches' : (branch?.name || branch?.code || branchId || 'Branch')}</div>
              <div><strong>Category:</strong> {categoryFilter === 'all' ? 'All Categories' : categoryFilter}</div>
              <div><strong>Inventory Type:</strong> {inventoryTypeLabel}</div>
              <div><strong>Price Tier:</strong> {inventoryPriceTierLabel}</div>
              <div><strong>Rows To Export:</strong> {exportRows.length}</div>
              <div><strong>Selected Fields:</strong> {selectedExportHeaders.length}</div>
            </div>
          </div>
        </Modal>
      )}
      <div className="card">
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Product</th>
              <th align="left">SKU</th>
              <th align="left">Price</th>
              <th align="left">Barcode</th>
              <th align="left">Stock ({viewInventoryType === 'wholesale' ? 'Distribution' : viewInventoryType === 'warehouse' ? 'Warehouse' : 'Retail'} – {isAllBranches ? 'All Branches' : (branch?.code || branch?.name)})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const low = p.lowStock ?? 0;
              const cur = getStockForProduct(p, branchId);
              const basePrice = viewInventoryType === 'warehouse'
                ? (p.warehousePrice != null ? p.warehousePrice : 0)
                : viewInventoryType === 'wholesale'
                  ? (p.wholesalePrice != null ? p.wholesalePrice : p.price)
                  : (p.retailPrice != null ? p.retailPrice : p.price);
              const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
              return (
                <Fragment key={p.id}>
                  <tr onClick={() => setModalId(p.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {p.image ? (
                          <img src={p.image} alt={p.name} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                        ) : (
                          <div className="thumb-placeholder" style={{ width: 36, height: 36, fontSize: 10 }}>
                            ---
                          </div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div>{p.name}</div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>{getProductBrand(p) || '—'} • {p.sku || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td><code style={{ fontSize: 12 }}>{p.sku || '—'}</code></td>
                    <td>{formatCurrency(basePrice || 0, settings)}</td>
                    <td><code style={{ fontSize: 12 }}>{p.barcode || '—'}</code></td>
                    <td onClick={e => e.stopPropagation()}>
                      {hasVariants ? (
                        <button className="btn" onClick={() => setOpenVariantsFor(o => o === p.id ? null : p.id)}>Variants</button>
                      ) : (
                        <div style={{ display: 'grid', gap: 4 }}>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            value={cur}
                            onChange={e => setStockWithAudit(p, null, branchId, Number(e.target.value))}
                            style={{
                              width: 100,
                              borderColor: low > 0 && cur <= low ? '#ef4444' : undefined,
                              color: low > 0 && cur <= low ? '#b91c1c' : undefined
                            }}
                            disabled
                          />
                          {String(p.trackType || 'quantity') === 'serialized' && <small style={{ color: '#64748b' }}>Serialized units only</small>}
                        </div>
                      )}
                    </td>
                  </tr>
                  {(openVariantsFor === p.id && hasVariants) && (
                    <tr style={{ background: '#fbfdff' }}>
                      <td colSpan="5">
                        <div style={{ display: 'grid', gap: 6 }}>
                          {p.variants.map(v => (
                            <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, alignItems: 'center' }}>
                              <div><strong>{v.label}</strong> <span style={{ color: '#64748b' }}>{v.sku || ''}</span></div>
                          <input
                                className="input"
                                type="number"
                                min="0"
                                value={(viewInventoryType === 'wholesale' ? (v.wholesaleStockByBranch || {})[branchId] : viewInventoryType === 'warehouse' ? (v.warehouseStockByBranch || {})[branchId] : (v.stockByBranch || {})[branchId]) || 0}
                                onChange={e => setStockWithAudit(p, v.id, branchId, Number(e.target.value))}
                                style={{ width: 120 }}
                                disabled
                              />
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 ? <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>No inventory items match the current filters.</td></tr> : null}
          </tbody>
        </table>
        </div>
      </div>
      {selected && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.6)', display: 'grid', placeItems: 'center', zIndex: 1000 }} onClick={() => setModalId(null)}>
          <div className="card" style={{ width: 920, maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>{selected.name}</h2>
              <button className="btn" onClick={() => setModalId(null)}>
                <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2"/></svg>
                Close
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 140px) 1fr', gap: 12, marginTop: 12, alignItems: 'start' }}>
              <div>{selected.image ? <img src={selected.image} alt={selected.name} className="thumb" /> : <div style={{ color: '#94a3b8' }}>No image</div>}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                <div><strong>SKU:</strong> {selected.sku}</div>
                <div><strong>Brand:</strong> {getProductBrand(selected) || '—'}</div>
                <div><strong>Category:</strong> {selected.category || '—'}</div>
                <div><strong>Track Type:</strong> {String(selected.trackType || 'quantity') === 'serialized' ? 'Serialized' : 'Quantity'}</div>
                <div><strong>Manual Stock Edit:</strong> {String(selected.trackType || 'quantity') === 'serialized' ? 'Disabled for serialized items' : 'Disabled'}</div>
                {visiblePriceTiers.map(tier => (
                  <div key={tier}><strong>{getPriceTierLabel(tier)}:</strong> {formatCurrency(getDisplayPrice(selected, tier), settings)}</div>
                ))}
                <div><strong>Barcode:</strong> <code style={{ fontSize: 12 }}>{selected.barcode || '—'}</code></div>
                <div><strong>Low Stock:</strong> {selected.lowStock ?? 0}</div>
                <div><strong>{String(selected.trackType || 'quantity') === 'serialized' ? 'Serialized Retail Units' : 'Total Retail Across Branches'}:</strong> {getTotalStock(selected, 'retail')}</div>
                <div><strong>{String(selected.trackType || 'quantity') === 'serialized' ? 'Serialized Distribution Units' : 'Total Distribution Across Branches'}:</strong> {getTotalStock(selected, 'wholesale')}</div>
                <div><strong>{String(selected.trackType || 'quantity') === 'serialized' ? 'Serialized Warehouse Units' : 'Total Warehouse Across Branches'}:</strong> {getTotalStock(selected, 'warehouse')}</div>
                <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                  <strong>Branch Breakdown</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 6 }}>
                    {branches.map(b => (
                        <div key={b.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 10, display: 'grid', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700 }}>{b.code || b.name}</div>
                              <div style={{ color: '#64748b', fontSize: 12 }}>{b.name || b.code}</div>
                            </div>
                            {shouldShowBranchTypeBadge(b.branchType) ? (
                              <span style={{ display: 'inline-flex', width: 'fit-content', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, ...branchTypeBadgeStyle(b.branchType) }}>
                                {String(b.branchType || 'retail')}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                            <label style={{ minWidth: 0 }}>
                              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Retail</div>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                value={selected.stockByBranch?.[b.id] || 0}
                                onChange={e => setStockWithAudit(selected, null, b.id, Number(e.target.value))}
                                style={{ width: '100%' }}
                                disabled
                              />
                            </label>
                            <label style={{ minWidth: 0 }}>
                              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Distribution</div>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                value={selected.wholesaleStockByBranch?.[b.id] || 0}
                                onChange={e => setStockWithAudit(selected, null, b.id, Number(e.target.value))}
                                style={{ width: '100%' }}
                                disabled
                              />
                            </label>
                            <label style={{ minWidth: 0 }}>
                              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>Warehouse</div>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                value={selected.warehouseStockByBranch?.[b.id] || 0}
                                onChange={e => setStockWithAudit(selected, null, b.id, Number(e.target.value))}
                                style={{ width: '100%' }}
                                disabled
                              />
                            </label>
                          </div>
                      </div>
                    ))}
                  </div>
                </div>
                {(Array.isArray(selected.variants) && selected.variants.length > 0) && (
                  <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                    <strong>Variants (current branch)</strong>
                    {shouldShowBranchTypeBadge(branch?.branchType) ? (
                      <div style={{ marginTop: 4, marginBottom: 6 }}>
                        <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, ...branchTypeBadgeStyle(branch?.branchType) }}>
                          {String(branch?.branchType || 'retail')}
                        </span>
                      </div>
                    ) : null}
                    <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                      {selected.variants.map(v => (
                        <div key={v.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 2fr) repeat(3, minmax(90px, 1fr))', gap: 8, alignItems: 'center' }}>
                          <div><strong>{v.label}</strong> <span style={{ color: '#64748b' }}>{v.sku || ''}</span></div>
                          <input
                            className="input"
                            type="number"
                            min="0"
                            value={v.stockByBranch?.[branchId] || 0}
                            onChange={e => setStockWithAudit(selected, v.id, branchId, Number(e.target.value))}
                            style={{ width: 100 }}
                            disabled
                          />
                          <input
                            className="input"
                            type="number"
                            min="0"
                            value={v.wholesaleStockByBranch?.[branchId] || 0}
                            onChange={e => setStockWithAudit(selected, v.id, branchId, Number(e.target.value))}
                            style={{ width: 100 }}
                            disabled
                          />
                          <input
                            className="input"
                            type="number"
                            min="0"
                            value={v.warehouseStockByBranch?.[branchId] || 0}
                            onChange={e => setStockWithAudit(selected, v.id, branchId, Number(e.target.value))}
                            style={{ width: 100 }}
                            disabled
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InventoryPage;
