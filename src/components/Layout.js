import { Outlet } from 'react-router-dom';
import Header from './Header';
import OfflineBanner from './OfflineBanner';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import { useDispatch, useSelector } from 'react-redux';
import { useEffect, useState } from 'react';
import { setBeforeInstallPromptEvent } from '../pwa/installPrompt';
import { setQueueSummary } from '../store/offlineQueueSlice';
import { getQueueSummary, isOfflineBackupEnabled } from '../offline/offlineBackup';
import { attemptSync } from '../offline/queue';
import { syncQueuedItem } from '../offline/syncHandlers';
import { ensureOnlineJwt } from '../offline/reAuth';
import { refreshAllData } from '../offline/refreshAll';

function Layout() {
  const dispatch = useDispatch();
  const footer = useSelector(s => s.settings.footerText);
  const settings = useSelector(s => s.settings);
  const [installEvt, setInstallEvt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const auth = useSelector(s => s.auth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('ptSales:sidebarCollapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    function sync() {
      const isMobile = window.matchMedia && window.matchMedia('(max-width: 992px)').matches;
      document.body.style.overflow = isMobile && sidebarOpen ? 'hidden' : 'auto';
    }
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [sidebarOpen]);
  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const summary = await getQueueSummary();
        if (alive) dispatch(setQueueSummary(summary));
        if (navigator.onLine) {
          await ensureOnlineJwt();
        }
        if (navigator.onLine && summary.total > 0 && isOfflineBackupEnabled(settings)) {
          await attemptSync(syncQueuedItem);
          const after = await getQueueSummary();
          if (alive) dispatch(setQueueSummary(after));
        }
        if (navigator.onLine) {
          await refreshAllData(dispatch);
        }
      } catch {}
    }
    refresh();
    const id = setInterval(refresh, 5000);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    function onBip(e) {
      e.preventDefault();
      setBeforeInstallPromptEvent(e);
      setInstallEvt(e);
      try {
        const dismissed = localStorage.getItem('ptSales:pwaInstallDismissed');
        if (!dismissed) setShowInstall(true);
      } catch {
        setShowInstall(true);
      }
    }
    function onInstalled() {
      setShowInstall(false);
      setInstallEvt(null);
      try { localStorage.setItem('ptSales:pwaInstalled', '1'); } catch {}
    }
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [dispatch, settings]);
  function toggleSidebar() {
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 992px)').matches;
    if (isMobile) {
      setSidebarOpen(o => !o);
    } else {
      setSidebarCollapsed(c => {
        const v = !c;
        try { localStorage.setItem('ptSales:sidebarCollapsed', v ? '1' : '0'); } catch {}
        return v;
      });
    }
  }
  const expiryTs = settings?.subscriptionExpiresAt ? new Date(settings.subscriptionExpiresAt).getTime() : 0;
  const isPermanent = !!settings?.subscriptionPermanent;
  const isMaster = String(auth.user?.tenantId || '').toLowerCase() === 'master';
  const daysLeft = expiryTs ? Math.ceil((expiryTs - Date.now()) / (24 * 3600 * 1000)) : null;
  return (
    <div className={`layout ${sidebarOpen ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <Sidebar collapsed={sidebarCollapsed} />
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className="content">
        <Header onToggleSidebar={toggleSidebar} />
        {showInstall && (
          <div className="card" style={{ margin: '8px 16px', padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700 }}>Install App</div>
              <div style={{ color: '#64748b', fontSize: 12 }}>Install for offline support and faster startup.</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (!installEvt) return;
                  try {
                    await installEvt.prompt();
                    await installEvt.userChoice;
                  } catch {}
                  setShowInstall(false);
                  setInstallEvt(null);
                }}
              >
                Install App
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShowInstall(false);
                  try { localStorage.setItem('ptSales:pwaInstallDismissed', '1'); } catch {}
                }}
              >
                Not now
              </button>
            </div>
          </div>
        )}
        {!isMaster && (isPermanent || daysLeft != null) && (
          <div className="card" style={{ margin: '8px 16px', padding: 12, background: daysLeft < 0 ? '#fee2e2' : daysLeft <= 14 ? '#fef3c7' : '#ecfeff' }}>
            <div style={{ fontWeight: 700 }}>Subscription</div>
            <div style={{ color: '#475569', fontSize: 13 }}>
              {isPermanent ? `Plan: ${String(settings.subscriptionPlan || 'basic')} • Permanent access enabled` : (daysLeft < 0 ? `Subscription expired ${Math.abs(daysLeft)} day(s) ago. Contact your super admin.` : `Plan: ${String(settings.subscriptionPlan || 'basic')} • ${daysLeft} day(s) left`)}
            </div>
          </div>
        )}
        <OfflineBanner />
        <Breadcrumbs />
        <main className="main">
          <Outlet />
        </main>
        <div style={{ padding: 12, color: '#64748b', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>{footer}</div>
      </div>
    </div>
  );
}

export default Layout;
