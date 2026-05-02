import { useDispatch, useSelector, useStore } from 'react-redux';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../store/authSlice';
import { setCurrentBranch } from '../store/settingsSlice';
import BranchSelect from './BranchSelect';
import NotificationBell from './NotificationBell';
import { useToast } from './ToastProvider';
import { useChatNotifications } from './ChatNotificationsProvider';
import { ensureOnlineJwt } from '../offline/reAuth';
import { refreshAllData } from '../offline/refreshAll';
import * as authApi from '../api/auth';
import { resetTenantAppState } from '../store';

function Header({ onToggleSidebar }) {
  const auth = useSelector(state => state.auth);
  const settings = useSelector(state => state.settings);
  const currentBranchId = useSelector(state => state.settings.currentBranchId);
  const branches = useSelector(state => state.branches.branches || []);
  const dispatch = useDispatch();
  const store = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const { unreadCount, liveStatus, enabled: communicationEnabled } = useChatNotifications();
  const [syncing, setSyncing] = useState(false);
  const roleLower = String(auth.role || '').toLowerCase();
  const canChangeBranch = ['admin', 'manager', 'branch manager', 'superadmin'].includes(roleLower);
  const expiryTs = settings?.subscriptionExpiresAt ? new Date(settings.subscriptionExpiresAt).getTime() : 0;
  const isPermanent = !!settings?.subscriptionPermanent;
  const isMaster = String(auth.user?.tenantId || '').toLowerCase() === 'master';
  const daysLeft = expiryTs ? Math.ceil((expiryTs - Date.now()) / (24 * 3600 * 1000)) : null;
  const subscriptionLabel = !isMaster && (isPermanent || daysLeft != null)
    ? (isPermanent
        ? `${String(settings.subscriptionPlan || 'basic')} • Permanent`
        : daysLeft < 0
          ? `Subscription expired`
          : `${String(settings.subscriptionPlan || 'basic')} • ${daysLeft} day(s) left`)
    : '';
  const assigned = auth.user?.assignedBranches || 'all';
  const visibleBranchName = useMemo(() => {
    const assignedIds = assigned === 'all'
      ? []
      : (Array.isArray(assigned) ? assigned : [assigned]).map(v => String(v || '').trim()).filter(Boolean);
    const preferredIds = [auth.user?.branchId, ...assignedIds, currentBranchId].map(v => String(v || '').trim()).filter(Boolean);
    for (const id of preferredIds) {
      const match = (branches || []).find(branch => String(branch.id) === id);
      if (match?.name) return match.name;
    }
    if (assignedIds[0]) return assignedIds[0];
    return 'Assigned Branch';
  }, [assigned, auth.user?.branchId, branches, currentBranchId]);

  return (
    <div className="topbar">
      <div className="brand">
        <button
          className="hamburger"
          aria-label="Toggle menu"
          onClick={() => { if (onToggleSidebar) onToggleSidebar(); }}
          title="Menu"
        >
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2"/></svg>
        </button>
        <img
          src={settings.clientLogoUrl || '/clientlogo512.png'}
          alt="logo"
          style={{ cursor: auth.isAuthenticated ? 'pointer' : 'default' }}
          onClick={() => { if (auth.isAuthenticated) navigate('/dashboard'); }}
          onError={(e) => {
            try {
              const curr = e.currentTarget.src || '';
              if (curr.endsWith('/clientlogo512.png')) {
                e.currentTarget.onerror = null;
                e.currentTarget.src = '/logo512.png';
              } else {
                e.currentTarget.onerror = null;
                e.currentTarget.src = '/clientlogo512.png';
              }
            } catch {}
          }}
        />
        <button
          type="button"
          className="brand-title"
          title={settings.clientAppName || settings.appName}
          onClick={() => { if (auth.isAuthenticated) navigate('/dashboard'); }}
          style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: auth.isAuthenticated ? 'pointer' : 'default' }}
        >
          <strong>{settings.clientAppName || settings.appName}</strong>
        </button>
        {canChangeBranch ? (
          <BranchSelect value={currentBranchId} onChange={id => dispatch(setCurrentBranch(id))} className="select topbar-branch-select" />
        ) : (
          <div className="topbar-branch-badge" title={visibleBranchName}>
            {visibleBranchName}
          </div>
        )}
        {subscriptionLabel ? (
          <div
            title={subscriptionLabel}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 12px',
              borderRadius: 12,
              background: isPermanent ? '#ecfeff' : daysLeft < 0 ? '#fee2e2' : daysLeft <= 14 ? '#fef3c7' : '#ecfeff',
              color: daysLeft < 0 ? '#991b1b' : '#0f172a',
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: 'nowrap'
            }}
          >
            {subscriptionLabel}
          </div>
        ) : null}
      </div>
      <div className="topbar-actions">
        {auth.isAuthenticated ? (
          <>
            {communicationEnabled ? (
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginRight: 8, verticalAlign: 'middle' }}>
                <button
                  className="btn"
                  onClick={() => navigate('/communication/chat')}
                  title={liveStatus === 'live' ? 'Open Communication' : `Communication (${liveStatus})`}
                  style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 42, height: 36 }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                    <path d="M4 6h16v10H7l-3 3V6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span style={{ fontWeight: 700 }}>Chat</span>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: liveStatus === 'live' ? '#22c55e' : '#f97316', boxShadow: '0 0 0 2px rgba(255,255,255,0.85)' }} />
                </button>
                {unreadCount > 0 && (
                  <span style={{ position: 'absolute', top: 4, right: 4, background: '#ef4444', color: '#fff', fontSize: 10, lineHeight: '16px', minWidth: 16, height: 16, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', fontWeight: 800 }}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
            ) : null}
            <NotificationBell />
            <button
              className="btn"
              onClick={async () => {
                if (syncing) return;
                if (!navigator.onLine) { toast.show('Offline: connect internet to sync', { type: 'error' }); return; }
                setSyncing(true);
                try {
                  await ensureOnlineJwt();
                  await refreshAllData(dispatch, store.getState);
                  toast.show('Sync completed', { type: 'success' });
                } catch (e) {
                  toast.show(String(e?.message || 'Sync failed'), { type: 'error' });
                } finally {
                  setSyncing(false);
                }
              }}
              disabled={syncing}
              title="Refresh data from server"
              style={{ marginRight: 8 }}
            >
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
            <span style={{ marginRight: 12 }}>
              {auth.user?.name} — {auth.role}
            </span>
            <button className="btn" onClick={async () => {
              const tenantId = String(auth.user?.tenantId || 'default');
              try { if (navigator.onLine) await authApi.logout(); } catch {}
              try {
                localStorage.removeItem('ptSales:authToken');
                localStorage.removeItem('ptSales:tenantId');
                sessionStorage.removeItem('ptSales:sessionPin');
              } catch {}
              dispatch(resetTenantAppState(tenantId));
              dispatch(logout());
              navigate('/login', { replace: true });
            }}>Logout</button>
          </>
        ) : (
          <span>Not signed in</span>
        )}
      </div>
    </div>
  );
}

export default Header;
