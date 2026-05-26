import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import * as auditsApi from '../api/audits';
import * as wholesaleApi from '../api/wholesale';
import { removeEntries as removeAuditEntries, setEntries as setAuditEntries } from '../store/auditSlice';
import { useToast } from '../components/ToastProvider';
import InlineSpinner from '../components/InlineSpinner';
import { getProductDisplayMeta, matchesFilterText } from '../utils/inventoryFilters';

function makeBranchLookup(branches = []) {
  const map = new Map();
  (Array.isArray(branches) ? branches : []).forEach((branch) => {
    const label = String(branch?.name || branch?.code || branch?.id || branch?._id || '').trim();
    const id = String(branch?.id || '').trim();
    const objectId = String(branch?._id || '').trim();
    if (id) map.set(id, label || id);
    if (objectId) map.set(objectId, label || objectId);
  });
  return map;
}

function StockRecordsPage() {
  const dispatch = useDispatch();
  const audit = useSelector(s => s.audit.entries);
  const branches = useSelector(s => s.branches.branches);
  const products = useSelector(s => s.products.products);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const toast = useToast();
  const initialBranchFilter = ['superadmin', 'admin'].includes(String(auth.role || '').toLowerCase()) ? '' : settings.currentBranchId;
  const [fActor, setFActor] = useState('');
  const [fBranch, setFBranch] = useState(initialBranchFilter);
  const [fSource, setFSource] = useState('');
  const [fProduct, setFProduct] = useState('');
  const [fInventoryType, setFInventoryType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodMode, setPeriodMode] = useState('range');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedRecordIds, setSelectedRecordIds] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [workflowOperations, setWorkflowOperations] = useState([]);
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
    return makeBranchLookup(branches);
  }, [branches]);
  const branchTypeById = useMemo(() => {
    const map = new Map();
    branches.forEach((branch) => {
      const kind = String(branch.branchType || 'retail').toLowerCase();
      if (branch?.id) map.set(String(branch.id), kind);
      if (branch?._id) map.set(String(branch._id), kind);
    });
    return map;
  }, [branches]);
  const inventoryTypeForBranch = useCallback((branchId) => {
    const kind = String(branchTypeById.get(String(branchId || '')) || 'retail').toLowerCase();
    return kind === 'warehouse' ? 'warehouse' : kind === 'wholesale' ? 'wholesale' : 'retail';
  }, [branchTypeById]);
  const resolveBranchLabel = useCallback((branchId, fallbackName = '') => {
    const id = String(branchId || '').trim();
    const preferred = String(fallbackName || '').trim();
    if (preferred) return preferred;
    return byBranchId.get(id) || id || '—';
  }, [byBranchId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [auditRows, warehouseOps, wholesaleOps] = await Promise.all([
          auditsApi.list(1000),
          wholesaleApi.listOperations({ status: 'approved', operationArea: 'warehouse', force: true }),
          wholesaleApi.listOperations({ status: 'approved', operationArea: 'wholesale', force: true })
        ]);
        if (!alive) return;
        if (Array.isArray(auditRows) && auditRows.length > 0) dispatch(setAuditEntries(auditRows));
        setWorkflowOperations([
          ...(Array.isArray(warehouseOps) ? warehouseOps : []),
          ...(Array.isArray(wholesaleOps) ? wholesaleOps : [])
        ]);
      } catch (error) {
        const message = String(error?.message || '');
        if (message && !/forbidden|unauthorized/i.test(message)) {
          toast.show(message, { type: 'error' });
        }
      }
    })();
    return () => { alive = false; };
  }, [dispatch, toast]);

  const normalize = useCallback((e) => {
    const t = e.actionType;
    const d = e.details || {};
    const b = e.branchId || d.branchId || null;
    const branchName = e.branchName || d.branchName || '';
    const recordMeta = { id: e.id || e._id, _id: e._id || e.id };
    const detailMeta = getProductDisplayMeta(products, d.productId, d.variantId, d);
    if (t === 'stock_adjust') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, branchName, inventoryType: inventoryTypeForBranch(b), source: 'Adjustments', action: d.delta > 0 ? 'Add' : 'Remove', product: detailMeta.productName, variant: detailMeta.secondaryLabel, qty: d.delta, remark: e.remark || '' };
    }
    if (t === 'stock_damage_remove') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, branchName, inventoryType: inventoryTypeForBranch(b), source: 'Adjustments', action: 'Remove', product: detailMeta.productName, variant: detailMeta.secondaryLabel, qty: -Math.abs(d.qty || 0), remark: e.remark || '' };
    }
    if (t === 'stock_transfer') {
      const fromBranchId = d.from || b;
      const toBranchId = d.to || null;
      const fromBranchName = d.fromBranchName || resolveBranchLabel(fromBranchId);
      const toBranchName = d.toBranchName || resolveBranchLabel(toBranchId);
      const transferQty = Math.abs(Number(d.qty || 0));
      return [
        {
          ...recordMeta,
          rowKey: `${recordMeta.id}-out`,
          ts: e.ts,
          actor: e.actor,
          branchId: fromBranchId,
          branchName: fromBranchName,
          inventoryType: inventoryTypeForBranch(fromBranchId),
          source: 'Transfers',
          action: `Transfer Out → ${toBranchName}`,
          product: detailMeta.productName,
          variant: detailMeta.secondaryLabel,
          qty: -transferQty,
          remark: e.remark || ''
        },
        {
          ...recordMeta,
          rowKey: `${recordMeta.id}-in`,
          ts: e.ts,
          actor: e.actor,
          branchId: toBranchId,
          branchName: toBranchName,
          inventoryType: inventoryTypeForBranch(toBranchId),
          source: 'Transfers',
          action: `Transfer In ← ${fromBranchName}`,
          product: detailMeta.productName,
          variant: detailMeta.secondaryLabel,
          qty: transferQty,
          remark: e.remark || ''
        }
      ];
    }
    if (t === 'stock_wholesale_sale_deduct') {
      const items = Array.isArray(d.items) ? d.items : [];
      return items
        .map((item, index) => {
          const meta = getProductDisplayMeta(products, item.productId, item.variantId, item);
          const soldQty = Number(item.qty || 0);
          if (!soldQty) return null;
          return {
            ...recordMeta,
            rowKey: `${recordMeta.id}-wholesale-sale-${index}`,
            ts: e.ts,
            actor: e.actor,
            branchId: b,
            branchName,
            inventoryType: String(d.inventoryType || inventoryTypeForBranch(b) || 'wholesale').toLowerCase(),
            source: 'Wholesale POS',
            action: 'Remove (Sale)',
            product: meta.productName,
            variant: meta.secondaryLabel,
            qty: -Math.abs(soldQty),
            remark: e.remark || ''
          };
        })
        .filter(Boolean);
    }
    if (t === 'stock_receive') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, branchName, inventoryType: inventoryTypeForBranch(b), source: 'Purchases', action: 'Add', product: detailMeta.productName, variant: detailMeta.secondaryLabel, qty: d.baseUnits ?? d.qty ?? 0, remark: e.remark || '' };
    }
    if (t === 'stock_set_initial') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, branchName, inventoryType: inventoryTypeForBranch(b), source: 'Products', action: 'Set', product: detailMeta.productName, variant: detailMeta.secondaryLabel, qty: d.quantity ?? 0, remark: e.remark || '' };
    }
    if (t === 'stock_set_manual') {
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, branchName, inventoryType: inventoryTypeForBranch(b), source: 'Inventory', action: 'Set', product: detailMeta.productName, variant: detailMeta.secondaryLabel, qty: d.delta ?? 0, remark: e.remark || '' };
    }
    if (t === 'stock_sale_deduct') {
      const totalUnits = Array.isArray(d.items) ? d.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0;
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, branchName, inventoryType: inventoryTypeForBranch(b), source: 'POS', action: 'Remove (Sale)', product: `${totalUnits} unit(s) across ${d.items?.length || 0} item(s)`, variant: '', qty: -Math.abs(totalUnits), remark: e.remark || '' };
    }
    if (t === 'stock_restock_refund') {
      const totalUnits = Array.isArray(d.items) ? d.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0;
      return { ...recordMeta, ts: e.ts, actor: e.actor, branchId: b, branchName, inventoryType: inventoryTypeForBranch(b), source: 'Refund Approvals', action: 'Add (Restock)', product: `${totalUnits} unit(s) across ${d.items?.length || 0} item(s)`, variant: '', qty: totalUnits, remark: e.remark || '' };
    }
    return null;
  }, [inventoryTypeForBranch, products, resolveBranchLabel]);

  const normalizeWorkflowOperation = useCallback((row) => {
    const items = Array.isArray(row?.items) && row.items.length > 0
      ? row.items
      : [{
          productId: row?.productId,
          variantId: row?.variantId || '',
          qty: Number(row?.qty || 0),
          adjustmentType: row?.adjustmentType || 'increase'
        }];
    const actor = row?.managerApprovedByName || row?.directorApprovedByName || row?.initiatedByName || 'unknown';
    const ts = row?.approved_at || row?.approvedAt || row?.managerApproved_at || row?.managerApprovedAt || row?.updatedAt || row?.createdAt || new Date().toISOString();
    if (row?.operationType === 'transfer') {
      return items.flatMap((item, index) => {
        const meta = getProductDisplayMeta(products, item?.productId, item?.variantId, item);
        const qty = Math.abs(Number(item?.qty || 0));
        const fromBranchName = resolveBranchLabel(row.fromBranchId, row.fromBranchName);
        const toBranchName = resolveBranchLabel(row.toBranchId, row.toBranchName);
        if (!qty) return [];
        return [
          {
            id: `${row._id || row.clientId}-wf-out-${index}`,
            _id: `${row._id || row.clientId}-wf-out-${index}`,
            ts,
            actor,
            branchId: row.fromBranchId,
            branchName: fromBranchName,
            inventoryType: String(row.fromInventoryType || inventoryTypeForBranch(row.fromBranchId) || 'wholesale').toLowerCase(),
            source: 'Transfers',
            action: `Transfer Out → ${toBranchName}`,
            product: meta.productName,
            variant: meta.secondaryLabel,
            qty: -qty,
            remark: row.remark || ''
          },
          {
            id: `${row._id || row.clientId}-wf-in-${index}`,
            _id: `${row._id || row.clientId}-wf-in-${index}`,
            ts,
            actor,
            branchId: row.toBranchId,
            branchName: toBranchName,
            inventoryType: String(row.toInventoryType || inventoryTypeForBranch(row.toBranchId) || 'wholesale').toLowerCase(),
            source: 'Transfers',
            action: `Transfer In ← ${fromBranchName}`,
            product: meta.productName,
            variant: meta.secondaryLabel,
            qty,
            remark: row.remark || ''
          }
        ];
      });
    }
    return items.map((item, index) => {
        const meta = getProductDisplayMeta(products, item?.productId || row?.productId, item?.variantId, item);
      const qty = Math.abs(Number(item?.qty || row?.qty || 0));
      const inventoryType = String(row.toInventoryType || row.fromInventoryType || row.operationArea || inventoryTypeForBranch(row.branchId) || 'wholesale').toLowerCase();
      if (!qty) return null;
      if (row?.operationType === 'adjustment') {
        const isDecrease = String(item?.adjustmentType || row?.adjustmentType || 'increase').toLowerCase() === 'decrease';
        return {
          id: `${row._id || row.clientId}-wf-adjust-${index}`,
          _id: `${row._id || row.clientId}-wf-adjust-${index}`,
          ts,
          actor,
          branchId: row.branchId,
          branchName: resolveBranchLabel(row.branchId, row.branchName),
          inventoryType,
          source: 'Adjustments',
          action: isDecrease ? 'Remove' : 'Add',
            product: meta.productName,
            variant: meta.secondaryLabel,
          qty: isDecrease ? -qty : qty,
          remark: row.remark || item?.remark || ''
        };
      }
      return {
        id: `${row._id || row.clientId}-wf-${row.operationType}-${index}`,
        _id: `${row._id || row.clientId}-wf-${row.operationType}-${index}`,
        ts,
        actor,
        branchId: row.branchId || row.toBranchId,
        branchName: resolveBranchLabel(row.branchId || row.toBranchId, row.branchName || row.toBranchName),
        inventoryType,
        source: row?.operationType === 'refund' ? 'Refund Approvals' : 'Purchases',
        action: 'Add',
        product: meta.productName,
        variant: meta.secondaryLabel,
        qty,
        remark: row.remark || item?.remark || ''
      };
    }).filter(Boolean);
  }, [inventoryTypeForBranch, products, resolveBranchLabel]);

  const baseRows = useMemo(() => {
    return audit.flatMap((entry) => {
      const normalized = normalize(entry);
      if (Array.isArray(normalized)) return normalized.filter(Boolean);
      return normalized ? [normalized] : [];
    });
  }, [audit, normalize]);
  const workflowRows = useMemo(() => {
    return workflowOperations.flatMap((row) => {
      const normalized = normalizeWorkflowOperation(row);
      if (Array.isArray(normalized)) return normalized.filter(Boolean);
      return normalized ? [normalized] : [];
    });
  }, [normalizeWorkflowOperation, workflowOperations]);
  const allRows = useMemo(() => [...workflowRows, ...baseRows], [baseRows, workflowRows]);
  const branchFilterOptions = useMemo(() => {
    const extras = Array.from(new Set(allRows.map((row) => String(row.branchId || '')).filter(Boolean)))
      .filter((id) => !branchOptions.some((branch) => String(branch.id) === id))
      .map((id) => {
        const match = allRows.find((row) => String(row.branchId || '') === id);
        return { id, name: resolveBranchLabel(id, match?.branchName) };
      });
    return [...branchOptions, ...extras];
  }, [allRows, branchOptions, resolveBranchLabel]);

  const actors = useMemo(() => Array.from(new Set(allRows.map(r => r.actor).filter(Boolean))).sort(), [allRows]);
  const sources = useMemo(() => Array.from(new Set(allRows.map(r => r.source))).sort(), [allRows]);
  const inventoryTypes = useMemo(() => Array.from(new Set(allRows.map((row) => row.inventoryType).filter(Boolean))).sort(), [allRows]);
  const rows = useMemo(() => {
    const fromTs = periodMode === 'all_time' ? 0 : (dateFrom ? new Date(dateFrom).getTime() : 0);
    const toTs = periodMode === 'all_time' ? Number.MAX_SAFE_INTEGER : (dateTo ? new Date(dateTo).getTime() : Number.MAX_SAFE_INTEGER);
    return allRows.filter(r => {
      const ts = new Date(r.ts).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (fActor && r.actor !== fActor) return false;
      if (fBranch && r.branchId !== fBranch) return false;
      if (fSource && r.source !== fSource) return false;
      if (fInventoryType && r.inventoryType !== fInventoryType) return false;
      if (!matchesFilterText([r.product, r.variant, r.remark, r.actor, resolveBranchLabel(r.branchId, r.branchName), r.action], fProduct)) return false;
      return true;
    }).slice().reverse();
  }, [allRows, dateFrom, dateTo, fActor, fBranch, fInventoryType, fProduct, fSource, periodMode, resolveBranchLabel]);
  const summary = useMemo(() => ({
    records: rows.length,
    totalMovement: rows.reduce((sum, row) => sum + Math.abs(Number(row.qty || 0)), 0),
    uniqueProducts: new Set(rows.map((row) => String(row.product || '').trim()).filter(Boolean)).size,
    uniqueBranches: new Set(rows.map((row) => String(row.branchId || '').trim()).filter(Boolean)).size
  }), [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, fActor, fBranch, fInventoryType, fProduct, fSource, periodMode]);

  async function deleteSelectedRecords() {
    const ids = selectedRecordIds.filter(Boolean);
    if (ids.length === 0) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Delete ${ids.length} selected stock record(s)? They will go to Super Bin.`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await auditsApi.removeMany(ids);
      dispatch(removeAuditEntries(ids));
      setSelectedRecordIds([]);
      setBulkAction('');
      toast.show('Stock records moved to Super Bin', { type: 'success' });
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
      { key: 'branch', label: 'Branch', value: r => resolveBranchLabel(r.branchId, r.branchName) },
      { key: 'inventoryType', label: 'Inventory Type' },
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
      { key: 'branch', label: 'Branch', value: r => resolveBranchLabel(r.branchId, r.branchName) },
      { key: 'inventoryType', label: 'Inventory Type' },
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
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 8 }}>
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
            {branchFilterOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label>
          Source
          <select className="select" value={fSource} onChange={e => setFSource(e.target.value)}>
            <option value="">All</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Inventory Type
          <select className="select" value={fInventoryType} onChange={e => setFInventoryType(e.target.value)}>
            <option value="">All</option>
            {inventoryTypes.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          Search Product
          <input className="input" value={fProduct} onChange={e => setFProduct(e.target.value)} placeholder="Search product, branch, action, or remark" />
        </label>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Timestamp</th>
              <th align="left">Actor</th>
              <th align="left">Branch</th>
              <th align="left">Inventory Type</th>
              <th align="left">Source</th>
              <th align="left">Action</th>
              <th align="left">Product</th>
              <th align="left">Variant / Attribute</th>
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
              <tr key={r.rowKey || r._id || r.id || idx} style={bulkDeleting && selectedRecordIds.includes(String(r._id || r.id || '')) ? { opacity: 0.55 } : undefined}>
                <td>{new Date(r.ts).toLocaleString()}</td>
                <td>{r.actor}</td>
                <td>{resolveBranchLabel(r.branchId, r.branchName)}</td>
                <td>{r.inventoryType || '—'}</td>
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
              <tr><td colSpan={canDeleteRecords ? 11 : 10} style={{ padding: 12, color: '#64748b' }}>No stock records.</td></tr>
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
