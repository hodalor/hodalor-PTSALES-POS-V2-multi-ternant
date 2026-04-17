import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector, useStore } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import { attemptSync, removeMany } from '../offline/queue';
import { COLLECTIONS, getQueueSummary, listQueuedByCollection } from '../offline/offlineBackup';
import { syncQueuedItem } from '../offline/syncHandlers';
import { ensureOnlineJwt } from '../offline/reAuth';
import { refreshAllData } from '../offline/refreshAll';
import { useDispatch } from 'react-redux';
import { listImeiConflicts } from '../offline/imeiConflicts';
import { setQueueSummary } from '../store/offlineQueueSlice';

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

  return (
    <div style={{ padding: 16 }}>
      <div className="card" style={{ padding: 16, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Backup & Sync</h1>
          <div style={{ color: '#64748b', marginTop: 6 }}>
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
              </tr>
            </thead>
            <tbody>
              {rows.map(it => (
                <tr key={it.id}>
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
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={String(auth.role || '').toLowerCase() === 'superadmin' ? 6 : 5} style={{ padding: 12, color: '#94a3b8' }}>No pending offline records</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default BackupPage;
