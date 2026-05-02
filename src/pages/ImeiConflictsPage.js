import { useEffect, useState } from 'react';
import { clearImeiConflicts, listImeiConflicts, removeImeiConflict } from '../offline/imeiConflicts';
import { useToast } from '../components/ToastProvider';

function ImeiConflictsPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);

  useEffect(() => {
    setItems(listImeiConflicts());
  }, []);

  function dismiss(id) {
    setItems(removeImeiConflict(id));
    toast.show('Conflict dismissed', { type: 'success' });
  }

  function clearAll() {
    clearImeiConflicts();
    setItems([]);
    toast.show('Conflict queue cleared', { type: 'success' });
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>IMEI Sync Conflicts</h1>
          <div className="page-subtitle-compact">Review serialized sales that failed to sync after being captured offline.</div>
        </div>
        <button className="btn" onClick={clearAll} disabled={items.length === 0}>Clear All</button>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th align="left">Created</th>
              <th align="left">Message</th>
              <th align="left">Customer</th>
              <th align="left">IMEIs / Serials</th>
              <th align="left">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                <td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</td>
                <td>{item.message || 'Sync failed'}</td>
                <td>{item.sale?.customerName || 'Walk-in'}</td>
                <td>{Array.isArray(item.units) && item.units.length > 0 ? item.units.map(unit => unit.imei || unit.serialNumber || unit.unitId).filter(Boolean).join(', ') : '—'}</td>
                <td><button className="btn" onClick={() => dismiss(item.id)}>Dismiss</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>No IMEI sync conflicts</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ImeiConflictsPage;
