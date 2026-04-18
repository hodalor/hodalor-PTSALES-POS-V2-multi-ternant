import { useDispatch, useSelector } from 'react-redux';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

function branchTypeBadgeStyle(branchType = 'retail') {
  const kind = String(branchType || 'retail').toLowerCase();
  if (kind === 'warehouse') return { background: '#ede9fe', color: '#6d28d9' };
  if (kind === 'wholesale') return { background: '#dbeafe', color: '#1d4ed8' };
  return { background: '#dcfce7', color: '#166534' };
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
  const dispatch = useDispatch();
  const toast = useToast();
  const visiblePriceTiers = useMemo(() => getAllowedPriceTiers(auth), [auth]);

  const branch = useMemo(() => branches.find(b => b.id === branchId) || branches[0], [branches, branchId]);
  const categoryOptions = useMemo(() => Array.from(new Set(products.map((p) => String(p.category || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [products]);
  const baseFilteredRows = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== 'all' && String(p.category || '') !== String(categoryFilter)) return false;
      if (term) {
        const hay = `${p.name || ''} ${p.sku || ''} ${p.barcode || ''} ${p.category || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [products, categoryFilter, search]);
  const productOptions = useMemo(() => baseFilteredRows.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)), [baseFilteredRows]);
  const rows = useMemo(() => (
    productFilter === 'all'
      ? baseFilteredRows
      : baseFilteredRows.filter((p) => String(p.id) === String(productFilter))
  ), [baseFilteredRows, productFilter]);
  useEffect(() => { setBranchId(currentBranchId); }, [currentBranchId]);
  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryOptions.includes(categoryFilter)) setCategoryFilter('all');
  }, [categoryOptions, categoryFilter]);
  useEffect(() => {
    if (productFilter !== 'all' && !productOptions.some((item) => String(item.id) === String(productFilter))) setProductFilter('all');
  }, [productFilter, productOptions]);
  const selected = useMemo(() => rows.find(p => p.id === modalId) || null, [rows, modalId]);

  const getStockForProduct = useCallback((product, targetBranchId = branchId) => {
    const source = viewInventoryType === 'wholesale'
      ? (product.wholesaleStockByBranch || {})
      : viewInventoryType === 'warehouse'
        ? (product.warehouseStockByBranch || {})
        : (product.stockByBranch || {});
    if (!targetBranchId) return Object.values(source).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
    return Number(source[targetBranchId] || 0);
  }, [branchId, viewInventoryType]);

  const getSalePrice = useCallback((product) => {
    return Number(viewInventoryType === 'wholesale' || viewInventoryType === 'warehouse'
      ? (product.wholesalePrice != null ? product.wholesalePrice : product.price || 0)
      : (product.retailPrice != null ? product.retailPrice : product.price || 0));
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

  function setStockWithAudit(p, variantId, bId, quantity) {
    if (String(p.trackType || 'quantity') === 'serialized') {
      toast.show('Serialized stock changes only through IMEI or serial unit actions', { type: 'warning' });
      return;
    }
    if (!allowManualStockEdit) {
      toast.show('Manual stock editing is disabled', { type: 'warning' });
      return;
    }
    const oldQty = variantId
      ? ((p.variants?.find(v => v.id === variantId)?.stockByBranch || {})[bId] || 0)
      : (p.stockByBranch?.[bId] || 0);
    const delta = Number(quantity) - Number(oldQty);
    if (!navigator.onLine && !offlineBackupAllowed) {
      toast.show('Offline: cannot save stock changes', { type: 'error' });
      return;
    }
    dispatch(setStock({ productId: p.id, variantId: variantId || undefined, branchId: bId, quantity: Number(quantity), syncPending: true }));
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
      variantId: variantId || undefined
    };
    if (!navigator.onLine) {
      enqueueHttp({ collection: 'audits', label: 'Stock set', path: '/api/stock/set', method: 'POST', body: payload })
        .catch(() => {
          dispatch(setStock({ productId: p.id, variantId: variantId || undefined, branchId: bId, quantity: Number(oldQty), syncPending: false }));
          toast.show('Failed to save offline', { type: 'error' });
        });
      return;
    }
    stockApi.setStock(payload)
      .then(() => { void refreshAffectedProducts(dispatch, [p.id]); })
      .catch((e) => {
        dispatch(setStock({ productId: p.id, variantId: variantId || undefined, branchId: bId, quantity: Number(oldQty), syncPending: false }));
        toast.show(String(e?.message || 'Failed to save stock'), { type: 'error' });
      });
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Inventory</h1>
        <OfflineQueueIndicator collection="audits" label="Stock queued" />
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <label>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Branch</div>
            <BranchSelect value={branchId} onChange={setBranchId} includeAll allLabel="All Branches" style={{ minWidth: 180 }} />
          </label>
          <label>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Category</div>
            <select className="select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {categoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Product</div>
            <select className="select" value={productFilter} onChange={e => setProductFilter(e.target.value)}>
              <option value="all">All Products</option>
              {productOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Search</div>
            <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, SKU, barcode" />
          </label>
          {branch && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, ...branchTypeBadgeStyle(branch.branchType) }}>
                {String(branch.branchType || 'retail')}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className={viewInventoryType === 'retail' ? 'btn btn-primary' : 'btn'} onClick={() => setViewInventoryType('retail')}>Retail</button>
            <button className={viewInventoryType === 'wholesale' ? 'btn btn-primary' : 'btn'} onClick={() => setViewInventoryType('wholesale')}>Distribution</button>
            <button className={viewInventoryType === 'warehouse' ? 'btn btn-primary' : 'btn'} onClick={() => setViewInventoryType('warehouse')}>Warehouse</button>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Categories</div><div style={{ fontSize: 32, fontWeight: 800 }}>{summary.categories}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Total Items</div><div style={{ fontSize: 32, fontWeight: 800 }}>{summary.totalItems}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Total Stock</div><div style={{ fontSize: 32, fontWeight: 800 }}>{summary.totalStock}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Total Cost</div><div style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(summary.totalCost, settings)}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Expected Revenue</div><div style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(summary.expectedRevenue, settings)}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Expected Profit</div><div style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(summary.expectedProfit, settings)}</div></div>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Product</th>
              <th align="left">Price</th>
              <th align="left">Barcode</th>
              <th align="left">Stock ({viewInventoryType === 'wholesale' ? 'Distribution' : viewInventoryType === 'warehouse' ? 'Warehouse' : 'Retail'} – {branch?.code || branch?.name})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const low = p.lowStock ?? 0;
              const cur = (viewInventoryType === 'wholesale' ? (p.wholesaleStockByBranch || {})[branchId] : viewInventoryType === 'warehouse' ? (p.warehouseStockByBranch || {})[branchId] : (p.stockByBranch || {})[branchId]) || 0;
              const basePrice = viewInventoryType === 'wholesale' || viewInventoryType === 'warehouse'
                ? (p.wholesalePrice != null ? p.wholesalePrice : p.price)
                : (p.retailPrice != null ? p.retailPrice : p.price);
              const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
              return (
                <>
                  <tr key={p.id} onClick={() => setModalId(p.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {p.image ? (
                          <img src={p.image} alt={p.name} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                        ) : (
                          <div style={{ width: 36, height: 36, borderRadius: 8, border: '1px dashed #cbd5e1', display: 'grid', placeItems: 'center', color: '#94a3b8', fontSize: 10 }}>
                            —
                          </div>
                        )}
                        <span>{p.name}</span>
                      </div>
                    </td>
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
                    <tr key={`${p.id}-variants`} style={{ background: '#fbfdff' }}>
                      <td colSpan="4">
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
                </>
              );
            })}
            {rows.length === 0 ? <tr><td colSpan="4" style={{ padding: 12, color: '#64748b' }}>No inventory items match the current filters.</td></tr> : null}
          </tbody>
        </table>
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
                <div><strong>Category:</strong> {selected.category || '—'}</div>
                <div><strong>Track Type:</strong> {String(selected.trackType || 'quantity') === 'serialized' ? 'Serialized' : 'Quantity'}</div>
                <div><strong>Manual Stock Edit:</strong> {String(selected.trackType || 'quantity') === 'serialized' ? 'Disabled for serialized items' : 'Disabled'}</div>
                {visiblePriceTiers.map(tier => (
                  <div key={tier}><strong>{getPriceTierLabel(tier)}:</strong> {formatCurrency(getDisplayPrice(selected, tier), settings)}</div>
                ))}
                <div><strong>Barcode:</strong> <code style={{ fontSize: 12 }}>{selected.barcode || '—'}</code></div>
                <div><strong>Low Stock:</strong> {selected.lowStock ?? 0}</div>
                <div><strong>{String(selected.trackType || 'quantity') === 'serialized' ? 'Serialized Retail Units' : 'Total Retail Across Branches'}:</strong> {Object.values(selected.stockByBranch || {}).reduce((a, b) => a + (b || 0), 0)}</div>
                <div><strong>{String(selected.trackType || 'quantity') === 'serialized' ? 'Serialized Distribution Units' : 'Total Distribution Across Branches'}:</strong> {Object.values(selected.wholesaleStockByBranch || {}).reduce((a, b) => a + (b || 0), 0)}</div>
                <div><strong>{String(selected.trackType || 'quantity') === 'serialized' ? 'Serialized Warehouse Units' : 'Total Warehouse Across Branches'}:</strong> {Object.values(selected.warehouseStockByBranch || {}).reduce((a, b) => a + (b || 0), 0)}</div>
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
                            <span style={{ display: 'inline-flex', width: 'fit-content', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, ...branchTypeBadgeStyle(b.branchType) }}>
                              {String(b.branchType || 'retail')}
                            </span>
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
                    <div style={{ marginTop: 4, marginBottom: 6 }}>
                      <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, ...branchTypeBadgeStyle(branch?.branchType) }}>
                        {String(branch?.branchType || 'retail')}
                      </span>
                    </div>
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
