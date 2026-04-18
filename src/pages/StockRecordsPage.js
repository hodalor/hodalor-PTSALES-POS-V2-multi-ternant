import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import * as auditsApi from '../api/audits';
import { removeEntries as removeAuditEntries } from '../store/auditSlice';
import { useToast } from '../components/ToastProvider';
import InlineSpinner from '../components/InlineSpinner';

function StockRecordsPage() {
  const dispatch = useDispatch();
  const audit = useSelector(s => s.audit.entries);
  const branches = useSelector(s => s.branches.branches);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const toast = useToast();
  const [fActor, setFActor] = useState('');
  const [fBranch, setFBranch] = useState(settings.currentBranchId);
  const [fSource, setFSource] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodMode, setPeriodMode] = useState('range');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedRecordIds, setSelectedRecordIds] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const roleLower = String(auth.role || '').toLowerCase();
  const canDeleteRecords = roleLower === 'superadmin';
  const assigned = auth.user?.assignedBranches || 'all';
  const branchOptions = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return branches;
    const ids = new Set(Array.isArray(assigned) ? assigned : [assigned]);
    return branches.filter(b => ids.has(b.id));
  }, [roleLower, assigned, branches]);
  useEffect(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin') return;
    const allowedIds = new Set(branchOptions.map(b => b.id));
    if (!allowedIds.has(fBranch)) setFBranch(settings.currentBranchId);
  }, [roleLower, branchOptions, settings.currentBranchId, fBranch]); 
  const byBranchId = useMemo(() => {
    const map = new Map();
    branches.forEach(b => map.set(b.id, b.name || b.code || b.id));
    return map;
  }, [branches]);

  function normalize(e) {
    const t = e.actionType;
    const d = e.details || {};
    const b = e.branchId || d.branchId || null;
    const recordMeta = { id: e.id || e._id, _id: e._id || e.id };
    if (t === 'stock_adjust') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, source: 'Adjustments', action: d.delta > 0 ? 'Add' : 'Remove', product: d.product || '', variant: d.variant || '', qty: d.delta, remark: e.remark || '' };
    }
    if (t === 'stock_damage_remove') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, source: 'Adjustments', action: 'Remove', product: d.product || '', variant: d.variant || '', qty: -Math.abs(d.qty || 0), remark: e.remark || '' };
    }
    if (t === 'stock_transfer') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: d.from || b, source: 'Transfers', action: `Transfer ${d.from} → ${d.to}`, product: d.product || '', variant: d.variant || '', qty: d.qty || 0, remark: e.remark || '' };
    }
    if (t === 'stock_receive') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, source: 'Purchases', action: 'Add', product: d.product || '', variant: d.variant || '', qty: d.baseUnits ?? d.qty ?? 0, remark: e.remark || '' };
    }
    if (t === 'stock_set_initial') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, source: 'Products', action: 'Set', product: d.product || '', variant: d.variant || '', qty: d.quantity ?? 0, remark: e.remark || '' };
    }
    if (t === 'stock_set_manual') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, source: 'Inventory', action: 'Set', product: d.product || '', variant: d.variant || '', qty: d.delta ?? 0, remark: e.remark || '' };
    }
    if (t === 'stock_sale_deduct') {
      const totalUnits = Array.isArray(d.items) ? d.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0;
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, source: 'POS', action: 'Remove (Sale)', product: `${totalUnits} unit(s) across ${d.items?.length || 0} item(s)`, variant: '', qty: -Math.abs(totalUnits), remark: e.remark || '' };
    }
    if (t === 'stock_restock_refund') {
      const totalUnits = Array.isArray(d.items) ? d.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0;
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, source: 'Refund Approvals', action: 'Add (Restock)', product: `${totalUnits} unit(s) across ${d.items?.length || 0} item(s)`, variant: '', qty: totalUnits, remark: e.remark || '' };
    }
    return null;
  }

  const baseRows = useMemo(() => {
    return audit.map(normalize).filter(Boolean);
  }, [audit]);

  const actors = useMemo(() => Array.from(new Set(baseRows.map(r => r.actor))).sort(), [baseRows]);
  const sources = useMemo(() => Array.from(new Set(baseRows.map(r => r.source))).sort(), [baseRows]);
  const rows = useMemo(() => {
    const fromTs = periodMode === 'all_time' ? 0 : (dateFrom ? new Date(dateFrom).getTime() : 0);
    const toTs = periodMode === 'all_time' ? Number.MAX_SAFE_INTEGER : (dateTo ? new Date(dateTo).getTime() : Number.MAX_SAFE_INTEGER);
    return baseRows.filter(r => {
      const ts = new Date(r.ts).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (fActor && r.actor !== fActor) return false;
      if (fBranch && r.branchId !== fBranch) return false;
      if (fSource && r.source !== fSource) return false;
      return true;
    }).slice().reverse();
  }, [baseRows, fActor, fBranch, fSource, dateFrom, dateTo, periodMode]);
  const summary = useMemo(() => ({
    records: rows.length,
    totalMovement: rows.reduce((sum, row) => sum + Math.abs(Number(row.qty || 0)), 0),
    uniqueProducts: new Set(rows.map((row) => String(row.product || '').trim()).filter(Boolean)).size,
    uniqueBranches: new Set(rows.map((row) => String(row.branchId || '').trim()).filter(Boolean)).size
  }), [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  async function deleteSelectedRecords() {
    const ids = selectedRecordIds.filter(Boolean);
    if (ids.length === 0) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Delete ${ids.length} selected stock record(s)?`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await auditsApi.removeMany(ids);
      dispatch(removeAuditEntries(ids));
      setSelectedRecordIds([]);
      setBulkAction('');
      toast.show('Stock records deleted', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete stock records'), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }

  function onExportCsv() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: r => new Date(r.ts).toLocaleString() },
      { key: 'actor', label: 'Actor' },
      { key: 'branch', label: 'Branch', value: r => byBranchId.get(r.branchId) || r.branchId || '' },
      { key: 'source', label: 'Source' },
      { key: 'action', label: 'Action' },
      { key: 'product', label: 'Product' },
      { key: 'variant', label: 'Variant' },
      { key: 'qty', label: 'Delta' },
      { key: 'remark', label: 'Remark' }
    ];
    exportCsv('stock-records.csv', headers, rows);
  }
  function onExportPdf() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: r => new Date(r.ts).toLocaleString() },
      { key: 'actor', label: 'Actor' },
      { key: 'branch', label: 'Branch', value: r => byBranchId.get(r.branchId) || r.branchId || '' },
      { key: 'source', label: 'Source' },
      { key: 'action', label: 'Action' },
      { key: 'product', label: 'Product' },
      { key: 'variant', label: 'Variant' },
      { key: 'qty', label: 'Delta' },
      { key: 'remark', label: 'Remark' }
    ];
    exportTablePdf('Stock Records', headers, rows);
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Stock Records</h1>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          <button className="btn" onClick={onExportCsv}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 3v12m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="2"/><path d="M5 21h14" stroke="currentColor" strokeWidth="2"/></svg>
            Export CSV
          </button>
          <button className="btn" onClick={onExportPdf}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M6 4h12v16H6z" stroke="currentColor" strokeWidth="2"/><path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="2"/></svg>
            Export PDF
          </button>
          {canDeleteRecords && (
            <>
              <select className="select" value={bulkAction} onChange={e => setBulkAction(e.target.value)} style={{ width: 180 }} disabled={bulkDeleting}>
                <option value="">Actions</option>
                <option value="delete">Delete Selected</option>
              </select>
              <button className="btn" disabled={bulkDeleting || bulkAction !== 'delete' || selectedRecordIds.length === 0} onClick={() => void deleteSelectedRecords()}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {bulkDeleting && <InlineSpinner />}
                  {bulkDeleting ? 'Deleting…' : 'Apply'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Records</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.records}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Units Moved</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.totalMovement}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Products</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.uniqueProducts}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Branches</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.uniqueBranches}</div></div>
      </div>
      <div className="card filter-grid" style={{ marginBottom: 8 }}>
        <label>
          Period
          <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
            <option value="range">Custom Range</option>
            <option value="all_time">All Time</option>
          </select>
        </label>
        <label>
          From
          <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
        </label>
        <label>
          To
          <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
        </label>
        <label>
          Actor
          <select className="select" value={fActor} onChange={e => setFActor(e.target.value)}>
            <option value="">All</option>
            {actors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>
          Branch
          <select className="select" value={fBranch} onChange={e => setFBranch(e.target.value)}>
            {(roleLower === 'superadmin' || roleLower === 'admin') && <option value="">All</option>}
            {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label>
          Source
          <select className="select" value={fSource} onChange={e => setFSource(e.target.value)}>
            <option value="">All</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Timestamp</th>
              <th align="left">Actor</th>
              <th align="left">Branch</th>
              <th align="left">Source</th>
              <th align="left">Action</th>
              <th align="left">Product</th>
              <th align="left">Variant</th>
              <th align="left">Delta</th>
              <th align="left">Remark</th>
              {canDeleteRecords && (
                <th align="left">
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={pageRows.length > 0 && pageRows.every(entry => selectedRecordIds.includes(String(entry._id || entry.id || '')))}
                    onChange={e => setSelectedRecordIds(e.target.checked ? pageRows.map(entry => String(entry._id || entry.id || '')).filter(Boolean) : [])}
                  />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, idx) => (
              <tr key={r._id || r.id || idx} style={bulkDeleting && selectedRecordIds.includes(String(r._id || r.id || '')) ? { opacity: 0.55 } : undefined}>
                <td>{new Date(r.ts).toLocaleString()}</td>
                <td>{r.actor}</td>
                <td>{byBranchId.get(r.branchId) || r.branchId || '—'}</td>
                <td>{r.source}</td>
                <td>{r.action}</td>
                <td>{r.product || '—'}</td>
                <td>{r.variant || '—'}</td>
                <td>{typeof r.qty === 'number' ? r.qty : '—'}</td>
                <td>{r.remark || '—'}</td>
                {canDeleteRecords && (
                  <td>
                    <input
                      type="checkbox"
                      disabled={bulkDeleting}
                      checked={selectedRecordIds.includes(String(r._id || r.id || ''))}
                      onChange={e => setSelectedRecordIds(prev => e.target.checked ? [...new Set([...prev, String(r._id || r.id || '')])] : prev.filter(id => id !== String(r._id || r.id || '')))}
                    />
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={canDeleteRecords ? 10 : 9} style={{ padding: 12, color: '#64748b' }}>No stock records.</td></tr>
            )}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
            <span>Page {page} of {totalPages}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
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

export default StockRecordsPage;
