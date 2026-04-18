import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import * as auditsApi from '../api/audits';
import { setEntries } from '../store/auditSlice';
import { removeEntries as removeAuditEntries } from '../store/auditSlice';
import InlineSpinner from '../components/InlineSpinner';
import { confirmDialog } from '../utils/dialogs';

function toCsv(rows) {
  const headers = ['Timestamp','Tenant','Severity','Actor','Action','Branch','Remark','Details'];
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(',')];
  rows.forEach(r => {
    lines.push([
      r.ts, r.tenantName ?? r.tenantId ?? '', r.severity ?? 'info', r.actor, r.actionType, r.branchLabel ?? r.branchId ?? '', r.remark ?? '', JSON.stringify(r.details ?? {})
    ].map(escape).join(','));
  });
  return lines.join('\n');
}

const SEVERITY_OPTIONS = ['info', 'warn', 'error', 'critical'];
const severityStyle = {
  info: { background: '#dbeafe', color: '#1d4ed8' },
  warn: { background: '#fef3c7', color: '#b45309' },
  error: { background: '#fee2e2', color: '#b91c1c' },
  critical: { background: '#ede9fe', color: '#6d28d9' }
};

function AuditLogPage() {
  const dispatch = useDispatch();
  const entries = useSelector(s => s.audit.entries);
  const branches = useSelector(s => s.branches.branches);
  const isSuper = String(useSelector(s => s.auth.role || '') || '').toLowerCase() === 'superadmin';
  const currentTenantId = useSelector(s => s.auth.user?.tenantId || '');
  const [qActor, setQActor] = useState('');
  const [qAction, setQAction] = useState('');
  const [qBranch, setQBranch] = useState('');
  const [qTenant, setQTenant] = useState('');
  const [qSeverity, setQSeverity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [periodMode, setPeriodMode] = useState('range');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const actors = useMemo(() => Array.from(new Set(entries.map(e => e.actor).filter(Boolean))).sort(), [entries]);
  const actions = useMemo(() => Array.from(new Set(entries.map(e => e.actionType).filter(Boolean))).sort(), [entries]);
  const tenants = useMemo(() => Array.from(new Set(entries.map(e => e.tenantName || e.tenantId).filter(Boolean))).sort(), [entries]);
  const byId = useMemo(() => {
    const map = new Map();
    branches.forEach(b => map.set(b.id, b.name));
    return map;
  }, [branches]);

  const filtered = useMemo(() => {
    const fromTs = periodMode === 'all_time' ? 0 : (from ? new Date(from).getTime() : 0);
    const toTs = periodMode === 'all_time' ? Number.MAX_SAFE_INTEGER : (to ? new Date(to).getTime() : Number.MAX_SAFE_INTEGER);
    return entries.filter(e => {
      const ts = new Date(e.ts).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (qActor && e.actor !== qActor) return false;
      if (qAction && e.actionType !== qAction) return false;
      if (qBranch && e.branchId !== qBranch) return false;
      if (qTenant && (e.tenantId !== qTenant && e.tenantName !== qTenant)) return false;
      if (qSeverity && String(e.severity || 'info') !== qSeverity) return false;
      return true;
    }).map(e => ({ ...e, branchLabel: byId.get(e.branchId) || e.branchId || '—' }));
  }, [entries, from, to, qActor, qAction, qBranch, qTenant, qSeverity, byId, periodMode]);
  const summary = useMemo(() => ({
    total: filtered.length,
    critical: filtered.filter(r => String(r.severity || 'info') === 'critical').length,
    errors: filtered.filter(r => String(r.severity || 'info') === 'error').length,
    actors: new Set(filtered.map(r => String(r.actor || '').trim()).filter(Boolean)).size,
    actions: new Set(filtered.map(r => String(r.actionType || '').trim()).filter(Boolean)).size
  }), [filtered]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await auditsApi.list(500, {
          tenantId: isSuper ? qTenant : '',
          from,
          to,
          severity: qSeverity
        });
        if (alive) dispatch(setEntries(rows));
      } catch {}
    })();
    return () => { alive = false; };
  }, [dispatch, isSuper, qTenant, from, to, qSeverity]);

  function exportCsv() {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-log.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function deleteSelected() {
    if (!isSuper) return;
    const ids = selectedIds.filter(Boolean);
    if (ids.length === 0) return;
    const ok = await confirmDialog(`Delete ${ids.length} selected audit record(s)?`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await auditsApi.removeMany(ids);
      dispatch(removeAuditEntries(ids));
      setSelectedIds([]);
      setBulkAction('');
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>Audit Log</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Audit Records</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.total}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Critical</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.critical}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Errors</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.errors}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Actors</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.actors}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Actions</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.actions}</div></div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="filter-grid">
          <label>
            Period
            <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
              <option value="range">Custom Range</option>
              <option value="all_time">All Time</option>
            </select>
          </label>
          <label>
            From
            <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            To
            <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          {isSuper && (
            <label>
              Tenant
              <select className="select" value={qTenant} onChange={e => setQTenant(e.target.value)}>
                <option value="">All</option>
                {tenants.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
          <label>
            Severity
            <select className="select" value={qSeverity} onChange={e => setQSeverity(e.target.value)}>
              <option value="">All</option>
              {SEVERITY_OPTIONS.map(level => <option key={level} value={level}>{level}</option>)}
            </select>
          </label>
          <label>
            Actor
            <select className="select" value={qActor} onChange={e => setQActor(e.target.value)}>
              <option value="">All</option>
              {actors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>
            Action
            <select className="select" value={qAction} onChange={e => setQAction(e.target.value)}>
              <option value="">All</option>
              {actions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>
            Branch
            <select className="select" value={qBranch} onChange={e => setQBranch(e.target.value)}>
              <option value="">All</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <div style={{ alignSelf: 'end', display: 'inline-flex', gap: 6 }}>
            <button className="btn" onClick={exportCsv}>Export CSV</button>
            {isSuper && (
              <>
                <select className="select" value={bulkAction} onChange={e => setBulkAction(e.target.value)} disabled={bulkDeleting}>
                  <option value="">Actions</option>
                  <option value="delete">Delete Selected</option>
                </select>
                <button className="btn" disabled={bulkDeleting || bulkAction !== 'delete' || selectedIds.length === 0} onClick={() => void deleteSelected()}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {bulkDeleting && <InlineSpinner />}
                    {bulkDeleting ? 'Deleting…' : 'Apply'}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="card">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {isSuper && (
                <th align="left">
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={filtered.length > 0 && filtered.every(e => selectedIds.includes(String(e._id || e.id || '')))}
                    onChange={e => setSelectedIds(e.target.checked ? filtered.map(x => String(x._id || x.id || '')).filter(Boolean) : [])}
                  />
                </th>
              )}
              <th align="left">Timestamp</th>
              {isSuper && <th align="left">Tenant</th>}
              <th align="left">Severity</th>
              <th align="left">Actor</th>
              <th align="left">Action</th>
              <th align="left">Branch</th>
              <th align="left">Remark</th>
              <th align="left">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id} style={{ borderTop: '1px solid #e2e8f0', opacity: bulkDeleting && selectedIds.includes(String(e._id || e.id || '')) ? 0.55 : 1 }}>
                {isSuper && (
                  <td>
                    <input
                      type="checkbox"
                      disabled={bulkDeleting}
                      checked={selectedIds.includes(String(e._id || e.id || ''))}
                      onChange={evt => setSelectedIds(prev => evt.target.checked ? [...new Set([...prev, String(e._id || e.id || '')])] : prev.filter(id => id !== String(e._id || e.id || '')))}
                    />
                  </td>
                )}
                <td>{new Date(e.ts).toLocaleString()}</td>
                {isSuper && <td>{e.tenantName || e.tenantId || currentTenantId || '—'}</td>}
                <td>
                  <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, ...(severityStyle[String(e.severity || 'info')] || severityStyle.info) }}>
                    {String(e.severity || 'info')}
                  </span>
                </td>
                <td>{e.actor}</td>
                <td>{e.actionType}</td>
                <td>{e.branchLabel}</td>
                <td>{e.remark || '—'}</td>
                <td><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(e.details || {}, null, 2)}</pre></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={isSuper ? 9 : 7} style={{ padding: 12, color: '#64748b' }}>No entries</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AuditLogPage;
