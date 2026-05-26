import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import * as serverLogsApi from '../api/serverLogs';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import { confirmDialog } from '../utils/dialogs';

function ServerLogsPage() {
  const [logs, setLogs] = useState([]);
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const isSuper = String(useSelector(s => s.auth.role) || '').toLowerCase() === 'superadmin';
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await serverLogsApi.list(800);
        if (alive && Array.isArray(rows)) setLogs(rows);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return logs.filter(l => {
      if (level && l.level !== level) return false;
      if (t) {
        const s = `${l.message || ''} ${l.errorMeaning || ''} ${l.errorCode || ''} ${l.actor || ''} ${l.route || ''}`.toLowerCase();
        if (!s.includes(t)) return false;
      }
      return true;
    });
  }, [logs, level, q]);
  const refreshSec = useSelector(s => s.settings.refreshIntervalSec || 60);
  useEffect(() => {
    let alive = true;
    const interval = setInterval(async () => {
      if (!alive) return;
      try {
        const rows = await serverLogsApi.list(800);
        if (alive && Array.isArray(rows)) setLogs(rows);
      } catch {}
    }, Math.max(10000, Number(refreshSec) * 1000));
    return () => { alive = false; clearInterval(interval); };
  }, [refreshSec]);
  function onExportCsv() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: l => new Date(l.ts || l.createdAt).toLocaleString() },
      { key: 'level', label: 'Level' },
      { key: 'actor', label: 'Actor' },
      { key: 'route', label: 'Route', value: l => `${l.method ? `${l.method} ` : ''}${l.route || ''}`.trim() },
      { key: 'message', label: 'Message' },
      { key: 'errorCode', label: 'Code' },
      { key: 'errorMeaning', label: 'Meaning' },
      { key: 'status', label: 'Status' }
    ];
    exportCsv('server-logs.csv', headers, filtered);
  }
  function onExportPdf() {
    const headers = [
      { key: 'ts', label: 'Timestamp', value: l => new Date(l.ts || l.createdAt).toLocaleString() },
      { key: 'level', label: 'Level' },
      { key: 'actor', label: 'Actor' },
      { key: 'route', label: 'Route', value: l => `${l.method ? `${l.method} ` : ''}${l.route || ''}`.trim() },
      { key: 'message', label: 'Message' },
      { key: 'errorCode', label: 'Code' },
      { key: 'errorMeaning', label: 'Meaning' },
      { key: 'status', label: 'Status' }
    ];
    exportTablePdf('Server Logs', headers, filtered);
  }
  async function deleteSelected() {
    const ids = selectedIds.filter(Boolean);
    if (ids.length === 0) return;
    const ok = await confirmDialog(`Delete ${ids.length} selected server log(s)? They will go to Super Bin.`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await serverLogsApi.removeMany(ids);
      setLogs(prev => prev.filter(l => !ids.includes(String(l._id || ''))));
      setSelectedIds([]);
      setBulkAction('');
      setPage(1);
    } finally {
      setBulkDeleting(false);
    }
  }
  if (!isSuper) return <div style={{ padding: 16 }}>Forbidden</div>;
  return (
    <div style={{ padding: 16 }}>
      <h1>Server Logs</h1>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select" value={level} onChange={e => { setLevel(e.target.value); setPage(1); }}>
            <option value="">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
          <input className="input" placeholder="Search message/actor/route/code" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} style={{ minWidth: 260 }} />
          <button className="btn" onClick={async () => {
            try {
              const rows = await serverLogsApi.list(800);
              if (Array.isArray(rows)) { setLogs(rows); setPage(1); }
            } catch {}
          }}>Refresh</button>
          <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <button className="btn" onClick={onExportCsv}>Export CSV</button>
            <button className="btn" onClick={onExportPdf}>Export PDF</button>
            <select className="select" value={bulkAction} onChange={e => setBulkAction(e.target.value)} disabled={bulkDeleting}>
              <option value="">Actions</option>
              <option value="delete">Delete Selected</option>
            </select>
            <button className="btn" disabled={bulkDeleting || bulkAction !== 'delete' || selectedIds.length === 0} onClick={() => void deleteSelected()}>
              {bulkDeleting ? 'Deleting…' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">
                <input
                  type="checkbox"
                  disabled={bulkDeleting}
                  checked={filtered.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).length > 0 && filtered.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).every(l => selectedIds.includes(String(l._id || '')))}
                  onChange={e => {
                    const pageIds = filtered.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(l => String(l._id || '')).filter(Boolean);
                    setSelectedIds(prev => e.target.checked ? [...new Set([...prev, ...pageIds])] : prev.filter(id => !pageIds.includes(id)));
                  }}
                />
              </th>
              <th align="left">Timestamp</th>
              <th align="left">Level</th>
              <th align="left">Actor</th>
              <th align="left">Route</th>
              <th align="left">Message</th>
              <th align="left">Code</th>
              <th align="left">Meaning</th>
              <th align="left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(l => (
              <tr key={l._id || `${l.ts}-${l.message}`} style={{ borderTop: '1px solid #e2e8f0', opacity: bulkDeleting && selectedIds.includes(String(l._id || '')) ? 0.55 : 1 }}>
                <td>
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={selectedIds.includes(String(l._id || ''))}
                    onChange={e => setSelectedIds(prev => e.target.checked ? [...new Set([...prev, String(l._id || '')])] : prev.filter(id => id !== String(l._id || '')))}
                  />
                </td>
                <td>{new Date(l.ts || l.createdAt).toLocaleString()}</td>
                <td>{l.level || 'info'}</td>
                <td>{l.actor || '—'}</td>
                <td>{l.method ? `${l.method} ` : ''}{l.route || '—'}</td>
                <td title={l.stack || ''}>{l.message || '—'}</td>
                <td>{l.errorCode || '—'}</td>
                <td>{l.errorMeaning || '—'}</td>
                <td>{l.status ?? '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan="9" style={{ padding: 12, color: '#64748b' }}>No logs</td></tr>
            )}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
            <span>Page {page} of {Math.max(1, Math.ceil(filtered.length / pageSize))}</span>
            <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(filtered.length / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(filtered.length / pageSize))}>Next</button>
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

export default ServerLogsPage;
