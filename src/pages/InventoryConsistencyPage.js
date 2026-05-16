import { useCallback, useEffect, useMemo, useState } from 'react';
import * as stockApi from '../api/stock';
import { exportCsv } from '../utils/exporters';
import InlineSpinner from '../components/InlineSpinner';
import { useToast } from '../components/ToastProvider';

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function InventoryConsistencyPage() {
  const toast = useToast();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [limit, setLimit] = useState(200);
  const [mismatchOnly, setMismatchOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [inventoryType, setInventoryType] = useState('');
  const [confidence, setConfidence] = useState('');

  const loadReport = useCallback(async (options = {}) => {
    const nextLimit = options.limit ?? 200;
    const nextMismatchOnly = options.mismatchOnly ?? true;
    const isInitial = options.initial === true;
    try {
      if (isInitial) setLoading(true);
      else setRefreshing(true);
      const data = await stockApi.getConsistencyReport({ limit: nextLimit, mismatchOnly: nextMismatchOnly });
      setReport(data || null);
    } catch (error) {
      toast.show(String(error?.message || 'Failed to load inventory consistency report'), { type: 'error' });
    } finally {
      if (isInitial) setLoading(false);
      else setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadReport({ initial: true, limit, mismatchOnly });
    // Initial load only. Later scans are user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadReport]);

  const rows = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return (Array.isArray(report?.rows) ? report.rows : []).filter((row) => {
      if (inventoryType && String(row?.inventoryType || '') !== inventoryType) return false;
      if (confidence && String(row?.confidence || '') !== confidence) return false;
      if (!term) return true;
      const hay = [
        row?.productName,
        row?.sku,
        row?.branchName,
        row?.inventoryType,
        row?.confidence,
        ...(Array.isArray(row?.sources) ? row.sources : [])
      ].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [report, search, inventoryType, confidence]);

  const summary = report?.summary || {};

  function handleExportCsv() {
    exportCsv('inventory-consistency-report', [
      { key: 'productName', label: 'Product' },
      { key: 'sku', label: 'SKU' },
      { key: 'branchName', label: 'Branch' },
      { key: 'inventoryType', label: 'Inventory Type' },
      { key: 'currentQty', label: 'Current Qty' },
      { key: 'expectedQty', label: 'Expected Qty' },
      { key: 'difference', label: 'Difference' },
      { key: 'confidence', label: 'Confidence' },
      { key: 'movementCount', label: 'Movement Count' },
      { label: 'Last Movement', value: (row) => formatDateTime(row?.lastMovementAt) },
      { label: 'Sources', value: (row) => (Array.isArray(row?.sources) ? row.sources.join(', ') : '') }
    ], rows);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="section-title" style={{ margin: 0 }}>Inventory Consistency</h1>
          <div style={{ color: '#64748b', marginTop: 6, maxWidth: 860 }}>
            Read-only checker for retail, wholesale, and warehouse stock balances. It compares saved stock maps against approved movement history and highlights mismatch candidates without changing live stock.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={handleExportCsv} disabled={loading || rows.length === 0}>Export CSV</button>
          <button className="btn btn-primary" type="button" onClick={() => loadReport()} disabled={loading || refreshing}>
            {refreshing ? <InlineSpinner size={14} /> : null}
            {refreshing ? 'Refreshing…' : 'Run Scan'}
          </button>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="card"><div className="muted">Mismatches</div><div style={{ fontSize: 36, fontWeight: 800 }}>{summary.mismatches ?? 0}</div></div>
        <div className="card"><div className="muted">High Confidence</div><div style={{ fontSize: 36, fontWeight: 800 }}>{summary.highConfidenceMismatches ?? 0}</div></div>
        <div className="card"><div className="muted">Products Scanned</div><div style={{ fontSize: 36, fontWeight: 800 }}>{summary.productsScanned ?? 0}</div></div>
        <div className="card"><div className="muted">Audits Scanned</div><div style={{ fontSize: 36, fontWeight: 800 }}>{summary.auditsScanned ?? 0}</div></div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <label>
            <div className="muted" style={{ marginBottom: 6 }}>Search</div>
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Product, SKU, branch, source" />
          </label>
          <label>
            <div className="muted" style={{ marginBottom: 6 }}>Inventory Type</div>
            <select className="select" value={inventoryType} onChange={(e) => setInventoryType(e.target.value)}>
              <option value="">All</option>
              <option value="retail">Retail</option>
              <option value="wholesale">Wholesale</option>
              <option value="warehouse">Warehouse</option>
            </select>
          </label>
          <label>
            <div className="muted" style={{ marginBottom: 6 }}>Confidence</div>
            <select className="select" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
              <option value="">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label>
            <div className="muted" style={{ marginBottom: 6 }}>Limit</div>
            <select className="select" value={String(limit)} onChange={(e) => setLimit(Number(e.target.value) || 200)}>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={mismatchOnly} onChange={(e) => setMismatchOnly(e.target.checked)} />
            <span>Show mismatches only</span>
          </label>
          <button className="btn" type="button" onClick={() => loadReport({ limit, mismatchOnly })} disabled={loading || refreshing}>
            Apply Filters
          </button>
          <div style={{ color: '#64748b', fontSize: 13 }}>
            Generated: {formatDateTime(report?.generatedAt)}
          </div>
        </div>
        <div style={{ color: '#64748b', fontSize: 13 }}>
          Confidence drops when older records do not provide a clean baseline. Review report rows before any manual repair.
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
            <InlineSpinner />
            <span>Loading consistency report…</span>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Branch</th>
                <th>Type</th>
                <th>Current</th>
                <th>Expected</th>
                <th>Difference</th>
                <th>Confidence</th>
                <th>Movements</th>
                <th>Last Movement</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 16, color: '#64748b' }}>No rows match the current filters.</td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={`${row.productId}-${row.variantId}-${row.branchId}-${row.inventoryType}`}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{row.productName || '—'}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{row.sku || '—'}</div>
                  </td>
                  <td>{row.branchName || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{row.inventoryType || '—'}</td>
                  <td>{Number(row.currentQty || 0)}</td>
                  <td>{Number(row.expectedQty || 0)}</td>
                  <td style={{ color: Number(row.difference || 0) === 0 ? '#0f172a' : (Number(row.difference || 0) > 0 ? '#166534' : '#b91c1c'), fontWeight: 700 }}>
                    {Number(row.difference || 0) > 0 ? '+' : ''}{Number(row.difference || 0)}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{row.confidence || '—'}</td>
                  <td>{Number(row.movementCount || 0)}</td>
                  <td>{formatDateTime(row.lastMovementAt)}</td>
                  <td>{Array.isArray(row.sources) && row.sources.length > 0 ? row.sources.join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default InventoryConsistencyPage;
