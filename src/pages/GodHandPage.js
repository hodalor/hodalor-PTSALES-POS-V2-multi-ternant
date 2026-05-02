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
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>GodHand</h1>
        <OfflineQueueIndicator collection="settings" label="Settings queued" />
      </div>
      <div className="page-subtitle-compact" style={{ marginBottom: 12 }}>
        Toggle features ON/OFF for the whole system. Hidden features are removed from menus and blocked by routes.
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Search feature (e.g. POS, refunds, users)"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <button className="btn" onClick={onResetAll} disabled={saving}>Enable All</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>

      {groups.map(([groupName, rows]) => (
        <div key={groupName} className="card" style={{ marginBottom: 12 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>{groupName}</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {rows.map(row => {
              const enabled = localFlags?.[row.key] !== false;
              return (
                <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 10, border: '1px solid #e2e8f0', borderRadius: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800 }}>{row.label}</div>
                    <div style={{ color: '#64748b', fontSize: 12, wordBreak: 'break-all' }}>{row.key}</div>
                  </div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={e => setLocalFlags(f => setFeatureFlag(f, row.key, e.target.checked))}
                    />
                    <span>{enabled ? 'Enabled' : 'Hidden'}</span>
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
