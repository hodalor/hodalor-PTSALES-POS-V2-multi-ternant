import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useToast } from '../components/ToastProvider';
import * as superBinApi from '../api/superBin';
import { confirmDialog } from '../utils/dialogs';

const ENTITY_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'product', label: 'Products' },
  { value: 'customer', label: 'Customers' },
  { value: 'user', label: 'Users' },
  { value: 'sale', label: 'Sales' },
  { value: 'credit_sale', label: 'Credit Sales' },
  { value: 'credit_repayment', label: 'Credit Repayments' },
  { value: 'branch', label: 'Branches' },
  { value: 'supplier', label: 'Suppliers' },
  { value: 'expense', label: 'Expenses' },
  { value: 'wholesale_operation', label: 'Wholesale Requests' },
  { value: 'product_unit', label: 'Serialized Units' },
  { value: 'audit', label: 'Audit Logs' },
  { value: 'server_log', label: 'Server Logs' },
  { value: 'reconciliation_account', label: 'Reconciliation Accounts' },
  { value: 'tenant', label: 'Tenants' }
];

function formatWhen(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function SuperBinPage() {
  const toast = useToast();
  const auth = useSelector((s) => s.auth);
  const isMasterSuper = String(auth.role || '').toLowerCase() === 'superadmin'
    && String(auth.user?.tenantId || '').toLowerCase() === 'master';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [entityType, setEntityType] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await superBinApi.list({
        q: search.trim(),
        entityType,
        tenantId: isMasterSuper ? tenantFilter.trim() : '',
        limit: 500
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load Super Bin'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [entityType, isMasterSuper, search, tenantFilter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => rows.some((row) => row.id === id)));
  }, [rows]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.id));
  const uniqueTenants = useMemo(
    () => Array.from(new Set(rows.map((row) => String(row.tenantId || '').trim()).filter(Boolean))).sort(),
    [rows]
  );

  function toggleOne(id) {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]
    ));
  }

  function toggleAll() {
    if (allVisibleSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(rows.map((row) => row.id));
  }

  async function runRestore() {
    if (selectedIds.length === 0) return;
    const ok = await confirmDialog(`Restore ${selectedIds.length} selected item(s)?`);
    if (!ok) return;
    setWorking(true);
    try {
      const result = await superBinApi.restore(selectedIds, isMasterSuper ? tenantFilter.trim() : '');
      const failed = Array.isArray(result?.failed) ? result.failed : [];
      if (failed.length > 0) {
        toast.show(failed[0]?.error || 'Some items failed to restore', { type: 'error' });
      } else {
        toast.show(`Restored ${Number(result?.restoredCount || 0)} item(s)`, { type: 'success' });
      }
      setSelectedIds([]);
      await load();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to restore Super Bin items'), { type: 'error' });
    } finally {
      setWorking(false);
    }
  }

  async function runDeleteForever() {
    if (selectedIds.length === 0) return;
    const hasTenant = rows.some((row) => selectedSet.has(row.id) && String(row.entityType || '') === 'tenant');
    const message = hasTenant
      ? `Delete ${selectedIds.length} selected item(s) forever? Tenant delete forever also removes the tenant database permanently.`
      : `Delete ${selectedIds.length} selected item(s) forever?`;
    const ok = await confirmDialog(message);
    if (!ok) return;
    setWorking(true);
    try {
      const result = await superBinApi.deleteForever(selectedIds, isMasterSuper ? tenantFilter.trim() : '');
      const failed = Array.isArray(result?.failed) ? result.failed : [];
      if (failed.length > 0) {
        toast.show(failed[0]?.error || 'Some items failed to delete forever', { type: 'error' });
      } else {
        toast.show(`Deleted ${Number(result?.deletedCount || 0)} item(s) forever`, { type: 'success' });
      }
      setSelectedIds([]);
      await load();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete Super Bin items forever'), { type: 'error' });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Super Bin</h2>
          <div style={{ color: '#64748b', marginTop: 4 }}>
            Restore archived records safely or delete them forever from one place.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn secondary" onClick={() => void load()} disabled={loading || working}>
            Refresh
          </button>
          <button className="btn" onClick={runRestore} disabled={working || selectedIds.length === 0}>
            Restore Selected
          </button>
          <button className="btn secondary" onClick={runDeleteForever} disabled={working || selectedIds.length === 0}>
            Delete Forever
          </button>
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMasterSuper ? 'minmax(220px, 1fr) minmax(180px, 220px) minmax(180px, 220px) auto' : 'minmax(220px, 1fr) minmax(180px, 220px) auto', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archived items"
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Type</span>
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              {ENTITY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          {isMasterSuper && (
            <label style={{ display: 'grid', gap: 6 }}>
              <span>Tenant</span>
              <input
                list="super-bin-tenants"
                value={tenantFilter}
                onChange={(e) => setTenantFilter(e.target.value)}
                placeholder="All tenants or enter tenant id"
              />
              <datalist id="super-bin-tenants">
                {uniqueTenants.map((tenantId) => (
                  <option key={tenantId} value={tenantId} />
                ))}
              </datalist>
            </label>
          )}
          <button className="btn" onClick={() => void load()} disabled={loading || working}>
            Apply
          </button>
        </div>

        <div style={{ color: '#64748b' }}>
          {loading ? 'Loading archived items...' : `${rows.length} archived item(s)`}
          {selectedIds.length > 0 ? `, ${selectedIds.length} selected` : ''}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
                </th>
                <th>Item</th>
                <th>Type</th>
                {isMasterSuper && <th>Tenant</th>}
                <th>Deleted By</th>
                <th>Deleted At</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={isMasterSuper ? 7 : 6} style={{ textAlign: 'center', color: '#64748b', padding: 24 }}>
                    No archived items found.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedSet.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 700 }}>{row.displayName || row.sourceId || '-'}</div>
                    <div style={{ color: '#64748b', fontSize: 13 }}>{row.secondaryText || row.sourceId || '-'}</div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{row.entityType || '-'}</td>
                  {isMasterSuper && (
                    <td>
                      <div>{row.tenantName || row.tenantId || '-'}</div>
                      {row.tenantName && row.tenantId && row.tenantName !== row.tenantId && (
                        <div style={{ color: '#64748b', fontSize: 13 }}>{row.tenantId}</div>
                      )}
                    </td>
                  )}
                  <td>
                    <div>{row.deletedByName || '-'}</div>
                    <div style={{ color: '#64748b', fontSize: 13 }}>{row.deletedByRole || ''}</div>
                  </td>
                  <td>{formatWhen(row.deletedAt)}</td>
                  <td>{row.remark || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default SuperBinPage;
