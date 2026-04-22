import { useDispatch, useSelector } from 'react-redux';
import { useMemo, useState } from 'react';
import { addSupplier, updateSupplier, removeSupplier } from '../store/suppliersSlice';
import { useToast } from '../components/ToastProvider';
import { addAudit } from '../store/auditSlice';
import { confirmDialog } from '../utils/dialogs';
import * as suppliersApi from '../api/suppliers';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import InlineSpinner from '../components/InlineSpinner';
import { ensureSupplierByName, findSupplierByName, normalizeSupplierName } from '../utils/suppliers';

function SuppliersPage() {
  const suppliers = useSelector(s => s.suppliers.suppliers);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  function has(g) {
    if (!g) return false;
    if (roleLower === 'superadmin') return true;
    return grants.includes(g);
  }
  const canAddSuppliers = (['admin','manager'].includes(roleLower)) || has('add_suppliers');
  const canEditSuppliers = (['admin','manager'].includes(roleLower)) || has('edit_suppliers');
  const canRemoveSuppliers = (roleLower === 'admin' || roleLower === 'superadmin');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [edit, setEdit] = useState({ name: '', contact: '', phone: '', email: '', address: '', notes: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [removingId, setRemovingId] = useState('');
  const [savingCreate, setSavingCreate] = useState(false);
  const dispatch = useDispatch();
  const toast = useToast();
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.contact || '').toLowerCase().includes(q) ||
      (s.phone || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    );
  }, [suppliers, query]);
  const summary = useMemo(() => ({
    total: filtered.length,
    withContact: filtered.filter(s => String(s.contact || '').trim()).length,
    withPhone: filtered.filter(s => String(s.phone || '').trim()).length,
    withEmail: filtered.filter(s => String(s.email || '').trim()).length
  }), [filtered]);

  async function addNew() {
    if (!canAddSuppliers) { toast.show('Not authorized to add suppliers', { type: 'error' }); return; }
    const normalizedName = normalizeSupplierName(name);
    if (!normalizedName) { toast.show('Name is required', { type: 'error' }); return; }
    const existing = findSupplierByName(suppliers, normalizedName);
    if (existing) {
      toast.show('Supplier already exists', { type: 'warning' });
      return;
    }
    const payload = { name: normalizedName, contact: contact.trim(), phone: phone.trim(), email: email.trim(), address: address.trim(), notes: notes.trim() };
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) { toast.show('Offline: connect internet and try again.', { type: 'error' }); return; }
      const clientId = `offline-supplier-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      dispatch(addSupplier({ id: clientId, clientId, offline: true, ...payload }));
      dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'supplier_add', details: { id: clientId, name: payload.name }, offline: true }));
      try {
        await enqueueHttp({ collection: 'suppliers', label: 'Supplier', path: '/api/suppliers', method: 'POST', body: { ...payload, clientId } });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
        return;
      }
      setName(''); setContact(''); setPhone(''); setEmail(''); setAddress(''); setNotes('');
      toast.show('Saved offline. Will backup when online.', { type: 'success' });
      return;
    }
    try {
      setSavingCreate(true);
      const created = await ensureSupplierByName({
        name: payload.name,
        suppliers,
        dispatch,
        offlineBackupAllowed
      });
      dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'supplier_add', details: { id: created.id || created._id, name: created.name } }));
      setName(''); setContact(''); setPhone(''); setEmail(''); setAddress(''); setNotes('');
      toast.show('Supplier added', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to save supplier'), { type: 'error' });
    } finally {
      setSavingCreate(false);
    }
  }

  function startEdit(s) {
    if (!canEditSuppliers) { toast.show('Not authorized to edit suppliers', { type: 'error' }); return; }
    setEditingId(s.id);
    setEdit({ name: s.name || '', contact: s.contact || '', phone: s.phone || '', email: s.email || '', address: s.address || '', notes: s.notes || '' });
  }
  async function saveEdit() {
    if (!canEditSuppliers) { toast.show('Not authorized to edit suppliers', { type: 'error' }); return; }
    if (!editingId) return;
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) { toast.show('Offline: connect internet and try again.', { type: 'error' }); return; }
      dispatch(updateSupplier({ id: editingId, ...edit, offline: true }));
      dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'supplier_update', details: { id: editingId }, offline: true }));
      try {
        await enqueueHttp({ collection: 'suppliers', label: 'Supplier update', path: `/api/suppliers/${encodeURIComponent(editingId)}`, method: 'PUT', body: edit });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
        return;
      }
      setEditingId(null);
      toast.show('Saved offline. Will backup when online.', { type: 'success' });
      return;
    }
    try {
      setSavingEdit(true);
      const updated = await suppliersApi.update(editingId, edit);
      dispatch(updateSupplier({ id: editingId, ...(updated || edit), offline: false }));
      dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'supplier_update', details: { id: editingId } }));
      setEditingId(null);
      toast.show('Supplier updated', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update supplier'), { type: 'error' });
    } finally {
      setSavingEdit(false);
    }
  }
  async function remove(id) {
    if (!canRemoveSuppliers) { toast.show('Only Admin can remove suppliers', { type: 'error' }); return; }
    const ok = await confirmDialog('Remove this supplier?');
    if (!ok) return;
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) { toast.show('Offline: connect internet and try again.', { type: 'error' }); return; }
      dispatch(removeSupplier(id));
      dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'supplier_remove', details: { id }, offline: true }));
      try {
        await enqueueHttp({ collection: 'suppliers', label: 'Supplier delete', path: `/api/suppliers/${encodeURIComponent(id)}`, method: 'DELETE', body: {} });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
        return;
      }
      toast.show('Saved offline. Will backup when online.', { type: 'success' });
      return;
    }
    try {
      setRemovingId(String(id));
      await suppliersApi.remove(id);
      dispatch(removeSupplier(id));
      dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'supplier_remove', details: { id } }));
      toast.show('Supplier removed', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to remove supplier'), { type: 'error' });
    } finally {
      setRemovingId('');
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Suppliers</h1>
        <OfflineQueueIndicator collection="suppliers" label="Suppliers queued" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Suppliers</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.total}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>With Contact</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.withContact}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>With Phone</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.withPhone}</div></div>
        <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>With Email</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.withEmail}</div></div>
      </div>
      {canAddSuppliers && (
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          <input className="input" placeholder="Search suppliers" value={query} onChange={e => setQuery(e.target.value)} style={{ gridColumn: '1 / span 4' }} />
          <input className="input" placeholder="Name (required)" value={name} onChange={e => setName(e.target.value)} />
          <input className="input" placeholder="Contact person" value={contact} onChange={e => setContact(e.target.value)} />
          <input className="input" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
          <input className="input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="input" placeholder="Address" value={address} onChange={e => setAddress(e.target.value)} style={{ gridColumn: '1 / span 2' }} />
          <input className="input" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} style={{ gridColumn: '3 / span 2' }} />
          <div style={{ gridColumn: '1 / span 4' }}>
            <button className="btn btn-primary" onClick={addNew} disabled={savingCreate}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {savingCreate && <InlineSpinner />}
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
                {savingCreate ? 'Saving…' : 'Add Supplier'}
              </span>
            </button>
          </div>
        </div>
      </div>
      )}
      <div className="card">
        <h2 className="section-title">Supplier List</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th align="left">Name</th>
              <th align="left">Contact</th>
              <th align="left">Phone</th>
              <th align="left">Email</th>
              <th align="left">Address</th>
              <th align="left">Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td>
                  {editingId === s.id ? (
                    <input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
                  ) : s.name}
                </td>
                <td>
                  {editingId === s.id ? (
                    <input className="input" value={edit.contact} onChange={e => setEdit({ ...edit, contact: e.target.value })} />
                  ) : s.contact || '—'}
                </td>
                <td>
                  {editingId === s.id ? (
                    <input className="input" value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} />
                  ) : s.phone || '—'}
                </td>
                <td>
                  {editingId === s.id ? (
                    <input className="input" value={edit.email} onChange={e => setEdit({ ...edit, email: e.target.value })} />
                  ) : s.email || '—'}
                </td>
                <td>
                  {editingId === s.id ? (
                    <input className="input" value={edit.address} onChange={e => setEdit({ ...edit, address: e.target.value })} />
                  ) : s.address || '—'}
                </td>
                <td>
                  {editingId === s.id ? (
                    <input className="input" value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} />
                  ) : s.notes || '—'}
                </td>
                <td>
                  {editingId === s.id ? (
                    canEditSuppliers ? (
                      <>
                        <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {savingEdit && <InlineSpinner />}
                            {savingEdit ? 'Saving…' : 'Save'}
                          </span>
                        </button>
                        <button className="btn" onClick={() => setEditingId(null)} style={{ marginLeft: 6 }} disabled={savingEdit}>Cancel</button>
                      </>
                    ) : (
                      <button className="btn" onClick={() => setEditingId(null)}>Cancel</button>
                    )
                  ) : (
                    <>
                      {canEditSuppliers && <button className="btn" onClick={() => startEdit(s)}>Edit</button>}
                      {canRemoveSuppliers && <button className="btn" onClick={() => remove(s.id)} style={{ marginLeft: 6 }} disabled={removingId === String(s.id)}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {removingId === String(s.id) && <InlineSpinner />}
                          {removingId === String(s.id) ? 'Removing…' : 'Remove'}
                        </span>
                      </button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan="7" style={{ padding: 12, color: '#64748b' }}>No suppliers</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SuppliersPage;
