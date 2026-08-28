import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import OfflineBanner from './OfflineBanner';
import Sidebar from './Sidebar';
import Breadcrumbs from './Breadcrumbs';
import ChatNotificationsProvider from './ChatNotificationsProvider';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useEffect, useState } from 'react';
import { setBeforeInstallPromptEvent } from '../pwa/installPrompt';
import { setQueueSummary } from '../store/offlineQueueSlice';
import { getQueueSummary, isOfflineBackupEnabled } from '../offline/offlineBackup';
import { attemptSync } from '../offline/queue';
import { syncQueuedItem } from '../offline/syncHandlers';
import { ensureOnlineJwt } from '../offline/reAuth';
import { refreshAllData } from '../offline/refreshAll';
import { useAppLanguage } from '../utils/localization';

function Layout({ bootstrapLoading = false }) {
  const dispatch = useDispatch();
  const store = useStore();
  const footer = useSelector(s => s.settings.footerText);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const currentBranchId = useSelector(s => s.settings.currentBranchId || '');
  const { t } = useAppLanguage();
  const location = useLocation();
  const [installEvt, setInstallEvt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
        if (navigator.onLine && !bootstrapLoading) {
          await refreshAllData(dispatch, store.getState);
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
  }, [bootstrapLoading, dispatch, settings, store]);
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
  const brandedName = settings?.clientAppName || settings?.receiptBrandName || settings?.appName || 'ptSales POS';
  const brandedLogo = settings?.clientLogoUrl || '/clientlogo512.png';
  const tenantId = String(auth?.user?.tenantId || '').trim().toLowerCase();
  const showSystemUpgradeNotice = !!settings?.systemUpgradeNoticeEnabled && tenantId && tenantId !== 'master';
  const systemUpgradeNoticeTitle = String(
    settings?.systemUpgradeNoticeTitle
    || 'Database Upgrade In Progress'
  ).trim();
  const systemUpgradeNoticeMessage = String(
    settings?.systemUpgradeNoticeMessage
    || 'A database upgrade is currently in progress. Your data is safe. Some records may take a little longer to appear while we complete the update. Thank you for your patience.'
  ).trim();
  const branchScopedPrefix = [
    '/pos',
    '/wholesale-pos',
    '/inventory',
    '/serialized-inventory',
    '/purchases',
    '/transfers',
    '/adjustments',
    '/expenses',
    '/cash-reconciliation',
    '/wholesale-',
    '/warehouse-'
  ];
  const isBranchScopedRoute = branchScopedPrefix.some((prefix) => String(location.pathname || '').startsWith(prefix));
  const isPosRoute = ['/pos', '/wholesale-pos', '/warehouse-pos'].some((prefix) => String(location.pathname || '').startsWith(prefix));
  const outletKey = isBranchScopedRoute
    ? `branch:${String(currentBranchId || '')}:${String(location.pathname || '')}`
    : String(location.pathname || '');
  return (
    <ChatNotificationsProvider>
      <div className={`layout ${sidebarOpen ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onNavigate={() => {
            const isMobile = window.matchMedia && window.matchMedia('(max-width: 992px)').matches;
            if (isMobile) setSidebarOpen(false);
          }}
        />
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        <div className="content">
          <Header onToggleSidebar={toggleSidebar} />
          {showInstall && (
            <div className="card" style={{ margin: '8px 16px', padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{t('Install App')}</div>
                <div style={{ color: '#64748b', fontSize: 12 }}>{t('Install for offline support and faster startup.')}</div>
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
                  {t('Install App')}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setShowInstall(false);
                    try { localStorage.setItem('ptSales:pwaInstallDismissed', '1'); } catch {}
                  }}
                >
                  {t('Not now')}
                </button>
              </div>
            </div>
          )}
          <OfflineBanner />
          {showSystemUpgradeNotice ? (
            <div
              className="card"
              style={{
                margin: '8px 16px',
                padding: 14,
                border: '1px solid #fde68a',
                background: '#fffbeb',
                color: '#92400e'
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 4 }}>{systemUpgradeNoticeTitle}</div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>{systemUpgradeNoticeMessage}</div>
            </div>
          ) : null}
          <Breadcrumbs />
          <main className={`main${isPosRoute ? ' pos-main-shell' : ''}`}>
            {bootstrapLoading ? (
              <div className="card" style={{ minHeight: 280, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                <div style={{ display: 'grid', gap: 14, justifyItems: 'center', maxWidth: 520 }}>
                  <div className="brand-loader">
                    <div className="brand-loader-ring" />
                    <img className="brand-loader-logo" src={brandedLogo} alt="logo" onError={(e) => { e.currentTarget.src = '/logo512.png'; }} />
                  </div>
                  <div className="brand-loader-copy brand-loader-copy-delay-1" style={{ fontSize: 22, fontWeight: 800 }}>{brandedName}</div>
                  <div className="brand-loader-copy brand-loader-copy-delay-2" style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{t('Loading your business data...')}</div>
                  <div className="brand-loader-copy brand-loader-copy-delay-3" style={{ color: '#64748b', fontSize: 14 }}>
                    {t('Your tenant access is ready. We are now loading products and stock first, then customers, suppliers, sales, and other business records from the database.')}
                  </div>
                  <div className="brand-loader-copy brand-loader-copy-delay-3" style={{ color: '#64748b', fontSize: 13 }}>
                    {t('This does not mean your data is erased.')}
                  </div>
                </div>
              </div>
            ) : (
              <div key={outletKey} className={isPosRoute ? 'pos-outlet-container' : ''}>
                <Outlet />
              </div>
            )}
          </main>
          <div style={{ padding: 12, color: '#64748b', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>{footer}</div>
        </div>
      </div>
    </ChatNotificationsProvider>
  );
}

export default Layout;
