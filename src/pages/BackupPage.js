import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector, useStore } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import { attemptSync, removeByFingerprint, removeMany, updateMeta } from '../offline/queue';
import { COLLECTIONS, getQueueSummary, listQueuedByCollection } from '../offline/offlineBackup';
import { syncQueuedItem } from '../offline/syncHandlers';
import { ensureOnlineJwt } from '../offline/reAuth';
import { refreshAllData } from '../offline/refreshAll';
import { useDispatch } from 'react-redux';
import { listImeiConflicts, removeImeiConflict } from '../offline/imeiConflicts';
import { setQueueSummary } from '../store/offlineQueueSlice';
import { adjustStock } from '../store/productsSlice';
import { removeSales } from '../store/salesSlice';
import { removeInvoices } from '../store/invoicesSlice';
import * as tenantsApi from '../api/tenants';
import * as productUnitsApi from '../api/productUnits';
import Modal from '../components/Modal';
import { formatDurationMs, importTenantTransferInSteps, parseTenantTransferFile, summarizeTenantImportResults } from '../utils/tenantTransfer';
import { formatCurrency } from '../utils/currency';
import { confirmDialog } from '../utils/dialogs';

function getQueuedSalePayload(item) {
  if (!item) return null;
  if (String(item?.payload?.path || '') === '/api/sales') return item?.payload?.body || null;
  if (String(item?.type || '') === 'sale') return item?.payload || null;
  return null;
}

function isQueuedSale(item) {
  return !!getQueuedSalePayload(item);
}

function getSaleItems(sale) {
  return Array.isArray(sale?.items) ? sale.items : [];
}

function getSaleUnitIds(sale) {
  return getSaleItems(sale).flatMap((line) => Array.isArray(line?.soldUnitIds) ? line.soldUnitIds.map(String) : []);
}

function getQueuedSaleRecordIds(sale) {
  return [
    sale?.clientId,
    sale?.id,
    sale?._id,
    sale?.invoiceSerial,
    sale?.receiptNumber
  ].filter(Boolean).map(String);
}

