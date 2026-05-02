import { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { formatCurrency } from '../utils/currency';
import { getAllowedPriceTiers, getDisplayPrice, getPriceTierLabel } from '../utils/priceVisibility';

function WholesaleGoodsPage() {
  const products = useSelector(s => s.products.products || []);
  const branches = useSelector(s => s.branches.branches || []);
  const settings = useSelector(s => s.settings);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const auth = useSelector(s => s.auth);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState('card');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const visiblePriceTiers = useMemo(() => getAllowedPriceTiers(auth), [auth]);

  const wholesaleBranches = useMemo(
    () => branches.filter(branch => String(branch.branchType || 'retail').toLowerCase() === 'wholesale'),
    [branches]
  );
  const defaultBranchId = useMemo(() => {
    const currentBranch = (branches || []).find(branch => String(branch.id) === String(currentBranchId));
    if (String(currentBranch?.branchType || 'retail').toLowerCase() === 'wholesale') return currentBranchId;
    const fallback = wholesaleBranches[0];
    return fallback?.id || currentBranchId;
  }, [branches, currentBranchId, wholesaleBranches]);
  const activeBranchId = selectedBranchId || defaultBranchId;
  const activeBranch = useMemo(() => wholesaleBranches.find(branch => String(branch.id) === String(activeBranchId)) || null, [activeBranchId, wholesaleBranches]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .map(product => {
        const wholesaleStock = Number(product.wholesaleStockByBranch?.[activeBranchId] || 0);
        const wholesaleLowStock = Number(product.wholesaleLowStock != null ? product.wholesaleLowStock : (product.lowStock || 0));
        return { ...product, wholesaleStock, wholesaleLowStock };
      })
      .filter(product => !q || [product.name, product.sku, product.barcode].some(value => String(value || '').toLowerCase().includes(q)))
      .sort((a, b) => b.wholesaleStock - a.wholesaleStock || String(a.name || '').localeCompare(String(b.name || '')));
  }, [activeBranchId, products, query]);
  const summary = useMemo(() => ({
    totalProducts: rows.length,
    availableProducts: rows.filter(product => product.wholesaleStock > Number(product.wholesaleLowStock || 0)).length,
    lowStockProducts: rows.filter(product => product.wholesaleStock <= Number(product.wholesaleLowStock || 0)).length,
    totalUnits: rows.reduce((sum, product) => sum + Number(product.wholesaleStock || 0), 0)
  }), [rows]);
  const lowStockRows = useMemo(() => rows.filter(product => product.wholesaleStock <= Number(product.wholesaleLowStock || 0)).slice(0, 8), [rows]);

  return (
    <div className="goods-page-shell">
      <div className="card goods-page-header">
        <div>
          <h1 className="goods-page-title">Distribution Goods</h1>
          <div className="goods-page-subtitle">Browse products available in the active distribution branch with tighter cards, smaller text, and contained product images.</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={viewMode === 'card' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('card')}>Card</button>
          <button className={viewMode === 'list' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('list')}>List</button>
        </div>
      </div>

      <div className="card goods-filter-card">
        <input className="input" placeholder="Search distribution goods by name, SKU, or barcode" value={query} onChange={e => setQuery(e.target.value)} />
        <label>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Distribution Branch</div>
          <select className="select" value={activeBranchId} onChange={e => setSelectedBranchId(e.target.value)} disabled={wholesaleBranches.length === 0}>
            {wholesaleBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.name || branch.code || branch.id}</option>)}
          </select>
        </label>
        <div style={{ color: '#64748b', fontSize: 13 }}>Active distribution branch: {activeBranch?.name || activeBranchId || 'None configured'}</div>
      </div>

      <div className="goods-stats-grid">
        <div className="goods-stat-card">
          <div className="goods-stat-label">Products</div>
          <div className="goods-stat-value">{summary.totalProducts}</div>
        </div>
        <div className="goods-stat-card">
          <div className="goods-stat-label">Available</div>
          <div className="goods-stat-value" style={{ color: '#166534' }}>{summary.availableProducts}</div>
        </div>
        <div className="goods-stat-card">
          <div className="goods-stat-label">Low Stock</div>
          <div className="goods-stat-value" style={{ color: '#b91c1c' }}>{summary.lowStockProducts}</div>
        </div>
        <div className="goods-stat-card">
          <div className="goods-stat-label">Units</div>
          <div className="goods-stat-value">{summary.totalUnits}</div>
        </div>
      </div>

      {summary.lowStockProducts > 0 && (
        <div className="card goods-low-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: '#b91c1c' }}>Distribution Low Stock Notifications</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>{summary.lowStockProducts} product(s) need attention</div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {lowStockRows.map(product => (
              <div key={product.id} className="goods-low-row">
                <div>
                  <div style={{ fontWeight: 700 }}>{product.name}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{product.sku || 'No SKU'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#b91c1c', fontWeight: 700 }}>{product.wholesaleStock} left</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>Threshold {product.wholesaleLowStock}</div>
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
                <div className="goods-item-empty">No image</div>
              )}
              <div className="goods-item-title">{product.name}</div>
              <div className="goods-item-meta">{product.sku || 'No SKU'}</div>
              <div className="goods-item-line"><strong>Distribution Stock ({activeBranch?.name || activeBranchId || 'Branch'}):</strong> {product.wholesaleStock}</div>
              {visiblePriceTiers.map(tier => (
                <div key={tier} className="goods-item-line"><strong>{getPriceTierLabel(tier)}:</strong> {formatCurrency(getDisplayPrice(product, tier), settings)}</div>
              ))}
              <div className="goods-item-line"><strong>Low Stock Threshold:</strong> {product.wholesaleLowStock}</div>
              <div className={`goods-status-pill ${product.wholesaleStock <= Number(product.wholesaleLowStock || 0) ? 'low' : 'ok'}`}>
                {product.wholesaleStock <= Number(product.wholesaleLowStock || 0) ? 'Low stock' : 'Available'}
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="card" style={{ color: '#64748b' }}>No distribution goods found</div>}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Image</th>
                <th align="left">Product</th>
                <th align="left">SKU</th>
                <th align="left">Distribution Stock ({activeBranch?.name || activeBranchId || 'Branch'})</th>
                <th align="left">Low Stock At</th>
                {visiblePriceTiers.map(tier => <th key={tier} align="left">{getPriceTierLabel(tier)}</th>)}
                <th align="left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(product => (
                <tr key={product.id}>
                  <td>{product.image ? <img src={product.image} alt={product.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }} /> : <span style={{ color: '#94a3b8' }}>—</span>}</td>
                  <td>{product.name}</td>
                  <td>{product.sku || '—'}</td>
                  <td>{product.wholesaleStock}</td>
                  <td>{product.wholesaleLowStock}</td>
                  {visiblePriceTiers.map(tier => <td key={tier}>{formatCurrency(getDisplayPrice(product, tier), settings)}</td>)}
                  <td>
                    <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, background: product.wholesaleStock <= Number(product.wholesaleLowStock || 0) ? '#fee2e2' : '#dcfce7', color: product.wholesaleStock <= Number(product.wholesaleLowStock || 0) ? '#b91c1c' : '#15803d', fontWeight: 700 }}>
                      {product.wholesaleStock <= Number(product.wholesaleLowStock || 0) ? 'Low stock' : 'Available'}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6 + visiblePriceTiers.length} style={{ padding: 12, color: '#64748b' }}>No distribution goods found</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default WholesaleGoodsPage;
