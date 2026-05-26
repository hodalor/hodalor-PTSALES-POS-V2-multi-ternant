import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useToast } from './ToastProvider';
import { useAppLanguage } from '../utils/localization';

function NotificationBell() {
  const { t } = useAppLanguage();
  const products = useSelector(s => s.products.products);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const branches = useSelector(s => s.branches.branches);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const branchName = branches.find(b => b.id === currentBranchId)?.name || currentBranchId;
  const retailLowStock = useMemo(() => {
    return products.filter(p => (p.lowStock ?? 0) > 0 && ((p.stockByBranch?.[currentBranchId] || 0) <= (p.lowStock ?? 0)));
  }, [products, currentBranchId]);
  const wholesaleLowStock = useMemo(() => {
    return products.filter(p => {
      const threshold = Number(p.wholesaleLowStock != null ? p.wholesaleLowStock : (p.lowStock || 0));
      const stock = Object.values(p.wholesaleStockByBranch || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
      return threshold > 0 && stock <= threshold;
    });
  }, [products]);
  const warehouseLowStock = useMemo(() => {
    return products.filter(p => {
      const threshold = Number(p.warehouseLowStock != null ? p.warehouseLowStock : (p.lowStock || 0));
      const stock = Object.values(p.warehouseStockByBranch || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
      return threshold > 0 && stock <= threshold;
    });
  }, [products]);
  const count = retailLowStock.length + wholesaleLowStock.length + warehouseLowStock.length;
  const navigate = useNavigate();
  useEffect(() => {
    const summary = {
      retail: retailLowStock.length,
      wholesale: wholesaleLowStock.length,
      warehouse: warehouseLowStock.length
    };
    const key = JSON.stringify(summary);
    if (key === JSON.stringify({ retail: 0, wholesale: 0, warehouse: 0 })) return;
    try {
      const last = localStorage.getItem('ptsales:lowstock-notify:v1');
      if (last === key) return;
      localStorage.setItem('ptsales:lowstock-notify:v1', key);
    } catch {}
    const parts = [
      summary.retail > 0 ? `${summary.retail} ${t('Retail').toLowerCase()}` : '',
      summary.wholesale > 0 ? `${summary.wholesale} ${t('Distribution').toLowerCase()}` : '',
      summary.warehouse > 0 ? `${summary.warehouse} ${t('Warehouse').toLowerCase()}` : ''
    ].filter(Boolean);
    const message = t('Low stock alerts: {items}', { items: parts.join(', ') });
    toast.show(message, { type: 'warning' });
    try {
      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') {
          new Notification(t('ptSales Low Stock Alert'), { body: message });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') new Notification(t('ptSales Low Stock Alert'), { body: message });
          }).catch(() => {});
        }
      }
    } catch {}
  }, [retailLowStock.length, t, toast, warehouseLowStock.length, wholesaleLowStock.length]);
  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open]);
  return (
    <span ref={containerRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginRight: 8, verticalAlign: 'middle' }}>
      <button
        className="btn"
        onClick={() => setOpen(v => !v)}
        aria-label={t('Notifications')}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, padding: 0 }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
          <path d="M12 22a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2z" stroke="currentColor" strokeWidth="2"/>
          <path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 7h18s-3 0-3-7z" stroke="currentColor" strokeWidth="2"/>
        </svg>
        {count > 0 && (
          <span style={{ position: 'absolute', top: 4, right: 4, background: '#ef4444', color: '#fff', fontSize: 10, lineHeight: '14px', minWidth: 14, height: 14, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
            {count}
          </span>
        )}
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 40, width: 320, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 30px rgba(0,0,0,0.08)', zIndex: 20 }}>
          <div style={{ padding: 10, borderBottom: '1px solid #e2e8f0', fontWeight: 600 }}>{t('Notifications')}</div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {count === 0 && (
              <div style={{ padding: 12, color: '#64748b' }}>{t('No notifications')}</div>
            )}
            {retailLowStock.map(p => {
              const s = p.stockByBranch?.[currentBranchId] || 0;
              return (
                <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, borderBottom: '1px solid #f1f5f9' }}>
                  {p.image ? <img src={p.image} alt={p.name} style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6 }} /> : (
                    <div style={{ width: 32, height: 32, background: '#f1f5f9', borderRadius: 6 }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t('Low stock')}: {p.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{branchName} • {s} ≤ {p.lowStock}</div>
                  </div>
                  <button className="btn" onClick={() => { setOpen(false); navigate('/products'); }}>{t('View')}</button>
                </div>
              );
            })}
            {wholesaleLowStock.map(p => {
              const s = Object.values(p.wholesaleStockByBranch || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
              const threshold = Number(p.wholesaleLowStock != null ? p.wholesaleLowStock : (p.lowStock || 0));
              return (
                <div key={`wh-${p.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ width: 32, height: 32, background: '#dbeafe', borderRadius: 6 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t('Distribution low stock')}: {p.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{t('All distribution branches')} • {s} ≤ {threshold}</div>
                  </div>
                  <button className="btn" onClick={() => { setOpen(false); navigate('/wholesale-goods'); }}>{t('View')}</button>
                </div>
              );
            })}
            {warehouseLowStock.map(p => {
              const s = Object.values(p.warehouseStockByBranch || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
              const threshold = Number(p.warehouseLowStock != null ? p.warehouseLowStock : (p.lowStock || 0));
              return (
                <div key={`wa-${p.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ width: 32, height: 32, background: '#ede9fe', borderRadius: 6 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{t('Warehouse low stock')}: {p.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{t('All warehouse branches')} • {s} ≤ {threshold}</div>
                  </div>
                  <button className="btn" onClick={() => { setOpen(false); navigate('/warehouse-goods'); }}>{t('View')}</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

export default NotificationBell;
