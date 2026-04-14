import { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { formatCurrency } from '../utils/currency';
import { getAllowedPriceTiers, getDisplayPrice, getPriceTierLabel } from '../utils/priceVisibility';

function WarehouseGoodsPage() {
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
        return { ...product, warehouseStock, warehouseLowStock };
      })
      .filter(product => !q || [product.name, product.sku, product.barcode].some(value => String(value || '').toLowerCase().includes(q)))
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
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Warehouse Goods</h1>
          <div style={{ color: '#64748b', fontSize: 13 }}>Browse products available in the active warehouse branch and switch between list and card views.</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={viewMode === 'card' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('card')}>Card</button>
          <button className={viewMode === 'list' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('list')}>List</button>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <input className="input" placeholder="Search warehouse goods by name, SKU, or barcode" value={query} onChange={e => setQuery(e.target.value)} />
        <label>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Warehouse Branch</div>
          <select className="select" value={activeBranchId} onChange={e => setSelectedBranchId(e.target.value)} disabled={warehouseBranches.length === 0}>
            {warehouseBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.name || branch.code || branch.id}</option>)}
          </select>
        </label>
        <div style={{ color: '#64748b', fontSize: 13 }}>Active warehouse branch: {activeBranch?.name || activeBranchId || 'None configured'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>Products</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{summary.totalProducts}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>Available</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#166534' }}>{summary.availableProducts}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>Low Stock</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#b91c1c' }}>{summary.lowStockProducts}</div>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>Units</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{summary.totalUnits}</div>
        </div>
      </div>

      {summary.lowStockProducts > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: '#b91c1c' }}>Warehouse Low Stock Notifications</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>{summary.lowStockProducts} product(s) need attention</div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {lowStockRows.map(product => (
              <div key={product.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 10, borderRadius: 10, background: '#fff7ed' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{product.name}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{product.sku || 'No SKU'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#b91c1c', fontWeight: 700 }}>{product.warehouseStock} left</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>Threshold {product.warehouseLowStock}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'card' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {rows.map(product => (
            <div key={product.id} className="card" style={{ display: 'grid', gap: 8 }}>
              {product.image ? (
                <img src={product.image} alt={product.name} style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
              ) : (
                <div style={{ height: 160, borderRadius: 10, border: '1px dashed #cbd5e1', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
                  No image
                </div>
              )}
              <div style={{ fontWeight: 700, fontSize: 18 }}>{product.name}</div>
              <div style={{ color: '#64748b' }}>{product.sku || 'No SKU'}</div>
              <div><strong>Warehouse Stock ({activeBranch?.name || activeBranchId || 'Branch'}):</strong> {product.warehouseStock}</div>
              {visiblePriceTiers.map(tier => (
                <div key={tier}><strong>{getPriceTierLabel(tier)}:</strong> {formatCurrency(getDisplayPrice(product, tier), settings)}</div>
              ))}
              <div><strong>Low Stock Threshold:</strong> {product.warehouseLowStock}</div>
              <div style={{ display: 'inline-flex', width: 'fit-content', padding: '4px 10px', borderRadius: 999, background: product.warehouseStock <= Number(product.warehouseLowStock || 0) ? '#fee2e2' : '#dcfce7', color: product.warehouseStock <= Number(product.warehouseLowStock || 0) ? '#b91c1c' : '#15803d', fontWeight: 700 }}>
                {product.warehouseStock <= Number(product.warehouseLowStock || 0) ? 'Low stock' : 'Available'}
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="card" style={{ color: '#64748b' }}>No warehouse goods found</div>}
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Image</th>
                <th align="left">Product</th>
                <th align="left">SKU</th>
                <th align="left">Warehouse Stock ({activeBranch?.name || activeBranchId || 'Branch'})</th>
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
                  <td>{product.warehouseStock}</td>
                  <td>{product.warehouseLowStock}</td>
                  {visiblePriceTiers.map(tier => <td key={tier}>{formatCurrency(getDisplayPrice(product, tier), settings)}</td>)}
                  <td>
                    <span style={{ display: 'inline-flex', padding: '4px 10px', borderRadius: 999, background: product.warehouseStock <= Number(product.warehouseLowStock || 0) ? '#fee2e2' : '#dcfce7', color: product.warehouseStock <= Number(product.warehouseLowStock || 0) ? '#b91c1c' : '#15803d', fontWeight: 700 }}>
                      {product.warehouseStock <= Number(product.warehouseLowStock || 0) ? 'Low stock' : 'Available'}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6 + visiblePriceTiers.length} style={{ padding: 12, color: '#64748b' }}>No warehouse goods found</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default WarehouseGoodsPage;
