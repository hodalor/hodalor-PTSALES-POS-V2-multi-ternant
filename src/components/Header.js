import { useDispatch, useSelector, useStore } from 'react-redux';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../store/authSlice';
import { setCurrentBranch } from '../store/settingsSlice';
import BranchSelect from './BranchSelect';
import NotificationBell from './NotificationBell';
import { useToast } from './ToastProvider';
import { ensureOnlineJwt } from '../offline/reAuth';
import { refreshAllData } from '../offline/refreshAll';
import * as authApi from '../api/auth';
import { resetTenantAppState } from '../store';

function Header({ onToggleSidebar }) {
  const auth = useSelector(state => state.auth);
  const settings = useSelector(state => state.settings);
  const currentBranchId = useSelector(state => state.settings.currentBranchId);
  const dispatch = useDispatch();
  const store = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);

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
        <div className="brand-title" title={settings.clientAppName || settings.appName}>
          <strong>{settings.clientAppName || settings.appName}</strong>
        </div>
        <BranchSelect value={currentBranchId} onChange={id => dispatch(setCurrentBranch(id))} className="select topbar-branch-select" />
      </div>
      <div>
        {auth.isAuthenticated ? (
          <>
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