function BackupPage() {
  const toast = useToast();
  const settings = useSelector(s => s.settings);
  const summary = useSelector(s => s.offlineQueue);
  const auth = useSelector(s => s.auth);
  const dispatch = useDispatch();
  const store = useStore();
  const [selected, setSelected] = useState('sales');
  const [loading, setLoading] = useState(false);
  const [itemsByCollection, setItemsByCollection] = useState(new Map());
  const [imeiConflictCount, setImeiConflictCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [importMode, setImportMode] = useState('keep_current');
  const [importFile, setImportFile] = useState(null);
  const [importPayload, setImportPayload] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [importProgress, setImportProgress] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [transferBusy, setTransferBusy] = useState('');
  const [lastImportSummary, setLastImportSummary] = useState(null);
  const [retryingId, setRetryingId] = useState('');
  const [undoingId, setUndoingId] = useState('');
  const fileInputRef = useRef(null);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const hasGrant = (key) => grants.includes(key) || (key.startsWith('view_') && grants.includes(`see_${key.slice(5)}`)) || (key.startsWith('see_') && grants.includes(`view_${key.slice(4)}`));
  const canExportTenantData = roleLower === 'superadmin' || roleLower === 'admin' || hasGrant('export_tenant_data');
  const canImportTenantData = roleLower === 'superadmin' || roleLower === 'admin' || hasGrant('import_tenant_data');

  async function refreshQueueState() {
    try {
      const map = await listQueuedByCollection();
      setItemsByCollection(map);
      dispatch(setQueueSummary(await getQueueSummary()));
      setImeiConflictCount(listImeiConflicts().length);
    } catch {}
  }

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const map = await listQueuedByCollection();
        if (alive) setItemsByCollection(map);
        if (alive) setImeiConflictCount(listImeiConflicts().length);
        if (alive) dispatch(setQueueSummary(await getQueueSummary()));
      } catch {
        if (alive) setItemsByCollection(new Map());
      }
    }
    load();
    const id = setInterval(load, 5000);
    window.addEventListener('online', load);
    window.addEventListener('offline', load);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener('online', load);
      window.removeEventListener('offline', load);
    };
  }, [dispatch]);

  const collections = useMemo(() => {
    const by = summary?.byCollection || {};
    return COLLECTIONS.map(c => ({ ...c, count: Number(by[c.key] || 0) }));
  }, [summary]);

  const rows = useMemo(() => {
    const list = itemsByCollection.get(selected) || [];
    return list.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  }, [itemsByCollection, selected]);

  useEffect(() => {
    setSelectedIds([]);
  }, [selected, itemsByCollection]);

  async function onBackupNow() {
    if (loading) return;
    if (!navigator.onLine) {
      toast.show('Offline: connect internet to backup', { type: 'error' });
      return;
    }
    try { await ensureOnlineJwt(); } catch {}
    setLoading(true);
    try {
      const result = await attemptSync(syncQueuedItem);
      const ok = typeof result === 'boolean' ? result : Boolean(result?.ok);
      if (ok) {
        toast.show('Backup completed', { type: 'success' });
      } else {
        const failed = Number(result?.failed || 0);
        const total = Number(result?.total || 0);
        const err = Array.isArray(result?.errors) && result.errors.length > 0 ? ` • ${result.errors[0]}` : '';
        toast.show(`Some items failed to backup (${failed}/${total})${err}`, { type: 'error' });
      }
      try {
        await refreshAllData(dispatch, store.getState);
      } catch {}
    } catch {
      toast.show('Backup failed', { type: 'error' });
    } finally {
      await refreshQueueState();
      setLoading(false);
    }
  }
  async function onSyncNow() {
    if (loading) return;
    if (!navigator.onLine) {
      toast.show('Offline: connect internet to sync', { type: 'error' });
      return;
    }
    setLoading(true);
    try {
      await ensureOnlineJwt();
      await refreshAllData(dispatch, store.getState);
      const map = await listQueuedByCollection();
      setItemsByCollection(map);
      toast.show('Sync completed', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Sync failed'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function onDeleteSelected() {
    if (loading || selectedIds.length === 0) return;
    setLoading(true);
    try {
      await removeMany(selectedIds);
      setSelectedIds([]);
      await refreshQueueState();
      toast.show('Selected queue items deleted', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete queue items'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function getQueueBusyState(queueId) {
    const id = String(queueId || '');
    return retryingId === id || undoingId === id || loading;
  }

  function describeQueuedSale(item) {
    const sale = getQueuedSalePayload(item);
    const items = getSaleItems(sale);
    return {
      sale,
      items,
      branchName: String(sale?.branchName || sale?.branchId || '').trim() || 'Branch not set',
      customerName: String(sale?.customerName || '').trim() || 'Walk-in customer',
      total: Number(sale?.total || 0),
      subtotal: Number(sale?.subtotal || 0),
      discount: Number(sale?.discount || 0),
      tax: Number(sale?.tax || 0),
      receiptNumber: String(sale?.receiptNumber || sale?.invoiceSerial || sale?.clientId || '').trim(),
      saleId: String(sale?.clientId || sale?.id || sale?._id || item?.id || '').trim()
    };
  }

  async function rollbackQueuedSaleLocally(item) {
    const sale = getQueuedSalePayload(item);
    if (!sale) return;
    const inventoryType = String(sale?.inventoryType || sale?.posType || 'retail');
    const branchId = String(sale?.branchId || '');
    const soldUnitIds = getSaleUnitIds(sale);
    if (soldUnitIds.length > 0) {
      try {
        await productUnitsApi.releaseProductUnits({
          unitIds: soldUnitIds,
          reservationToken: String(sale?.reservationToken || '')
        });
      } catch {}
      productUnitsApi.restoreProductUnitsToStock(soldUnitIds);
    }
    getSaleItems(sale).forEach((line) => {
      const productId = String(line?.productId || '').trim();
      if (!productId || !branchId) return;
      dispatch(adjustStock({
        productId,
        variantId: line?.variantId || null,
        branchId,
        inventoryType,
        delta: Math.max(0, Number(line?.qty || 0)),
        syncPending: false
      }));
    });
    const idsToRemove = getQueuedSaleRecordIds(sale);
    dispatch(removeSales(idsToRemove));
    dispatch(removeInvoices(idsToRemove));
  }

  async function onRetryItem(item) {
    const queueId = String(item?.id || '');
    if (!queueId || getQueueBusyState(queueId)) return;
    if (!navigator.onLine) {
      toast.show('Connect internet to retry this queued sale', { type: 'error' });
      return;
    }
    setRetryingId(queueId);
    try {
      const sale = getQueuedSalePayload(item);
      await ensureOnlineJwt();
      await syncQueuedItem(item);
      if (sale) {
        dispatch(removeSales(getQueuedSaleRecordIds(sale)));
        dispatch(removeInvoices(getQueuedSaleRecordIds(sale)));
        productUnitsApi.markSoldProductUnits(getSaleUnitIds(sale));
      }
      if (item?.fingerprint) await removeByFingerprint(item.fingerprint);
      else await removeMany([item?.id]);
      removeImeiConflict(queueId);
      await refreshQueueState();
      try {
        await refreshAllData(dispatch, store.getState);
      } catch {}
      toast.show('Queued sale pushed successfully', { type: 'success' });
    } catch (e) {
      await updateMeta(item?.id, {
        attempts: Number(item?.attempts || 0) + 1,
        lastError: String(e?.message || 'Retry failed'),
        lastAttemptAt: Date.now()
      });
      await refreshQueueState();
      toast.show(String(e?.message || 'Retry failed'), { type: 'error' });
    } finally {
      setRetryingId('');
    }
  }

  async function onUndoItem(item) {
    const queueId = String(item?.id || '');
    if (!queueId || getQueueBusyState(queueId)) return;
    const sale = getQueuedSalePayload(item);
    if (!sale) {
      toast.show('Undo is available for queued sales only', { type: 'error' });
      return;
    }
    const ok = await confirmDialog('Undo this queued sale and restore the stock locally? This will remove it from the queue and release serialized units for sale again.');
    if (!ok) return;
    setUndoingId(queueId);
    try {
      await rollbackQueuedSaleLocally(item);
      if (item?.fingerprint) await removeByFingerprint(item.fingerprint);
      else await removeMany([item?.id]);
      removeImeiConflict(queueId);
      await refreshQueueState();
      toast.show('Queued sale undone and stock restored locally', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to undo queued sale'), { type: 'error' });
    } finally {
      setUndoingId('');
    }
  }

  function downloadJsonFile(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function onExportTenantData() {
    if (loading || transferBusy || !canExportTenantData) return;
    setTransferBusy('export');
    try {
      const data = await tenantsApi.exportMyTenantData();
      const tenantId = String(auth.user?.tenantId || 'tenant').trim() || 'tenant';
      downloadJsonFile(`${tenantId}-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, data);
      toast.show('Tenant data exported', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to export tenant data'), { type: 'error' });
    } finally {
      setTransferBusy('');
    }
  }

  function openImportModal() {
    setImportOpen(true);
    setImportMode('keep_current');
    setImportFile(null);
    setImportPayload(null);
    setImportSummary(null);
    setImportProgress(null);
    setLastImportSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function onImportFileChange(file) {
    setImportFile(file || null);
    setImportPayload(null);
    setImportSummary(null);
    setImportProgress(null);
    if (!file) return;
    try {
      const parsed = await parseTenantTransferFile(file);
      setImportPayload(parsed.raw);
      setImportSummary(parsed.summary);
      setLastImportSummary(null);
    } catch (e) {
      setImportFile(null);
      toast.show(String(e?.message || 'Invalid backup file'), { type: 'error' });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onImportTenantData() {
    if (loading || transferBusy || !canImportTenantData) return;
    if (!importFile) {
      toast.show('Choose a backup file first', { type: 'error' });
      return;
    }
    if (!importPayload) {
      toast.show('Backup preview is not ready yet', { type: 'error' });
      return;
    }
    setTransferBusy('import');
    try {
      const result = await importTenantTransferInSteps({
        payload: importPayload,
        mode: importMode,
        importFn: (payload) => tenantsApi.importMyTenantData(payload),
        onProgress: setImportProgress
      });
      setLastImportSummary({
        tenantId: importPayload?.tenantId || auth.user?.tenantId || '',
        mode: importMode,
        completedAt: new Date().toISOString(),
        summary: summarizeTenantImportResults(result.steps)
      });
      setImportOpen(false);
      setImportFile(null);
      setImportPayload(null);
      setImportSummary(null);
      setImportProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast.show('Tenant data imported successfully', { type: 'success' });
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to import tenant data'), { type: 'error' });
    } finally {
      setTransferBusy('');
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div className="card" style={{ padding: 16, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Backup & Sync</h1>
          <div className="page-subtitle-compact">
            Offline queue for cloud-first syncing. Pending: {Number(summary?.total || 0)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/imei-conflicts" className="btn" style={{ textDecoration: 'none' }}>
            IMEI Conflicts{imeiConflictCount > 0 ? `: ${imeiConflictCount}` : ''}
          </Link>
          {String(auth.role || '').toLowerCase() === 'superadmin' ? (
            <button className="btn" onClick={onDeleteSelected} disabled={loading || selectedIds.length === 0}>
              Delete Selected
            </button>
          ) : null}
          <button className="btn btn-primary" onClick={onBackupNow} disabled={loading || !navigator.onLine || Number(summary?.total || 0) === 0}>
            {loading ? 'Backing up…' : 'Backup Now'}
          </button>
          <button className="btn" onClick={onSyncNow} disabled={loading || !navigator.onLine}>
            {loading ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {(canExportTenantData || canImportTenantData) ? (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>Tenant Import / Export</h2>
          <div style={{ color: '#64748b', marginBottom: 12 }}>
            Download all tenant MongoDB collections as a backup JSON file, or import a backup into the current tenant database.
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={onExportTenantData} disabled={loading || !!transferBusy || !canExportTenantData}>
              {transferBusy === 'export' ? 'Exporting…' : 'Export Tenant Data'}
            </button>
            <button className="btn btn-primary" onClick={openImportModal} disabled={loading || !!transferBusy || !canImportTenantData}>
              Import Tenant Data
            </button>
          </div>
        </div>
      ) : null}

      {lastImportSummary ? (
        <div className="card" style={{ padding: 16, marginBottom: 12, border: '1px solid #bbf7d0', background: '#f0fdf4' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 800, color: '#166534' }}>Last Import Summary</div>
              <div style={{ color: '#166534', fontSize: 13 }}>
                Tenant: {lastImportSummary.tenantId || 'Current Tenant'} • Mode: {lastImportSummary.mode === 'overwrite' ? 'Overwrite Current Data' : 'Keep Current Data'}
              </div>
            </div>
            <button className="btn" type="button" onClick={() => setLastImportSummary(null)}>Dismiss</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
            <div className="card" style={{ padding: 12 }}><div style={{ color: '#64748b', fontSize: 12 }}>Inserted</div><div style={{ fontSize: 22, fontWeight: 800 }}>{lastImportSummary.summary.inserted}</div></div>
            <div className="card" style={{ padding: 12 }}><div style={{ color: '#64748b', fontSize: 12 }}>Updated</div><div style={{ fontSize: 22, fontWeight: 800 }}>{lastImportSummary.summary.updated}</div></div>
            <div className="card" style={{ padding: 12 }}><div style={{ color: '#64748b', fontSize: 12 }}>Skipped</div><div style={{ fontSize: 22, fontWeight: 800 }}>{lastImportSummary.summary.skipped}</div></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {lastImportSummary.summary.perCollection.map((row) => (
              <div key={row.collection} style={{ padding: '8px 10px', border: '1px solid #d1fae5', borderRadius: 10, background: '#fff' }}>
                <div style={{ fontWeight: 700 }}>{row.collection}</div>
                <div style={{ color: '#64748b', fontSize: 12 }}>Inserted: {row.inserted} • Updated: {row.updated} • Skipped: {row.skipped}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, alignItems: 'start' }}>
        <div className="card" style={{ padding: 10 }}>
          {collections.map(c => (
            <button
              key={c.key}
              className="btn"
              onClick={() => setSelected(c.key)}
              style={{
                width: '100%',
                justifyContent: 'space-between',
                marginBottom: 8,
                background: selected === c.key ? '#0b1220' : undefined,
                color: selected === c.key ? '#fff' : undefined,
                borderColor: selected === c.key ? '#0b1220' : undefined
              }}
            >
              <span style={{ textTransform: 'lowercase' }}>{c.label}</span>
              {c.count > 0 ? (
                <span style={{ minWidth: 26, height: 22, borderRadius: 999, padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#ef4444', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                  {c.count}
                </span>
              ) : (
                <span style={{ color: selected === c.key ? '#cbd5e1' : '#94a3b8', fontSize: 12 }}>0</span>
              )}
            </button>
          ))}
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>
            Offline mode: {String(settings?.featureFlags?.['features.offlineBackup'] === false ? 'disabled' : 'enabled')}
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h2 className="section-title" style={{ marginTop: 0, textTransform: 'lowercase' }}>{selected}</h2>
          <table className="table">
            <thead>
              <tr>
                {String(auth.role || '').toLowerCase() === 'superadmin' ? <th align="left">Select</th> : null}
                <th align="left">Time</th>
                <th align="left">Action</th>
                <th align="left">Target</th>
                <th align="left">Status</th>
                <th align="left">Reason</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => {
                const saleMeta = describeQueuedSale(it);
                const isSale = isQueuedSale(it);
                const isBusy = getQueueBusyState(it?.id);
                const colspan = String(auth.role || '').toLowerCase() === 'superadmin' ? 7 : 6;
                return (
                  <Fragment key={it.id}>
                    <tr>
                      {String(auth.role || '').toLowerCase() === 'superadmin' ? (
                        <td>
                          <input type="checkbox" checked={selectedIds.includes(it.id)} onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...prev, it.id] : prev.filter((id) => id !== it.id))} />
                        </td>
                      ) : null}
                      <td>{new Date(it.ts || Date.now()).toLocaleString()}</td>
                      <td>{it?.payload?.label || it.type}</td>
                      <td><code style={{ fontSize: 12 }}>{it?.payload?.path || ''}</code></td>
                      <td><span style={{ color: it.lastError ? '#dc2626' : '#f59e0b', fontWeight: 700 }}>{it.lastError ? 'failed' : 'pending'}</span></td>
                      <td style={{ color: '#64748b', fontSize: 12 }}>{it.lastError || '-'}</td>
                      <td>
                        {isSale ? (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="btn btn-primary" type="button" onClick={() => onRetryItem(it)} disabled={isBusy || !navigator.onLine}>
                              {retryingId === String(it?.id || '') ? 'Retrying…' : 'Retry Push'}
                            </button>
                            <button className="btn" type="button" onClick={() => onUndoItem(it)} disabled={isBusy}>
                              {undoingId === String(it?.id || '') ? 'Undoing…' : 'Undo Sale'}
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: 12 }}>-</span>
                        )}
                      </td>
                    </tr>
                    {isSale ? (
                      <tr>
                        <td colSpan={colspan} style={{ background: '#f8fafc', padding: 12 }}>
                          <div style={{ display: 'grid', gap: 10 }}>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: '#475569', fontSize: 13 }}>
                              <span><strong>Sale Ref:</strong> {saleMeta.saleId || '-'}</span>
                              <span><strong>Receipt:</strong> {saleMeta.receiptNumber || '-'}</span>
                              <span><strong>Branch:</strong> {saleMeta.branchName}</span>
                              <span><strong>Customer:</strong> {saleMeta.customerName}</span>
                              <span><strong>Total:</strong> {formatCurrency(saleMeta.total, settings)}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: '#64748b', fontSize: 12 }}>
                              <span>Subtotal: {formatCurrency(saleMeta.subtotal, settings)}</span>
                              <span>Discount: {formatCurrency(saleMeta.discount, settings)}</span>
                              <span>Tax: {formatCurrency(saleMeta.tax, settings)}</span>
                              <span>Type: {String(saleMeta.sale?.posType || saleMeta.sale?.inventoryType || 'retail')}</span>
                            </div>
                            <div style={{ display: 'grid', gap: 8 }}>
                              {saleMeta.items.map((line, index) => {
                                const unitCodes = Array.isArray(line?.soldUnits)
                                  ? line.soldUnits.map((unit) => String(unit?.imei || unit?.serialNumber || unit?.unitId || '').trim()).filter(Boolean)
                                  : [];
                                return (
                                  <div key={`${it.id}-${index}`} style={{ padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                      <div style={{ fontWeight: 700 }}>
                                        {line?.name || line?.sku || line?.productId || 'Item'}
                                        {line?.variantId ? ` (${line.variantId})` : ''}
                                      </div>
                                      <div style={{ fontWeight: 700 }}>{Number(line?.qty || 0)} x {formatCurrency(Number(line?.price || 0), settings)}</div>
                                    </div>
                                    <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
                                      SKU: {line?.sku || '-'}{line?.priceTier ? ` || Price Tier: ${line.priceTier}` : ''}{line?.productId ? ` || Product ID: ${line.productId}` : ''}
                                    </div>
                                    {unitCodes.length > 0 ? (
                                      <div style={{ color: '#0f172a', fontSize: 12, marginTop: 6 }}>
                                        Serialized: {unitCodes.join(' || ')}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                              {saleMeta.items.length === 0 ? (
                                <div style={{ color: '#94a3b8', fontSize: 12 }}>No sale lines found in this queued record.</div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={String(auth.role || '').toLowerCase() === 'superadmin' ? 7 : 6} style={{ padding: 12, color: '#94a3b8' }}>No pending offline records</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {importOpen && (
        <Modal
          title="Import Tenant Data"
          onClose={() => { if (transferBusy !== 'import') setImportOpen(false); }}
          footer={
            <>
              <button className="btn" type="button" onClick={() => setImportOpen(false)} disabled={transferBusy === 'import'}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={onImportTenantData} disabled={transferBusy === 'import' || !importPayload}>
                {transferBusy === 'import' ? 'Importing…' : 'Start Import'}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: '#64748b' }}>
              Import a tenant backup into the current tenant database. Choose whether to keep current data or overwrite it completely.
            </div>
            <label>
              Backup File
              <input ref={fileInputRef} className="input" type="file" accept="application/json,.json" onChange={(e) => onImportFileChange(e.target.files?.[0] || null)} disabled={transferBusy === 'import'} />
            </label>
            <label>
              Import Mode
              <select className="input" value={importMode} onChange={(e) => setImportMode(e.target.value)} disabled={transferBusy === 'import'}>
                <option value="keep_current">Keep Current Data</option>
                <option value="overwrite">Overwrite Current Data</option>
              </select>
            </label>
            {importMode === 'overwrite' ? (
              <div className="card" style={{ padding: 12, border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b' }}>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>Warning: Overwrite Current Data</div>
                <div>This will delete the current tenant collections before importing the backup. Use this only when you want the backup to fully replace the current database.</div>
              </div>
            ) : null}
            {importSummary ? (
              <div className="card" style={{ padding: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Import Preview</div>
                <div style={{ color: '#64748b', marginBottom: 8 }}>
                  Tenant: {importSummary.tenantId || 'Unknown'} • Collections: {importSummary.totalCollections} • Documents: {importSummary.totalDocuments}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  {importSummary.collectionNames.map((name) => (
                    <div key={name} style={{ padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc' }}>
                      <div style={{ fontWeight: 700 }}>{name}</div>
                      <div style={{ color: '#64748b', fontSize: 12 }}>{importSummary.counts[name] || 0} item(s)</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {importProgress ? (
              <div className="card" style={{ padding: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <div style={{ fontWeight: 800 }}>Import Progress</div>
                  <div style={{ color: '#2563eb', fontWeight: 800 }}>{importProgress.percentage}%</div>
                </div>
                <div style={{ height: 10, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ width: `${importProgress.percentage}%`, height: '100%', background: '#2563eb' }} />
                </div>
                <div style={{ color: '#475569' }}>
                  Copying <strong>{importProgress.currentCollection}</strong> ({importProgress.currentCount || 0} item(s)) • {importProgress.completedCollections}/{importProgress.totalCollections} collection(s)
                </div>
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
                  Estimated time remaining: {importProgress.remainingMs == null ? 'Calculating…' : formatDurationMs(importProgress.remainingMs)}
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default BackupPage;
