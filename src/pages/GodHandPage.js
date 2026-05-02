import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import * as settingsApi from '../api/settings';
import { setAllSettings } from '../store/settingsSlice';
import { FEATURE_CATALOG, setFeatureFlag } from '../utils/featureFlags';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';

function GodHandPage() {
  const dispatch = useDispatch();
  const toast = useToast();
  const settings = useSelector(s => s.settings);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [localFlags, setLocalFlags] = useState(() => settings.featureFlags || {});
  useEffect(() => {
    setLocalFlags(settings.featureFlags || {});
  }, [settings.featureFlags]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = FEATURE_CATALOG.slice();
    if (!q) return rows;
    return rows.filter(x =>
      String(x.label || '').toLowerCase().includes(q) ||
      String(x.key || '').toLowerCase().includes(q) ||
      String(x.group || '').toLowerCase().includes(q)
    );
  }, [query]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const row of filtered) {
      const g = row.group || 'Other';
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(row);
    }
    return Array.from(map.entries());
  }, [filtered]);

  async function onSave() {
    if (saving) return;
    setSaving(true);
    const data = { ...settings, featureFlags: localFlags };
    try {
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return;
        }
        await enqueueHttp({ collection: 'settings', label: 'Settings', path: '/api/settings', method: 'PUT', body: data });
        dispatch(setAllSettings(data));
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
        return;
      }
      const out = await settingsApi.save(data);
      dispatch(setAllSettings(out));
      toast.show('Features saved', { type: 'success' });
    } catch (e) {
      toast.show('Failed to save features', { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function onResetAll() {
    setLocalFlags({});
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>GodHand</h1>
          <div className="page-subtitle-compact">
            Control menus, submenus, finance, dashboard competition visibility, distribution and warehouse screens, runtime tabs, and grant-backed feature access from one place.
          </div>
        </div>
        <div className="page-header-actions">
          <OfflineQueueIndicator collection="settings" label="Settings queued" />
        </div>
      </div>
      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-label">Feature Groups</div><div className="stat-value">{groups.length}</div></div>
        <div className="card stat-card"><div className="stat-label">Visible Feature Rows</div><div className="stat-value">{filtered.length}</div></div>
        <div className="card stat-card"><div className="stat-label">Hidden Overrides</div><div className="stat-value">{Object.keys(localFlags || {}).length}</div></div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>How To Use GodHand Safely</h2>
        <div className="section-note" style={{ marginBottom: 10 }}>
          Use GodHand when you want to show or hide modules, sidebar menus, pages, tabs, and paid capabilities for a tenant.
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
          <li>Use the search box to find the page, module, or feature you want to control.</li>
          <li>Open the matching feature group and switch only the exact items you want to enable or hide.</li>
          <li>Remember that hiding a feature removes it from the sidebar and also blocks direct route access where supported.</li>
          <li>Click Save, then test with a user from that tenant to confirm the visible menus now match the paid plan or allowed workflow.</li>
        </ol>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-header">
          <input
            className="input"
            placeholder="Search feature (e.g. POS, refunds, users)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <div className="inline-actions">
            <button className="btn" onClick={onResetAll} disabled={saving}>Enable All</button>
            <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </div>

      {groups.map(([groupName, rows]) => (
        <div key={groupName} className="card" style={{ marginBottom: 12 }}>
          <div className="section-header" style={{ marginBottom: 8 }}>
            <div>
              <h2 className="section-title" style={{ marginTop: 0, marginBottom: 4 }}>{groupName}</h2>
              <div className="section-note">
                {rows.length} feature item(s) in this group. Disabling an item hides it from menus and blocks direct route access where applicable.
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {rows.map(row => {
              const enabled = localFlags?.[row.key] !== false;
              return (
                <div key={row.key} className="surface-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800 }}>{row.label}</div>
                    <div className="mini-record-subtle" style={{ wordBreak: 'break-all' }}>{row.key}</div>
                  </div>
                  <label className="inline-actions" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={e => setLocalFlags(f => setFeatureFlag(f, row.key, e.target.checked))}
                    />
                    <span className={`status-pill ${enabled ? 'status-pill-approved' : 'status-pill-rejected'}`}>{enabled ? 'Enabled' : 'Hidden'}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default GodHandPage;
