import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import BranchSelect from '../components/BranchSelect';
import * as productUnitsApi from '../api/productUnits';
import { useToast } from '../components/ToastProvider';
import InlineSpinner from '../components/InlineSpinner';

function SerializedInventoryPage() {
  const toast = useToast();
  const products = useSelector(s => s.products.products || []);
  const branches = useSelector(s => s.branches.branches || []);
  const auth = useSelector(s => s.auth);
  const roleLower = String(auth?.role || '').toLowerCase();
  const canDeleteUnits = roleLower === 'superadmin';
  const [productId, setProductId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [inventoryType, setInventoryType] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const productNameById = useMemo(() => new Map(products.map(product => [String(product.id), product.name])), [products]);
  const branchNameById = useMemo(() => new Map(branches.map(branch => [String(branch.id), branch.name])), [branches]);
  const summary = useMemo(() => ({
    totalUnits: total,
    visibleRows: rows.length,
    inStock: rows.filter(row => String(row.status || '') === 'in_stock').length,
    sold: rows.filter(row => String(row.status || '') === 'sold').length,
    uniqueProducts: new Set(rows.map(row => String(row.productId || '')).filter(Boolean)).size
  }), [rows, total]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let alive = true;
    const cached = productUnitsApi.getCachedProductUnits({
      productId,
      branchId,
      status,
      inventoryType,
      query: debouncedQuery,
      page,
      pageSize
    });
    if (alive && Array.isArray(cached?.rows) && cached.rows.length > 0) {
      setRows(cached.rows);
      setTotal(Number(cached.total || 0));
    }
    async function run() {
      setLoading(true);
      try {
        const result = await productUnitsApi.listProductUnits({
          productId,
          branchId,
          status,
          inventoryType,
          query: debouncedQuery,
          page,
          pageSize
        });
        if (!alive) return;
        setRows(Array.isArray(result?.rows) ? result.rows : []);
        setTotal(Number(result?.total || 0));
      } catch (e) {
        if (!alive) return;
        toast.show(String(e?.message || 'Failed to load serialized inventory'), { type: 'error' });
        setRows([]);
        setTotal(0);
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => { alive = false; };
  }, [branchId, debouncedQuery, inventoryType, page, pageSize, productId, status, toast]);

  async function deleteSelectedUnits() {
    const ids = selectedIds.filter(Boolean);
    if (ids.length === 0) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Delete ${ids.length} selected serialized unit(s)?`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await productUnitsApi.removeManyProductUnits(ids);
      setRows(prev => prev.filter(row => !ids.includes(String(row._id))));
      setSelectedIds([]);
      setBulkAction('');
      setTotal(prev => Math.max(0, Number(prev || 0) - ids.length));
      toast.show('Serialized units deleted', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete serialized units'), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card">
        <h1 style={{ margin: 0 }}>Serialized Inventory</h1>
        <div style={{ color: '#64748b', marginTop: 6 }}>Search unit-level stock by branch, status, inventory type, IMEI, or serial number.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Total Units</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.totalUnits}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Visible Rows</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.visibleRows}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>In Stock</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.inStock}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Sold</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.sold}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Products</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.uniqueProducts}</div></div>
      </div>
      <div className="card" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr', gap: 10 }}>
        <label>
          <div style={{ marginBottom: 6, color: '#64748b' }}>Search</div>
          <input className="input" value={query} onChange={e => { setPage(1); setQuery(e.target.value); }} placeholder="IMEI or serial number" />
        </label>
        <label>
          <div style={{ marginBottom: 6, color: '#64748b' }}>Product</div>
          <select className="select" value={productId} onChange={e => { setPage(1); setProductId(e.target.value); }}>
            <option value="">All Products</option>
            {products.filter(product => String(product.trackType || 'quantity') === 'serialized').map(product => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </label>
        <label>
          <div style={{ marginBottom: 6, color: '#64748b' }}>Branch</div>
          <BranchSelect value={branchId} onChange={value => { setPage(1); setBranchId(value); }} includeAll />
        </label>
        <label>
          <div style={{ marginBottom: 6, color: '#64748b' }}>Inventory Type</div>
          <select className="select" value={inventoryType} onChange={e => { setPage(1); setInventoryType(e.target.value); }}>
            <option value="">All</option>
            <option value="retail">Retail</option>
            <option value="wholesale">Wholesale</option>
            <option value="warehouse">Warehouse</option>
          </select>
        </label>
        <label>
          <div style={{ marginBottom: 6, color: '#64748b' }}>Status</div>
          <select className="select" value={status} onChange={e => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All</option>
            <option value="in_stock">In Stock</option>
            <option value="reserved">Reserved</option>
            <option value="sold">Sold</option>
            <option value="returned">Returned</option>
            <option value="adjusted_out">Adjusted Out</option>
          </select>
        </label>
      </div>
      {canDeleteUnits && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select" value={bulkAction} onChange={e => setBulkAction(e.target.value)} style={{ width: 180 }} disabled={bulkDeleting}>
            <option value="">Actions</option>
            <option value="delete">Delete Selected</option>
          </select>
          <button className="btn" disabled={bulkDeleting || bulkAction !== 'delete' || selectedIds.length === 0} onClick={() => void deleteSelectedUnits()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {bulkDeleting && <InlineSpinner />}
              {bulkDeleting ? 'Deleting…' : 'Apply'}
            </span>
          </button>
        </div>
      )}
      <div className="card">
        <div style={{ color: '#64748b', marginBottom: 8 }}>Total Units: {total}</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                {canDeleteUnits && (
                  <th>
                    <input
                      type="checkbox"
                      disabled={bulkDeleting}
                      checked={rows.length > 0 && rows.every(row => selectedIds.includes(String(row._id)))}
                      onChange={e => setSelectedIds(e.target.checked ? rows.map(row => String(row._id)).filter(Boolean) : [])}
                    />
                  </th>
                )}
                <th align="left">Product</th>
                <th align="left">IMEI</th>
                <th align="left">Serial</th>
                <th align="left">Branch</th>
                <th align="left">Inventory</th>
                <th align="left">Status</th>
                <th align="left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row._id} style={bulkDeleting && selectedIds.includes(String(row._id)) ? { opacity: 0.55 } : undefined}>
                  {canDeleteUnits && (
                    <td>
                      <input
                        type="checkbox"
                        disabled={bulkDeleting}
                        checked={selectedIds.includes(String(row._id))}
                        onChange={e => setSelectedIds(prev => e.target.checked ? [...new Set([...prev, String(row._id)])] : prev.filter(id => id !== String(row._id)))}
                      />
                    </td>
                  )}
                  <td>{productNameById.get(String(row.productId)) || row.productId}</td>
                  <td>{row.imei || '—'}</td>
                  <td>{row.serialNumber || '—'}</td>
                  <td>{branchNameById.get(String(row.branchId)) || row.branchId}</td>
                  <td>{row.inventoryType}</td>
                  <td>{row.status}</td>
                  <td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={canDeleteUnits ? 8 : 7} style={{ padding: 12, color: '#64748b' }}>No serialized units found</td></tr>}
              {loading && <tr><td colSpan={canDeleteUnits ? 8 : 7} style={{ padding: 12, color: '#64748b' }}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
            <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(total / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(total / pageSize))}>Next</button>
          </div>
          <label>
            <span style={{ marginRight: 6 }}>Rows</span>
            <select className="select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

export default SerializedInventoryPage;
