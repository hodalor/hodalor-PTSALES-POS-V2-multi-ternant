import { useDispatch, useSelector } from 'react-redux';
import { addUser, removeUser, updateUser, setUsers } from '../store/usersSlice';
import { addAudit } from '../store/auditSlice';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import { promptDialog } from '../utils/dialogs';
import * as settingsApi from '../api/settings';
import * as usersApi from '../api/users';
import { setAllSettings } from '../store/settingsSlice';
import { setGrants as setAuthGrants } from '../store/authSlice';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import InlineSpinner from '../components/InlineSpinner';
import { TENANT_GRANT_CATALOG, filterGrantsByTenantFlags } from '../utils/tenantAccess';

const ALL_GRANTS = TENANT_GRANT_CATALOG;
const ALL_GRANTS_KEYS = ALL_GRANTS.map(g => g.key);
const AUDIT_GRANT_KEYS = new Set(['view_audit', 'see_audit']);

function stripAuditGrants(list = []) {
  return (Array.isArray(list) ? list : []).filter(k => !AUDIT_GRANT_KEYS.has(String(k)));
}

function UsersPage() {
  const dispatch = useDispatch();
  const roles = useSelector(s => s.users.roles);
  const branches = useSelector(s => s.branches.branches);
  const users = useSelector(s => s.users.users);
  const auth = useSelector(s => s.auth);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const defaultRoles = ['SuperAdmin','Admin','Branch Manager','Manager','Cashier','Inventory Staff','Auditor','Other'];
  const baseRolesForUi = Array.from(new Set([...(roles || []), ...defaultRoles]));
  const viewerRole = String(auth.role || '');
  const rolesForUi = (viewerRole === 'Admin') ? baseRolesForUi.filter(r => r !== 'SuperAdmin') : baseRolesForUi;
  const [role, setRole] = useState(rolesForUi[0] || 'Admin');
  const [branchId, setBranchId] = useState(branches[0]?.id || 'main');
  const [allBranches, setAllBranches] = useState(false);
  const [selectedBranches, setSelectedBranches] = useState([]);
  const [remark, setRemark] = useState('');
  const branchOptions = useMemo(() => branches || [], [branches]);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('Cashier');
  const [editPin, setEditPin] = useState('');
  const [editAllBranches, setEditAllBranches] = useState(false);
  const [editSelectedBranches, setEditSelectedBranches] = useState([]);
  const [editBranchId, setEditBranchId] = useState(branches[0]?.id || 'main');
  const [editActive, setEditActive] = useState(true);
  const [editRemark, setEditRemark] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [workingUserName, setWorkingUserName] = useState('');
  const isSuper = String(auth.role || '').toLowerCase() === 'superadmin';
  const superAdminsCount = users.filter(u => u.role === 'SuperAdmin' && u.active !== false).length;
  const toast = useToast();
  const [editGrants, setEditGrants] = useState([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!auth.isAuthenticated) return;
      try {
        const rows = await usersApi.list();
        if (alive && Array.isArray(rows)) dispatch(setUsers(rows));
      } catch {}
    })();
    return () => { alive = false; };
  }, [dispatch, auth.isAuthenticated, auth.user?.tenantId]);

  const settings = useSelector(s => s.settings);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const existingGrants = settings?.userGrants || {};
  const [grants, setGrants] = useState([]);
  const canManageAuditGrant = isSuper;
  const grantOptions = useMemo(() => {
    const scoped = ALL_GRANTS.filter((item) => filterGrantsByTenantFlags([item.key], settings).includes(item.key));
    return canManageAuditGrant ? scoped : scoped.filter(g => !AUDIT_GRANT_KEYS.has(String(g.key)));
  }, [canManageAuditGrant, settings]);
  const allGrantKeys = useMemo(() => filterGrantsByTenantFlags(ALL_GRANTS_KEYS, settings), [settings]);
  const defaultsForRole = useCallback((r) => {
    const rl = String(r || '').toLowerCase();
    if (rl === 'superadmin') return allGrantKeys.slice();
    if (rl === 'admin') return [
      'view_dashboard','view_pos','view_wholesale_pos','view_retail_price','view_wholesale_price','view_agent_price','view_sales','add_sales','view_products','add_products','edit_products','view_inventory','edit_inventory','view_serialized_inventory','view_labels','view_purchases','add_purchases','edit_purchases','approve_purchases','view_transfers','add_transfers','edit_transfers','approve_transfers','view_adjustments','add_adjustments','edit_adjustments','approve_adjustments','view_suppliers','add_suppliers','edit_suppliers','view_customers','add_customers','edit_customers','view_credit_control','approve_credit_director','approve_credit_manager','view_credit_repayment_approvals','view_approvals','approve_wholesale_director','approve_wholesale_manager','view_refunds','approve_refunds','add_refunds','view_expenses','add_expenses','approve_expenses','view_reports','view_stock_records','view_wholesale_invoices','view_warehouse_invoices','view_warehouse_approvals','view_imei_conflicts','view_cashdrawer','view_users','view_config'
    ];
    if (rl === 'manager' || rl === 'branch manager') return [
      'view_dashboard','view_pos','view_wholesale_pos','view_retail_price','view_wholesale_price','view_agent_price','view_sales','add_sales','view_products','add_products','edit_products','view_inventory','edit_inventory','view_serialized_inventory','view_labels','view_purchases','add_purchases','edit_purchases','approve_purchases','view_transfers','add_transfers','edit_transfers','approve_transfers','view_adjustments','add_adjustments','edit_adjustments','approve_adjustments','view_suppliers','add_suppliers','edit_suppliers','view_customers','add_customers','edit_customers','view_credit_control','approve_credit_manager','view_credit_repayment_approvals','view_approvals','approve_wholesale_manager','view_refunds','approve_refunds','add_refunds','view_expenses','add_expenses','approve_expenses','view_reports','view_wholesale_invoices','view_warehouse_invoices','view_warehouse_approvals','view_imei_conflicts','view_cashdrawer','view_config'
    ];
    if (rl === 'cashier') return ['view_pos','view_wholesale_pos','view_retail_price','view_wholesale_price','view_agent_price','view_sales','add_sales','view_customers','view_credit_control','view_refunds','add_refunds','view_wholesale_invoices','view_warehouse_invoices','view_cashdrawer'];
    if (rl === 'inventory staff') return ['view_retail_price','view_wholesale_price','view_agent_price','view_products','view_inventory','view_serialized_inventory','edit_inventory','view_labels','view_purchases','add_purchases','view_transfers','add_transfers','view_adjustments','add_adjustments','view_suppliers','view_wholesale_pos'];
    if (rl === 'auditor') return ['view_reports'];
    return [];
  }, [allGrantKeys]);
  // auto-apply defaults when role is selected on Create User
  useEffect(() => {
    const next = defaultsForRole(role);
    setGrants(canManageAuditGrant ? filterGrantsByTenantFlags(next, settings) : stripAuditGrants(filterGrantsByTenantFlags(next, settings)));
  }, [role, defaultsForRole, canManageAuditGrant, settings]);
  // if editing role changed to SuperAdmin, ensure all grants are checked
  useEffect(() => {
    if (String(editRole || '').toLowerCase() === 'superadmin') {
      setEditGrants(allGrantKeys.slice());
    }
  }, [editRole, allGrantKeys]);
  function canRemoveUser(u) {
    if (isSuper) {
      if (u.role === 'SuperAdmin') return superAdminsCount > 1;
      return true;
    }
    return u.name !== 'superadmin';
  }

  async function add() {
    const canCreate = ['Admin','SuperAdmin'].includes(viewerRole);
    if (!canCreate) {
      toast.show('Not authorized to create users', { type: 'error' });
      return;
    }
    const cleanName = name.trim();
    const cleanPin = pin.trim();
    if (!cleanName || !cleanPin) return;
    if (!/^\d{4,6}$/.test(cleanPin)) {
      toast.show('PIN must be 4-6 digits', { type: 'error' });
      return;
    }
    if (!remark.trim()) {
      toast.show('Please enter a remark for audit logging', { type: 'error' });
      return;
    }
    const forceAll = role === 'SuperAdmin' || role === 'Admin';
    const safeCreateGrants = canManageAuditGrant ? filterGrantsByTenantFlags(grants, settings) : stripAuditGrants(filterGrantsByTenantFlags(grants, settings));
    const assigned = forceAll || allBranches ? 'all' : (selectedBranches.length > 0 ? selectedBranches : [branchId]);
    const primaryBranch = allBranches ? 'main' : (assigned[0] || 'main');
    if (viewerRole === 'Admin' && role === 'SuperAdmin') {
      toast.show('Admins cannot create SuperAdmin', { type: 'error' });
      return;
    }
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        return;
      }
      dispatch(addUser({ id: cleanName, name: cleanName, role, branchId: primaryBranch, assignedBranches: assigned, offline: true }));
      try {
        await enqueueHttp({ collection: 'users', label: 'User', path: '/api/users', method: 'POST', body: { name: cleanName, role, pin: cleanPin, branchId: primaryBranch, assignedBranches: assigned } });
        const next = { ...(settings || {}), userGrants: { ...(existingGrants || {}), [cleanName]: safeCreateGrants } };
        await enqueueHttp({ collection: 'settings', label: 'User grants', path: '/api/settings', method: 'PUT', body: next });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
        return;
      }
      dispatch(addAudit({
        actor: auth.user?.name || 'unknown',
        actionType: 'user_create',
        details: { name: cleanName, role, branches: allBranches ? 'all' : assigned },
        remark,
        offline: true
      }));
      setName('');
      setPin('');
      setRemark('');
      setAllBranches(false);
      setSelectedBranches([]);
      toast.show('Saved offline. Will backup when online.', { type: 'success' });
      return;
    }
    try {
      await usersApi.create({ name: cleanName, role, pin: cleanPin, branchId: primaryBranch, assignedBranches: assigned });
      const next = { ...(settings || {}), userGrants: { ...(existingGrants || {}), [cleanName]: safeCreateGrants } };
      const saved = await settingsApi.save(next);
      dispatch(setAllSettings(saved));
      if ((auth.user?.name || '') === cleanName) {
        dispatch(setAuthGrants(saved?.userGrants?.[cleanName] || []));
      }
      const latest = await usersApi.list().catch(() => null);
      if (Array.isArray(latest)) dispatch(setUsers(latest));
    } catch (e) {
      toast.show(String(e?.message || 'Failed to save user to server'), { type: 'error' });
      return;
    }
    dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: 'user_create',
      details: { name: cleanName, role, branches: allBranches ? 'all' : assigned },
      remark
    }));
    setName('');
    setPin('');
    setRemark('');
    setAllBranches(false);
    setSelectedBranches([]);
  }

  function startEdit(u) {
    if (viewerRole === 'Admin' && String(u.role) === 'SuperAdmin') {
      toast.show('Admins cannot edit SuperAdmin', { type: 'error' });
      return;
    }
    setEditingId(u.id);
    setEditName(u.name);
    setEditRole(u.role);
    setEditPin('');
    const all = u.role === 'SuperAdmin' || u.role === 'Admin' || u.assignedBranches === 'all';
    setEditAllBranches(all);
    setEditSelectedBranches(Array.isArray(u.assignedBranches) ? u.assignedBranches : (u.branchId ? [u.branchId] : []));
    setEditBranchId(u.branchId || branches[0]?.id || 'main');
    setEditActive(u.active !== false);
    setEditRemark('');
    const g = filterGrantsByTenantFlags(existingGrants?.[u.name] || [], settings);
    setEditGrants(canManageAuditGrant ? (Array.isArray(g) ? g : []) : stripAuditGrants(g));
  }

  async function saveEdit() {
    if (!editingId) return;
    const target = users.find(u => u.id === editingId);
    if (viewerRole !== 'Admin' && viewerRole !== 'SuperAdmin') {
      toast.show('Not authorized to edit users', { type: 'error' });
      return;
    }
    if (viewerRole === 'Admin' && target && target.role === 'SuperAdmin') {
      toast.show('Admins cannot edit SuperAdmin', { type: 'error' });
      return;
    }
    const fields = { id: editingId, name: editName.trim(), role: editRole, active: !!editActive };
    const p = editPin.trim();
    if (p) {
      if (!/^\d{4,6}$/.test(p)) {
        toast.show('PIN must be 4-6 digits', { type: 'error' });
        return;
      }
      fields.pin = p;
    }
    if (target && target.role === 'SuperAdmin' && editRole !== 'SuperAdmin' && superAdminsCount <= 1) {
      toast.show('At least one SuperAdmin must remain', { type: 'error' });
      return;
    }
    if (target && target.role === 'SuperAdmin' && fields.active === false && superAdminsCount <= 1) {
      toast.show('Cannot disable the last SuperAdmin', { type: 'error' });
      return;
    }
    const forceAll = editRole === 'SuperAdmin' || editRole === 'Admin';
    if (forceAll || editAllBranches) {
      fields.assignedBranches = 'all';
      fields.branchId = 'main';
    } else {
      const assigned = editSelectedBranches.length > 0 ? editSelectedBranches : [editBranchId];
      fields.assignedBranches = assigned;
      fields.branchId = assigned[0] || editBranchId;
    }
    if (!editRemark.trim()) {
      toast.show('Please enter a remark for audit logging', { type: 'error' });
      return;
    }
    const prevName = target?.name || editName;
    const payload = { name: fields.name, role: fields.role, active: fields.active, branchId: fields.branchId, assignedBranches: fields.assignedBranches };
    const safeEditGrants = canManageAuditGrant ? filterGrantsByTenantFlags(editGrants, settings) : stripAuditGrants(filterGrantsByTenantFlags(editGrants, settings));
    if (fields.pin) payload.pin = fields.pin;
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        return;
      }
      dispatch(updateUser({ ...fields, offline: true }));
      try {
        await enqueueHttp({ collection: 'users', label: 'User update', path: `/api/users/${encodeURIComponent(prevName)}`, method: 'PUT', body: payload });
        const map = { ...(existingGrants || {}) };
        if (target && target.name && target.name !== editName) {
          delete map[target.name];
        }
        map[editName] = safeEditGrants;
        const next = { ...(settings || {}), userGrants: map };
        await enqueueHttp({ collection: 'settings', label: 'User grants', path: '/api/settings', method: 'PUT', body: next });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
        return;
      }
      dispatch(addAudit({
        actor: auth.user?.name || 'unknown',
        actionType: 'user_update',
        details: { id: editingId, role: fields.role, active: fields.active, branches: fields.assignedBranches },
        remark: editRemark,
        offline: true
      }));
      setEditingId(null);
      toast.show('Saved offline. Will backup when online.', { type: 'success' });
      return;
    }
    try {
      setSavingEdit(true);
      await usersApi.update(prevName, payload);
      const map = { ...(existingGrants || {}) };
      if (target && target.name && target.name !== editName) {
        delete map[target.name];
      }
      map[editName] = safeEditGrants;
      const saved = await settingsApi.save({ userGrants: map });
      dispatch(setAllSettings(saved));
      dispatch(updateUser({
        id: editingId,
        name: fields.name,
        role: fields.role,
        branchId: fields.branchId,
        assignedBranches: fields.assignedBranches,
        active: fields.active
      }));
      if ((auth.user?.name || '') === editName) {
        dispatch(setAuthGrants(saved?.userGrants?.[editName] || []));
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update user on server'), { type: 'error' });
      return;
    } finally {
      setSavingEdit(false);
    }
    dispatch(addAudit({
      actor: auth.user?.name || 'unknown',
      actionType: 'user_update',
      details: { id: editingId, role: fields.role, active: fields.active, branches: fields.assignedBranches },
      remark: editRemark
    }));
    setEditingId(null);
  }

  async function toggleActive(u, active) {
    if (viewerRole !== 'Admin' && viewerRole !== 'SuperAdmin') {
      toast.show('Not authorized', { type: 'error' });
      return;
    }
    if (viewerRole === 'Admin' && String(u.role) === 'SuperAdmin') {
      toast.show('Admins cannot modify SuperAdmin', { type: 'error' });
      return;
    }
    const r = await promptDialog(active ? 'Remark for enabling user' : 'Remark for disabling user');
    if (!r || !r.trim()) return;
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        return;
      }
      dispatch(updateUser({ id: u.id, active, offline: true }));
      dispatch(addAudit({
        actor: auth.user?.name || 'unknown',
        actionType: 'user_status',
        details: { id: u.id, name: u.name, active },
        remark: r,
        offline: true
      }));
      try {
        await enqueueHttp({ collection: 'users', label: 'User status', path: `/api/users/${encodeURIComponent(u.name)}`, method: 'PUT', body: { active } });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
        return;
      }
      toast.show('Saved offline. Will backup when online.', { type: 'success' });
      return;
    }
    try {
      setWorkingUserName(String(u.name || ''));
      await usersApi.update(u.name, { active });
      dispatch(updateUser({ id: u.id, active }));
      dispatch(addAudit({
        actor: auth.user?.name || 'unknown',
        actionType: 'user_status',
        details: { id: u.id, name: u.name, active },
        remark: r
      }));
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update status on server'), { type: 'error' });
    } finally {
      setWorkingUserName('');
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Users</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <OfflineQueueIndicator collection="users" label="Users queued" />
          <OfflineQueueIndicator collection="settings" label="Settings queued" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16 }}>
          <h2>Create User</h2>
          <input placeholder="username" value={name} onChange={e => setName(e.target.value)} style={{ display: 'block', width: '100%', padding: 10, marginBottom: 8 }} />
          <input placeholder="PIN (4-6 digits)" type="password" value={pin} onChange={e => setPin(e.target.value)} style={{ display: 'block', width: '100%', padding: 10, marginBottom: 8 }} />
          <select value={role} onChange={e => setRole(e.target.value)} style={{ display: 'block', width: '100%', padding: 10, marginBottom: 8 }}>
            {rolesForUi.map(r => <option key={r}>{r}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input type="checkbox" checked={(role==='SuperAdmin'||role==='Admin') ? true : allBranches} onChange={e => setAllBranches(e.target.checked)} disabled={role==='SuperAdmin'||role==='Admin'} />
            <span>Assign to all branches{(role==='SuperAdmin'||role==='Admin') ? ' (forced)' : ''}</span>
          </label>
          {!((role==='SuperAdmin'||role==='Admin') ? true : allBranches) && (
            <>
              <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ display: 'block', width: '100%', padding: 10, marginBottom: 8 }}>
                {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Assign additional branches</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {branchOptions.map(b => (
                    <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={selectedBranches.includes(b.id) || b.id === branchId}
                        onChange={e => {
                          const checked = e.target.checked;
                          setSelectedBranches(prev => {
                            const set = new Set(prev);
                            if (checked) set.add(b.id); else set.delete(b.id);
                            // ensure primary branch is included
                            set.add(branchId);
                            return Array.from(set);
                          });
                        }}
                      />
                      <span>{b.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Feature Access</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {grantOptions.map(g => (
                <label key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={grants.includes(g.key)}
                    onChange={e => {
                      const checked = e.target.checked;
                      setGrants(prev => {
                        const set = new Set(prev);
                        if (checked) set.add(g.key); else set.delete(g.key);
                        return Array.from(set);
                      });
                    }}
                  />
                  <span>{g.label}</span>
                </label>
              ))}
            </div>
          </div>
          <input placeholder="Remark (required)" value={remark} onChange={e => setRemark(e.target.value)} style={{ display: 'block', width: '100%', padding: 10, marginBottom: 8 }} />
          <button onClick={add}>Add User</button>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 16 }}>
          <h2>Existing Users</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Role</th>
                <th align="left">Branch Access</th>
                <th align="left">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(isSuper ? users : users.filter(u => u.role !== 'SuperAdmin')).map(u => {
                const access = (u.role === 'SuperAdmin' || u.role === 'Admin' || u.assignedBranches === 'all') ? 'All branches'
                  : (Array.isArray(u.assignedBranches) ? `${u.assignedBranches.length} branches` : (u.branchId || '—'));
                const active = u.active !== false;
                return (
                  <tr key={u.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td>{u.name}</td>
                    <td>{u.role}</td>
                    <td>{access}</td>
                    <td>{active ? 'Active' : 'Disabled'}</td>
                    <td style={{ display: 'flex', gap: 8 }}>
                      <button className="btn" onClick={() => startEdit(u)} disabled={!isSuper && u.role === 'SuperAdmin'}>Edit</button>
                      {(isSuper || u.name !== 'superadmin') && (
                        active
                          ? <button className="btn" onClick={() => toggleActive(u, false)} disabled={workingUserName === String(u.name || '')}>{workingUserName === String(u.name || '') ? 'Working…' : 'Disable'}</button>
                          : <button className="btn" onClick={() => toggleActive(u, true)} disabled={workingUserName === String(u.name || '')}>{workingUserName === String(u.name || '') ? 'Working…' : 'Enable'}</button>
                      )}
                      <button
                        className="btn"
                        onClick={() => {
                          if (!canRemoveUser(u)) {
                            toast.show('Cannot remove the last SuperAdmin', { type: 'error' });
                            return;
                          }
                          (async () => {
                            const r = await promptDialog('Remark for removing user');
                            if (!r || !r.trim()) return;
                            if (!navigator.onLine) {
                              if (!offlineBackupAllowed) {
                                toast.show('Offline: connect internet and try again.', { type: 'error' });
                                return;
                              }
                              dispatch(removeUser(u.id));
                              dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'user_remove', details: { id: u.id, name: u.name }, remark: r, offline: true }));
                              try {
                                await enqueueHttp({ collection: 'users', label: 'User delete', path: `/api/users/${encodeURIComponent(u.name)}`, method: 'DELETE', body: {} });
                                const map = { ...(existingGrants || {}) };
                                delete map[u.name];
                                const next = { ...(settings || {}), userGrants: map };
                                await enqueueHttp({ collection: 'settings', label: 'User grants', path: '/api/settings', method: 'PUT', body: next });
                              } catch {
                                toast.show('Failed to save offline', { type: 'error' });
                                return;
                              }
                              toast.show('Saved offline. Will backup when online.', { type: 'success' });
                              return;
                            }
                            try {
                              setWorkingUserName(String(u.name || ''));
                              await usersApi.remove(u.name);
                              dispatch(removeUser(u.id));
                              const map = { ...(existingGrants || {}) };
                              delete map[u.name];
                              const saved = await settingsApi.save({ userGrants: map });
                              dispatch(setAllSettings(saved));
                              dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'user_remove', details: { id: u.id, name: u.name }, remark: r }));
                            } catch {
                              toast.show('Failed to remove user on server', { type: 'error' });
                            } finally {
                              setWorkingUserName('');
                            }
                          })();
                        }}
                        disabled={!canRemoveUser(u) || workingUserName === String(u.name || '')}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {workingUserName === String(u.name || '') && <InlineSpinner />}
                          {workingUserName === String(u.name || '') ? 'Working…' : 'Remove'}
                        </span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editingId && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
            <div style={{ width: 'min(960px, 100%)', maxHeight: 'calc(100vh - 32px)', background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 10px 25px rgba(0,0,0,0.2)', overflowY: 'auto', margin: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>Edit User</h2>
                <button className="btn" onClick={() => setEditingId(null)}>Close</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
              <div>
                <label>Name</label>
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 8 }} />
                <label>Role</label>
                <select className="select" value={editRole} onChange={e => { const nextRole = e.target.value; setEditRole(nextRole); const next = defaultsForRole(nextRole); setEditGrants(canManageAuditGrant ? next : stripAuditGrants(next)); }} style={{ display: 'block', width: '100%', marginBottom: 8 }}>
                  {rolesForUi.map(r => <option key={r}>{r}</option>)}
                </select>
                <label>New PIN (leave blank to keep)</label>
                <input className="input" type="password" value={editPin} onChange={e => setEditPin(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 8 }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input type="checkbox" checked={(editRole==='SuperAdmin'||editRole==='Admin') ? true : editAllBranches} onChange={e => setEditAllBranches(e.target.checked)} disabled={editRole==='SuperAdmin'||editRole==='Admin'} />
                  <span>Assign to all branches{(editRole==='SuperAdmin'||editRole==='Admin') ? ' (forced)' : ''}</span>
                </label>
                {!((editRole==='SuperAdmin'||editRole==='Admin') ? true : editAllBranches) && (
                  <>
                    <select className="select" value={editBranchId} onChange={e => setEditBranchId(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 8 }}>
                      {branchOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Assign additional branches</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        {branchOptions.map(b => (
                          <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={editSelectedBranches.includes(b.id) || b.id === editBranchId}
                              onChange={e => {
                                const checked = e.target.checked;
                                setEditSelectedBranches(prev => {
                                  const set = new Set(prev);
                                  if (checked) set.add(b.id); else set.delete(b.id);
                                  set.add(editBranchId);
                                  return Array.from(set);
                                });
                              }}
                            />
                            <span>{b.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div>
                <label>Status</label>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={editActive}
                      onChange={e => setEditActive(e.target.checked)}
                    />
                    <span>Active</span>
                  </label>
                </div>
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Feature Access</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, maxHeight: '50vh', overflowY: 'auto', paddingRight: 4 }}>
                    {grantOptions.map(g => (
                      <label key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={editGrants.includes(g.key)}
                          onChange={e => {
                            const checked = e.target.checked;
                            setEditGrants(prev => {
                              const set = new Set(prev);
                              if (checked) set.add(g.key); else set.delete(g.key);
                              return Array.from(set);
                            });
                          }}
                        />
                        <span>{g.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <label>Remark (required)</label>
                <input className="input" value={editRemark} onChange={e => setEditRemark(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 8 }} />
                <div>
                  <button className="btn btn-primary" onClick={saveEdit} style={{ marginRight: 8 }} disabled={savingEdit}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {savingEdit && <InlineSpinner />}
                      {savingEdit ? 'Saving…' : 'Save'}
                    </span>
                  </button>
                  <button className="btn" onClick={() => setEditingId(null)} disabled={savingEdit}>Cancel</button>
                </div>
              </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UsersPage;
