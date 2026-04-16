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
  subscriptionPermanent: false,
  subscriptionAmount: '',
  activationCode: '',
  activationCodeExpiresAt: '',
  renewalHistory: [],
  paymentHistory: [],
  billingEmail: '',
  billingPhone: '',
  billingAddress: '',
  billingCountry: 'GH',
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
  const [runningAudit, setRunningAudit] = useState(false);
  const [cleaningAuditKey, setCleaningAuditKey] = useState('');
  const [refreshingActivation, setRefreshingActivation] = useState(false);
  const [editing, setEditing] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [userAudit, setUserAudit] = useState({ scannedTenants: 0, duplicateCount: 0, duplicateUserNames: [] });
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
        subscriptionPermanent: !!form.subscriptionPermanent,
        subscriptionAmount: form.subscriptionAmount === '' ? null : Number(form.subscriptionAmount),
        billingEmail: form.billingEmail,
        billingPhone: form.billingPhone,
        billingAddress: form.billingAddress,
        billingCountry: form.billingCountry,
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
      subscriptionPermanent: !!row.subscriptionPermanent,
      subscriptionAmount: row.subscriptionAmount ?? '',
      activationCode: String(row.activationCode || ''),
      activationCodeExpiresAt: row.activationCodeExpiresAt ? String(row.activationCodeExpiresAt) : '',
      renewalHistory: Array.isArray(row.renewalHistory) ? row.renewalHistory : [],
      paymentHistory: Array.isArray(row.paymentHistory) ? row.paymentHistory : [],
      billingEmail: String(row.billingEmail || ''),
      billingPhone: String(row.billingPhone || ''),
      billingAddress: String(row.billingAddress || ''),
      billingCountry: String(row.billingCountry || 'GH'),
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

  async function runUserAudit() {
    if (runningAudit) return;
    setRunningAudit(true);
    try {
      const report = await tenantsApi.runUserAudit();
      setUserAudit({
        scannedTenants: Number(report?.scannedTenants || 0),
        duplicateCount: Number(report?.duplicateCount || 0),
        duplicateUserNames: Array.isArray(report?.duplicateUserNames) ? report.duplicateUserNames : []
      });
      toast.show('Tenant user audit completed', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to run tenant user audit'), { type: 'error' });
    } finally {
      setRunningAudit(false);
    }
  }

  async function cleanupAuditOccurrence(tenantId, userName) {
    const key = `${tenantId}:${userName}`;
    if (cleaningAuditKey) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Remove user ${userName} from tenant ${tenantId}?`);
    if (!ok) return;
    setCleaningAuditKey(key);
    try {
      await tenantsApi.cleanupUserAuditRecord({ tenantId, userName });
      setUserAudit((prev) => {
        const nextGroups = (prev.duplicateUserNames || [])
          .map((group) => ({
            ...group,
            occurrences: (group.occurrences || []).filter((occ) => !(String(occ.tenantId) === String(tenantId) && String(group.userName) === String(userName)))
          }))
          .filter((group) => (group.occurrences || []).length > 1);
        return {
          ...prev,
          duplicateUserNames: nextGroups,
          duplicateCount: nextGroups.length
        };
      });
      toast.show(`Removed ${userName} from ${tenantId}`, { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to clean audit record'), { type: 'error' });
    } finally {
      setCleaningAuditKey('');
    }
  }

  async function refreshActivationCodeForCurrentTenant() {
    if (!editing || refreshingActivation) return;
    setRefreshingActivation(true);
    try {
      const updated = await tenantsApi.refreshActivationCode(editing);
      setForm((prev) => ({
        ...prev,
        activationCode: String(updated?.activationCode || ''),
        activationCodeExpiresAt: updated?.activationCodeExpiresAt ? String(updated.activationCodeExpiresAt) : ''
      }));
      setRows((prev) => prev.map((row) => String(row.tenantId) === String(editing) ? { ...row, ...updated } : row));
      toast.show('Activation code refreshed', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to refresh activation code'), { type: 'error' });
    } finally {
      setRefreshingActivation(false);
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
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div>
            <h2 className="section-title">Tenant User Audit</h2>
            <div style={{ color: '#64748b' }}>
              Scans all tenant databases for suspicious duplicate usernames that appear in more than one tenant.
            </div>
          </div>
          <button className="btn btn-primary" type="button" onClick={runUserAudit} disabled={runningAudit}>
            {runningAudit ? 'Scanning…' : 'Run User Audit'}
          </button>
        </div>
        <div style={{ color: '#475569', marginBottom: 10 }}>
          Scanned tenants: {userAudit.scannedTenants} • Duplicate usernames found: {userAudit.duplicateCount}
        </div>
        {(userAudit.duplicateUserNames || []).length === 0 ? (
          <div style={{ color: '#64748b' }}>No suspicious cross-tenant duplicate usernames found.</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {(userAudit.duplicateUserNames || []).map((group) => (
              <div key={group.userName} className="card" style={{ padding: 14, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{group.userName}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      Suggested owner tenant: {group.suggestedOwnerTenantId || 'Unknown'}
                    </div>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{(group.occurrences || []).length} tenant(s)</div>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {(group.occurrences || []).map((occ) => {
                    const key = `${occ.tenantId}:${group.userName}`;
                    const protectedOwner = group.suggestedOwnerTenantId && String(group.suggestedOwnerTenantId) === String(occ.tenantId);
                    return (
                      <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{occ.tenantId}</div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>Role: {occ.role || 'Unknown'}</div>
                        </div>
                        <button className="btn" type="button" disabled={protectedOwner || cleaningAuditKey === key} onClick={() => cleanupAuditOccurrence(occ.tenantId, group.userName)}>
                          {protectedOwner ? 'Suggested Owner' : cleaningAuditKey === key ? 'Removing…' : 'Remove From Tenant'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
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
              <label>
                Billing Email
                <input className="input" type="email" value={form.billingEmail} onChange={(e) => setValue('billingEmail', e.target.value)} />
              </label>
              <label>
                Billing Phone
                <input className="input" value={form.billingPhone} onChange={(e) => setValue('billingPhone', e.target.value)} />
              </label>
              <label>
                Billing Country
                <select className="input" value={form.billingCountry} onChange={(e) => setValue('billingCountry', e.target.value)}>
                  <option value="GH">Ghana</option>
                  <option value="ZM">Zambia</option>
                  <option value="MW">Malawi</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <label>
                Billing Address
                <input className="input" value={form.billingAddress} onChange={(e) => setValue('billingAddress', e.target.value)} />
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
                <input className="input" type="date" value={form.subscriptionExpiresAt || ''} onChange={(e) => setValue('subscriptionExpiresAt', e.target.value)} disabled={!!form.subscriptionPermanent} />
              </label>
              <label>
                Subscription Amount
                <input className="input" type="number" min="0" step="0.01" value={form.subscriptionAmount} onChange={(e) => setValue('subscriptionAmount', e.target.value)} placeholder="Optional amount" />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24 }}>
                <input type="checkbox" checked={!!form.subscriptionPermanent} onChange={(e) => setValue('subscriptionPermanent', e.target.checked)} />
                <span>Permanent Subscription</span>
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
              <span>Subscription status: {form.subscriptionPermanent ? 'Permanent access enabled' : daysLeftLabel(form.subscriptionExpiresAt)}</span>
              <button className="btn" type="button" onClick={applyPlanDefaults}>Reset Features To Plan Default</button>
            </div>
            {editing && (
              <div className="card" style={{ padding: 14, border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>Tenant Activation Code</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>Only superadmin can view and refresh this code. Share it with the tenant after payment.</div>
                  </div>
                  <button className="btn" type="button" onClick={refreshActivationCodeForCurrentTenant} disabled={refreshingActivation}>
                    {refreshingActivation ? 'Refreshing…' : 'Refresh Code'}
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label>
                    Subscription Amount
                    <input className="input" value={form.subscriptionAmount === '' ? '' : String(form.subscriptionAmount)} readOnly />
                  </label>
                  <label>
                    Current Activation Code
                    <input className="input" value={form.activationCode || ''} readOnly />
                  </label>
                  <label>
                    Code Expires At
                    <input className="input" value={form.activationCodeExpiresAt ? new Date(form.activationCodeExpiresAt).toLocaleString() : ''} readOnly />
                  </label>
                </div>
              </div>
            )}
            {editing && (
              <div className="card" style={{ padding: 14, border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a' }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Payment Records</div>
                {(form.paymentHistory || []).length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 13 }}>No payment records yet. Records will appear here after live payment checkout is configured and used.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 240, overflow: 'auto' }}>
                    {(form.paymentHistory || []).slice().reverse().map((entry, index) => (
                      <div key={`${entry.transactionRef || index}:${index}`} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, background: '#f8fafc' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700 }}>{entry.provider || 'payment'} • {entry.method || 'method'}</span>
                          <span style={{ color: '#64748b', fontSize: 12 }}>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}</span>
                        </div>
                        <div style={{ color: '#475569', fontSize: 12 }}>
                          Status: {entry.status || 'unknown'} • Amount: {entry.amount == null ? 'Not set' : Number(entry.amount).toLocaleString()} {entry.currencyCode || ''}
                          {' • '}
                          Months: {entry.months || '-'}
                          {entry.network ? ` • Network: ${entry.network}` : ''}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>
                          Ref: {entry.transactionRef || '-'} • Provider Txn: {entry.providerTransactionId || '-'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {editing && (
              <div className="card" style={{ padding: 14, border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a' }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Renewal History</div>
                {(form.renewalHistory || []).length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 13 }}>No renewal history yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflow: 'auto' }}>
                    {(form.renewalHistory || []).slice().reverse().map((entry, index) => (
                      <div key={`${entry.createdAt || index}:${index}`} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, background: '#f8fafc' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700 }}>{String(entry.source || 'renewal').replace(/_/g, ' ')}</span>
                          <span style={{ color: '#64748b', fontSize: 12 }}>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}</span>
                        </div>
                        <div style={{ color: '#475569', fontSize: 12 }}>
                          Amount: {entry.amount == null ? 'Not set' : Number(entry.amount).toLocaleString()}
                          {' • '}
                          Previous Expiry: {entry.previousExpiry ? new Date(entry.previousExpiry).toLocaleString() : 'None'}
                          {' • '}
                          New Expiry: {entry.newExpiry ? new Date(entry.newExpiry).toLocaleString() : (entry.permanentAfter ? 'Permanent' : 'None')}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>
                          Actor: {entry.actorName || 'System'} • Note: {entry.note || 'Subscription updated'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
