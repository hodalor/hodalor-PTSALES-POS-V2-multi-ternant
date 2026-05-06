import { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { formatCurrency } from '../utils/currency';
import { getAllowedPriceTiers, getDisplayPrice, getPriceTierLabel } from '../utils/priceVisibility';
import { useAppLanguage } from '../utils/localization';
import { getProductBrand, getProductSearchText } from '../utils/productSearch';

function WarehouseGoodsPage() {
  const { t } = useAppLanguage();
  const products = useSelector(s => s.products.products || []);
  const branches = useSelector(s => s.branches.branches || []);
  const settings = useSelector(s => s.settings);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const auth = useSelector(s => s.auth);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState('card');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const visiblePriceTiers = useMemo(() => getAllowedPriceTiers(auth), [auth]);

  const warehouseBranches = useMemo(
    () => branches.filter(branch => String(branch.branchType || 'retail').toLowerCase() === 'warehouse'),
    [branches]
  );
  const defaultBranchId = useMemo(() => {
    const currentBranch = (branches || []).find(branch => String(branch.id) === String(currentBranchId));
    if (String(currentBranch?.branchType || 'retail').toLowerCase() === 'warehouse') return currentBranchId;
    const fallback = warehouseBranches[0];
    return fallback?.id || currentBranchId;
  }, [branches, currentBranchId, warehouseBranches]);
  const activeBranchId = selectedBranchId || defaultBranchId;
  const activeBranch = useMemo(() => warehouseBranches.find(branch => String(branch.id) === String(activeBranchId)) || null, [activeBranchId, warehouseBranches]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .map(product => {
        const warehouseStock = Number(product.warehouseStockByBranch?.[activeBranchId] || 0);
        const warehouseLowStock = Number(product.warehouseLowStock != null ? product.warehouseLowStock : (product.lowStock || 0));
        return { ...product, brand: getProductBrand(product), warehouseStock, warehouseLowStock };
      })
      .filter(product => !q || getProductSearchText(product).includes(q))
      .sort((a, b) => b.warehouseStock - a.warehouseStock || String(a.name || '').localeCompare(String(b.name || '')));
  }, [activeBranchId, products, query]);
  const summary = useMemo(() => ({
    totalProducts: rows.length,
    availableProducts: rows.filter(product => product.warehouseStock > Number(product.warehouseLowStock || 0)).length,
    lowStockProducts: rows.filter(product => product.warehouseStock <= Number(product.warehouseLowStock || 0)).length,
    totalUnits: rows.reduce((sum, product) => sum + Number(product.warehouseStock || 0), 0)
  }), [rows]);
  const lowStockRows = useMemo(() => rows.filter(product => product.warehouseStock <= Number(product.warehouseLowStock || 0)).slice(0, 8), [rows]);

  return (
    <div className="goods-page-shell">
      <div className="card goods-page-header">
        <div>
          <h1 className="goods-page-title">{t('Warehouse Goods')}</h1>
          <div className="goods-page-subtitle">{t('Browse products available in the active warehouse branch with tighter cards, smaller text, and contained product images.')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={viewMode === 'card' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('card')}>{t('Card')}</button>
          <button className={viewMode === 'list' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('list')}>{t('List')}</button>
        </div>
      </div>

      <div className="card goods-filter-card">
        <input className="input" placeholder={t('Search warehouse goods by name, brand, SKU, or barcode')} value={query} onChange={e => setQuery(e.target.value)} />
        <label>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>{t('Warehouse Branch')}</div>
          <select className="select" value={activeBranchId} onChange={e => setSelectedBranchId(e.target.value)} disabled={warehouseBranches.length === 0}>
            {warehouseBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.name || branch.code || branch.id}</option>)}
          </select>
        </label>
        <div style={{ color: '#64748b', fontSize: 13 }}>{t('Active warehouse branch')}: {activeBranch?.name || activeBranchId || t('None configured')}</div>
      </div>

      <div className="goods-stats-grid">
        <div className="goods-stat-card">
          <div className="goods-stat-label">{t('Products')}</div>
          <div className="goods-stat-value">{summary.totalProducts}</div>
        </div>
        <div className="goods-stat-card">
          <div className="goods-stat-label">{t('Available')}</div>
          <div className="goods-stat-value" style={{ color: '#166534' }}>{summary.availableProducts}</div>
        </div>
        <div className="goods-stat-card">
          <div className="goods-stat-label">{t('Low Stock')}</div>
          <div className="goods-stat-value" style={{ color: '#b91c1c' }}>{summary.lowStockProducts}</div>
        </div>
        <div className="goods-stat-card">
          <div className="goods-stat-label">{t('Units')}</div>
          <div className="goods-stat-value">{summary.totalUnits}</div>
        </div>
      </div>

      {summary.lowStockProducts > 0 && (
        <div className="card goods-low-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: '#b91c1c' }}>{t('Warehouse Low Stock Notifications')}</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>{t('{count} product(s) need attention', { count: summary.lowStockProducts })}</div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {lowStockRows.map(product => (
              <div key={product.id} className="goods-low-row">
                <div>
                  <div style={{ fontWeight: 700 }}>{product.name}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{product.sku || t('No SKU')}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#b91c1c', fontWeight: 700 }}>{t('{count} left', { count: product.warehouseStock })}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{t('Threshold')} {product.warehouseLowStock}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'card' ? (
        <div className="goods-card-grid">
          {rows.map(product => (
            <div key={product.id} className="goods-item-card">
              {product.image ? (
                <img src={product.image} alt={product.name} className="goods-item-image" />
              ) : (
                <div className="goods-item-empty">{t('No image')}</div>
              )}
              <div className="goods-item-title">{product.name}</div>
              {product.brand ? <div className="goods-item-meta">{product.brand}</div> : null}
              <div className="goods-item-meta">{product.sku || t('No SKU')}</div>
              <div className="goods-item-line"><strong>{t('Warehouse Stock')} ({activeBranch?.name || activeBranchId || t('Branch')}):</strong> {product.warehouseStock}</div>
              {visiblePriceTiers.map(tier => (
                <div key={tier} className="goods-item-line price-line"><strong>{getPriceTierLabel(tier)}:</strong> {formatCurrency(getDisplayPrice(product, tier), settings)}</div>
              ))}
              <div className="goods-item-line"><strong>{t('Low Stock Threshold')}:</strong> {product.warehouseLowStock}</div>
              <div className={`goods-status-pill ${product.warehouseStock <= Number(product.warehouseLowStock || 0) ? 'low' : 'ok'}`}>
                {product.warehouseStock <= Number(product.warehouseLowStock || 0) ? t('Low stock') : t('Available')}
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="card" style={{ color: '#64748b' }}>{t('No warehouse goods found')}</div>}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th align="left">{t('Image')}</th>
                <th align="left">{t('Product')}</th>
                <th align="left">{t('SKU')}</th>
                <th align="left">{t('Warehouse Stock')} ({activeBranch?.name || activeBranchId || t('Branch')})</th>
                <th align="left">{t('Low Stock At')}</th>
                {visiblePriceTiers.map(tier => <th key={tier} align="left">{getPriceTierLabel(tier)}</th>)}
                <th align="left">{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(product => (
                <tr key={product.id}>
                  <td>{product.image ? <img src={product.image} alt={product.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }} /> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td>{product.brand ? `${product.name} (${product.brand})` : product.name}</td>
                  <td>{product.sku || '—'}</td>
                  <td>{product.warehouseStock}</td>
                  <td>{product.warehouseLowStock}</td>
                  {visiblePriceTiers.map(tier => <td key={tier}><span className="price-accent">{formatCurrency(getDisplayPrice(product, tier), settings)}</span></td>)}
                  <td>
                    <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, background: product.warehouseStock <= Number(product.warehouseLowStock || 0) ? '#fee2e2' : '#dcfce7', color: product.warehouseStock <= Number(product.warehouseLowStock || 0) ? '#b91c1c' : '#15803d', fontWeight: 700 }}>
                      {product.warehouseStock <= Number(product.warehouseLowStock || 0) ? t('Low stock') : t('Available')}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6 + visiblePriceTiers.length} style={{ padding: 12, color: '#64748b' }}>{t('No warehouse goods found')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default WarehouseGoodsPage;
