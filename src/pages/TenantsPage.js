import { useCallback, useEffect, useMemo, useState } from 'react';
import * as tenantsApi from '../api/tenants';
import { useToast } from '../components/ToastProvider';
import Modal from '../components/Modal';
import { getPlanDefaultFeatures, TENANT_SIDEBAR_SECTIONS } from '../utils/tenantAccess';

const PLAN_OPTIONS = ['basic', 'pro', 'enterprise'];
const EMPTY_FORM = {
  tenantId: '',
  name: '',
  subscriptionPlan: 'basic',
  clientAppName: '',
  themeColor: '#16a34a',
  subscriptionExpiresAt: '',
  adminName: '',
  adminPin: '',
  maxUserAccountsOverride: '',
  maxActiveUsersOverride: '',
  features: getPlanDefaultFeatures('basic')
};

function TenantsPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [editing, setEditing] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [limitDefaults, setLimitDefaults] = useState({
    basic: { maxUserAccounts: '', maxActiveUsers: '' },
    pro: { maxUserAccounts: '', maxActiveUsers: '' },
    enterprise: { maxUserAccounts: '', maxActiveUsers: '' }
  });

  const sections = useMemo(() => TENANT_SIDEBAR_SECTIONS, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantRows, defaults] = await Promise.all([tenantsApi.list(), tenantsApi.getLimitDefaults()]);
      setRows(tenantRows);
      setLimitDefaults({
        basic: { maxUserAccounts: defaults?.basic?.maxUserAccounts ?? '', maxActiveUsers: defaults?.basic?.maxActiveUsers ?? '' },
        pro: { maxUserAccounts: defaults?.pro?.maxUserAccounts ?? '', maxActiveUsers: defaults?.pro?.maxActiveUsers ?? '' },
        enterprise: { maxUserAccounts: defaults?.enterprise?.maxUserAccounts ?? '', maxActiveUsers: defaults?.enterprise?.maxActiveUsers ?? '' }
      });
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

  function resetForm(nextPlan = 'basic') {
    setEditing('');
    setForm({ ...EMPTY_FORM, themeColor: '#16a34a', subscriptionPlan: nextPlan, features: getPlanDefaultFeatures(nextPlan) });
  }

  function openCreateModal() {
    resetForm('basic');
    setShowForm(true);
  }

  function closeModal() {
    setShowForm(false);
    resetForm('basic');
  }

  function daysLeftLabel(value) {
    if (!value) return 'No expiry set';
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return 'Invalid date';
    const days = Math.ceil((ts - Date.now()) / (24 * 3600 * 1000));
    if (days < 0) return `Expired ${Math.abs(days)} day(s) ago`;
    if (days === 0) return 'Expires today';
    return `${days} day(s) left`;
  }

  function hasAll(keys) {
    const set = new Set(form.features || []);
    return keys.every((key) => set.has(key));
  }

  function toggleKeys(keys, checked) {
    setForm((prev) => {
      const set = new Set(prev.features || []);
      const shouldEnable = typeof checked === 'boolean' ? checked : !keys.every((key) => set.has(key));
      keys.forEach((key) => {
        if (shouldEnable) set.add(key);
        else set.delete(key);
      });
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
        themeColor: form.themeColor,
        subscriptionExpiresAt: form.subscriptionExpiresAt || null,
        adminName: form.adminName,
        adminPin: form.adminPin,
        maxUserAccountsOverride: form.maxUserAccountsOverride === '' ? null : Number(form.maxUserAccountsOverride),
        maxActiveUsersOverride: form.maxActiveUsersOverride === '' ? null : Number(form.maxActiveUsersOverride),
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
      closeModal();
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
      themeColor: String(row.themeColor || '#16a34a'),
      subscriptionExpiresAt: row.subscriptionExpiresAt ? String(row.subscriptionExpiresAt).slice(0, 10) : '',
      adminName: '',
      adminPin: '',
      maxUserAccountsOverride: row.maxUserAccountsOverride ?? '',
      maxActiveUsersOverride: row.maxActiveUsersOverride ?? '',
      features: Array.isArray(row.features) ? row.features : []
    });
    setShowForm(true);
  }

  function setLimitDefault(plan, key, value) {
    setLimitDefaults((prev) => ({
      ...prev,
      [plan]: { ...(prev[plan] || {}), [key]: value }
    }));
  }

  async function saveLimitDefaults() {
    if (savingDefaults) return;
    setSavingDefaults(true);
    try {
      const payload = {
        basic: {
          maxUserAccounts: limitDefaults.basic.maxUserAccounts === '' ? null : Number(limitDefaults.basic.maxUserAccounts),
          maxActiveUsers: limitDefaults.basic.maxActiveUsers === '' ? null : Number(limitDefaults.basic.maxActiveUsers)
        },
        pro: {
          maxUserAccounts: limitDefaults.pro.maxUserAccounts === '' ? null : Number(limitDefaults.pro.maxUserAccounts),
          maxActiveUsers: limitDefaults.pro.maxActiveUsers === '' ? null : Number(limitDefaults.pro.maxActiveUsers)
        },
        enterprise: {
          maxUserAccounts: limitDefaults.enterprise.maxUserAccounts === '' ? null : Number(limitDefaults.enterprise.maxUserAccounts),
          maxActiveUsers: limitDefaults.enterprise.maxActiveUsers === '' ? null : Number(limitDefaults.enterprise.maxActiveUsers)
        }
      };
      const saved = await tenantsApi.updateLimitDefaults(payload);
      setLimitDefaults({
        basic: { maxUserAccounts: saved?.basic?.maxUserAccounts ?? '', maxActiveUsers: saved?.basic?.maxActiveUsers ?? '' },
        pro: { maxUserAccounts: saved?.pro?.maxUserAccounts ?? '', maxActiveUsers: saved?.pro?.maxActiveUsers ?? '' },
        enterprise: { maxUserAccounts: saved?.enterprise?.maxUserAccounts ?? '', maxActiveUsers: saved?.enterprise?.maxActiveUsers ?? '' }
      });
      toast.show('Tenant user limits updated', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to save limits'), { type: 'error' });
    } finally {
      setSavingDefaults(false);
    }
  }

  function applyPlanDefaults() {
    setForm((prev) => ({ ...prev, features: getPlanDefaultFeatures(prev.subscriptionPlan) }));
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
        <h1 style={{ marginBottom: 6 }}>Tenants</h1>
        <div style={{ color: '#64748b' }}>Create companies, assign plans, and override features from one master control.</div>
        </div>
        <button className="btn btn-primary" onClick={openCreateModal}>Add Tenant</button>
      </div>

      <div className="card">
        <h2 className="section-title">Default User Limits By Plan</h2>
        <div style={{ color: '#64748b', marginBottom: 12 }}>
          Set general limits for each package. Leave blank for unlimited. Each tenant can still override these values individually.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {PLAN_OPTIONS.map((plan) => (
            <div key={plan} className="card" style={{ padding: 14, border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 800, marginBottom: 10, textTransform: 'capitalize' }}>{plan}</div>
              <div style={{ display: 'grid', gap: 10 }}>
                <label>
                  Max User Accounts
                  <input className="input" type="number" min="1" value={limitDefaults[plan]?.maxUserAccounts ?? ''} onChange={(e) => setLimitDefault(plan, 'maxUserAccounts', e.target.value)} placeholder="Unlimited" />
                </label>
                <label>
                  Max Active Users
                  <input className="input" type="number" min="1" value={limitDefaults[plan]?.maxActiveUsers ?? ''} onChange={(e) => setLimitDefault(plan, 'maxActiveUsers', e.target.value)} placeholder="Unlimited" />
                </label>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-primary" type="button" onClick={saveLimitDefaults} disabled={savingDefaults}>{savingDefaults ? 'Saving…' : 'Save Limit Defaults'}</button>
        </div>
      </div>

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
                <th align="left">Theme</th>
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
                  <td>{row.disabled ? 'Disabled' : 'Active'}{row.subscriptionExpiresAt ? ` • ${daysLeftLabel(String(row.subscriptionExpiresAt).slice(0, 10))}` : ''}</td>
                  <td><span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 999, background: String(row.themeColor || '#16a34a'), border: '1px solid #cbd5e1' }} /></td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="btn" onClick={() => startEdit(row)}>Edit</button>
                    <button className="btn" style={{ color: '#b91c1c' }} onClick={async () => {
                      const { confirmDialog } = await import('../utils/dialogs');
                      const ok = await confirmDialog(`Delete tenant ${row.name}? This removes the tenant database.`);
                      if (!ok) return;
                      try {
                        await tenantsApi.remove(row.tenantId);
                        toast.show('Tenant deleted', { type: 'success' });
                        await load();
                      } catch (e) {
                        toast.show(String(e?.message || 'Failed to delete tenant'), { type: 'error' });
                      }
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="7" style={{ color: '#64748b', padding: 12 }}>No tenants yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {showForm && (
        <Modal
          title={editing ? `Edit Tenant: ${editing}` : 'Add Tenant'}
          onClose={closeModal}
          variant="light"
          footer={
            <>
              <button className="btn" type="button" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" form="tenant-form" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Update Tenant' : 'Create Tenant'}</button>
            </>
          }
        >
          <form id="tenant-form" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
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
              <label>
                Theme Color
                <input className="input" type="color" value={form.themeColor || '#16a34a'} onChange={(e) => setValue('themeColor', e.target.value)} style={{ height: 44 }} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              <label>
                Plan
                <select className="input" value={form.subscriptionPlan} onChange={(e) => setValue('subscriptionPlan', e.target.value)}>
                  {PLAN_OPTIONS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                </select>
              </label>
              <label>
                Expiry Date
                <input className="input" type="date" value={form.subscriptionExpiresAt || ''} onChange={(e) => setValue('subscriptionExpiresAt', e.target.value)} />
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
            <div className="card" style={{ padding: 14, border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a' }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>User Limits</div>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
                Leave override fields blank to use the plan default. You can override a tenant regardless of its package.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  Max User Accounts Override
                  <input className="input" type="number" min="1" value={form.maxUserAccountsOverride} onChange={(e) => setValue('maxUserAccountsOverride', e.target.value)} placeholder="Use plan default" />
                </label>
                <label>
                  Max Active Users Override
                  <input className="input" type="number" min="1" value={form.maxActiveUsersOverride} onChange={(e) => setValue('maxActiveUsersOverride', e.target.value)} placeholder="Use plan default" />
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, color: '#64748b', fontSize: 13 }}>
              <span>Subscription status: {daysLeftLabel(form.subscriptionExpiresAt)}</span>
              <button className="btn" type="button" onClick={applyPlanDefaults}>Reset Features To Plan Default</button>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Feature Overrides</div>
              <div style={{ fontSize: 13, color: '#475569', marginBottom: 10 }}>
                Features now follow the sidebar structure. Turning on a section like Distribution or Warehouse brings in its submenu items and related approvals by default, and you can still remove any child item manually.
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                {sections.map((section) => {
                  const sectionKeys = Array.from(new Set([section.sectionKey, ...section.items.flatMap((item) => item.keys || [])].filter(Boolean)));
                  const sectionChecked = hasAll(sectionKeys);
                  return (
                  <div key={section.id} className="card" style={{ padding: 14, border: '1px solid #dbe3ee', background: '#ffffff', color: '#0f172a' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, color: '#0f172a' }}>
                      <input type="checkbox" checked={sectionChecked} onChange={(e) => toggleKeys(sectionKeys, e.target.checked)} />
                      <span>
                        <span style={{ display: 'block', fontWeight: 800, color: '#0f172a' }}>{section.title}</span>
                        <span style={{ display: 'block', color: '#64748b', fontSize: 12, marginTop: 4 }}>{section.description}</span>
                      </span>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                      {section.items.map((item) => (
                        <label key={`${section.id}:${item.label}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#0f172a', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 }}>
                          <input type="checkbox" checked={hasAll(item.keys || [])} onChange={(e) => toggleKeys(item.keys || [], e.target.checked)} />
                          <span style={{ color: '#0f172a' }}>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )})}
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default TenantsPage;
