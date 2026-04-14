import { useCallback, useEffect, useMemo, useState } from 'react';
import * as tenantsApi from '../api/tenants';
import { FEATURE_CATALOG } from '../utils/featureFlags';
import { useToast } from '../components/ToastProvider';

const PLAN_OPTIONS = ['basic', 'pro', 'enterprise'];

function TenantsPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState('');
  const [form, setForm] = useState({
    tenantId: '',
    name: '',
    subscriptionPlan: 'basic',
    clientAppName: '',
    adminName: '',
    adminPin: '',
    features: []
  });

  const grouped = useMemo(() => {
    const map = new Map();
    FEATURE_CATALOG.forEach((item) => {
      const group = item.group || 'Other';
      if (!map.has(group)) map.set(group, []);
      map.get(group).push(item);
    });
    return Array.from(map.entries());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await tenantsApi.list());
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load tenants'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  function setValue(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleFeature(key) {
    setForm((prev) => {
      const set = new Set(prev.features || []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...prev, features: Array.from(set) };
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        tenantId: form.tenantId,
        name: form.name,
        subscriptionPlan: form.subscriptionPlan,
        clientAppName: form.clientAppName,
        adminName: form.adminName,
        adminPin: form.adminPin,
        features: form.features
      };
      if (editing) {
        await tenantsApi.update(editing, payload);
        if (form.adminName && form.adminPin) {
          await tenantsApi.setAdmin(editing, { adminName: form.adminName, adminPin: form.adminPin });
        }
        toast.show('Tenant updated', { type: 'success' });
      } else {
        await tenantsApi.create(payload);
        toast.show('Tenant created', { type: 'success' });
      }
      setForm({ tenantId: '', name: '', subscriptionPlan: 'basic', clientAppName: '', adminName: '', adminPin: '', features: [] });
      setEditing('');
      await load();
    } catch (e2) {
      toast.show(String(e2?.message || 'Failed to save tenant'), { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row) {
    setEditing(String(row.tenantId || ''));
    setForm({
      tenantId: String(row.tenantId || ''),
      name: String(row.name || ''),
      subscriptionPlan: String(row.subscriptionPlan || 'basic'),
      clientAppName: String(row.clientAppName || ''),
      adminName: '',
      adminPin: '',
      features: Array.isArray(row.features) ? row.features : []
    });
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ marginBottom: 6 }}>Tenants</h1>
        <div style={{ color: '#64748b' }}>Create companies, assign plans, and override features from one master control.</div>
      </div>

      <form className="card" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label>
            Tenant ID
            <input className="input" value={form.tenantId} onChange={(e) => setValue('tenantId', e.target.value)} disabled={!!editing} />
          </label>
          <label>
            Company Name
            <input className="input" value={form.name} onChange={(e) => setValue('name', e.target.value)} />
          </label>
          <label>
            Client App Name
            <input className="input" value={form.clientAppName} onChange={(e) => setValue('clientAppName', e.target.value)} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <label>
            Plan
            <select className="input" value={form.subscriptionPlan} onChange={(e) => setValue('subscriptionPlan', e.target.value)}>
              {PLAN_OPTIONS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
            </select>
          </label>
          <label>
            Default Admin Username
            <input className="input" value={form.adminName} onChange={(e) => setValue('adminName', e.target.value)} />
          </label>
          <label>
            Default Admin PIN
            <input className="input" type="password" value={form.adminPin} onChange={(e) => setValue('adminPin', e.target.value)} />
          </label>
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Feature Overrides</div>
          <div style={{ display: 'grid', gap: 12 }}>
            {grouped.map(([group, items]) => (
              <div key={group}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{group}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {items.map((item) => (
                    <label key={item.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" checked={(form.features || []).includes(item.key)} onChange={() => toggleFeature(item.key)} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Update Tenant' : 'Create Tenant'}</button>
          {editing && <button className="btn" type="button" onClick={() => { setEditing(''); setForm({ tenantId: '', name: '', subscriptionPlan: 'basic', clientAppName: '', adminName: '', adminPin: '', features: [] }); }}>Cancel</button>}
        </div>
      </form>

      <div className="card">
        <h2 className="section-title">Tenant Directory</h2>
        {loading ? <div>Loading…</div> : (
          <table className="table">
            <thead>
              <tr>
                <th align="left">Tenant ID</th>
                <th align="left">Company</th>
                <th align="left">Plan</th>
                <th align="left">Database</th>
                <th align="left">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tenantId}>
                  <td>{row.tenantId}</td>
                  <td>{row.name}</td>
                  <td>{row.subscriptionPlan}</td>
                  <td>{row.dbName}</td>
                  <td>{row.disabled ? 'Disabled' : 'Active'}</td>
                  <td><button className="btn" onClick={() => startEdit(row)}>Edit</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="6" style={{ color: '#64748b', padding: 12 }}>No tenants yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default TenantsPage;
