import { useDispatch, useSelector, useStore } from 'react-redux';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout, setUserPreferredLanguage } from '../store/authSlice';
import { setCurrentBranch } from '../store/settingsSlice';
import BranchSelect from './BranchSelect';
import NotificationBell from './NotificationBell';
import { useToast } from './ToastProvider';
import { useChatNotifications } from './ChatNotificationsProvider';
import { ensureOnlineJwt } from '../offline/reAuth';
import { refreshAllData } from '../offline/refreshAll';
import * as authApi from '../api/auth';
import { resetTenantAppState } from '../store';
import { useLanguage } from './LanguageProvider';
import Modal from './Modal';

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
  const { language, setLanguage, options: languageOptions, t } = useLanguage();
  const [syncing, setSyncing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const profileRef = useRef(null);
  const roleLower = String(auth.role || '').toLowerCase();
  const canChangeBranch = ['admin', 'manager', 'branch manager', 'superadmin'].includes(roleLower);
  const canResetOwnPassword = ['admin', 'superadmin'].includes(roleLower) || (Array.isArray(auth.grants) && auth.grants.includes('reset_own_password'));
  const expiryTs = settings?.subscriptionExpiresAt ? new Date(settings.subscriptionExpiresAt).getTime() : 0;
  const isPermanent = !!settings?.subscriptionPermanent;
  const isMaster = String(auth.user?.tenantId || '').toLowerCase() === 'master';
  const daysLeft = expiryTs ? Math.ceil((expiryTs - Date.now()) / (24 * 3600 * 1000)) : null;
  const subscriptionLabel = !isMaster && (isPermanent || daysLeft != null)
    ? (isPermanent
        ? t('{plan} • Permanent', { plan: String(settings.subscriptionPlan || 'basic') })
        : daysLeft < 0
          ? t('Subscription expired')
          : t('{plan} • {count} day(s) left', { plan: String(settings.subscriptionPlan || 'basic'), count: daysLeft }))
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
    return t('Assigned Branch');
  }, [assigned, auth.user?.branchId, branches, currentBranchId, t]);
  useEffect(() => {
    if (!profileOpen) return undefined;
    function handlePointerDown(event) {
      if (!profileRef.current?.contains(event.target)) {
        setProfileOpen(false);
      }
    }
    function handleEscape(event) {
      if (event.key === 'Escape') setProfileOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [profileOpen]);

  async function handleLogout() {
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
  }

  function openPasswordModal() {
    setProfileOpen(false);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setPasswordModalOpen(true);
  }

  function closePasswordModal() {
    if (savingPassword) return;
    setPasswordModalOpen(false);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
  }

  async function handleChangeOwnPassword() {
    const current = String(currentPin || '').trim();
    const next = String(newPin || '').trim();
    const confirm = String(confirmPin || '').trim();
    if (!current || !next || !confirm) {
      toast.show(t('Enter current password and new password'), { type: 'error' });
      return;
    }
    if (!/^\d{4,6}$/.test(next)) {
      toast.show(t('New password must be 4 to 6 digits'), { type: 'error' });
      return;
    }
    if (next !== confirm) {
      toast.show(t('New password confirmation does not match'), { type: 'error' });
      return;
    }
    try {
      setSavingPassword(true);
      await authApi.updateMe({ currentPin: current, newPin: next });
      toast.show(t('Your password was updated'), { type: 'success' });
      closePasswordModal();
    } catch (e) {
      toast.show(String(e?.message || t('Failed to update password')), { type: 'error' });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="topbar">
      <div className="brand">
        <button
          className="hamburger"
          aria-label={t('Menu')}
          onClick={() => { if (onToggleSidebar) onToggleSidebar(); }}
          title={t('Menu')}
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
            className="topbar-subscription-badge"
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
                  className="btn topbar-chat-button"
                  onClick={() => navigate('/communication/chat')}
                  title={t('Open Communication')}
                  style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 42, height: 36 }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                    <path d="M4 6h16v10H7l-3 3V6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span style={{ fontWeight: 700 }}>{t('Chat')}</span>
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
            <select
              className="select topbar-language-select"
              value={language}
              onChange={async (e) => {
                const nextLanguage = e.target.value;
                setLanguage(nextLanguage);
                dispatch(setUserPreferredLanguage(nextLanguage));
                try {
                  await authApi.updateMe({ preferredLanguage: nextLanguage });
                } catch {}
                toast.show(t('Language changed to {label}', { label: languageOptions.find((item) => item.value === nextLanguage)?.label || 'English' }), { type: 'success' });
              }}
              title={t('Preferred language')}
              style={{ marginRight: 8 }}
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>{t(option.label)}</option>
              ))}
            </select>
            <button
              className="btn topbar-sync-button"
              onClick={async () => {
                if (syncing) return;
                if (!navigator.onLine) { toast.show(t('Offline: connect internet to sync'), { type: 'error' }); return; }
                setSyncing(true);
                try {
                  await ensureOnlineJwt();
                  await refreshAllData(dispatch, store.getState);
                  toast.show(t('Sync completed'), { type: 'success' });
                } catch (e) {
                  toast.show(String(e?.message || t('Sync failed')), { type: 'error' });
                } finally {
                  setSyncing(false);
                }
              }}
              disabled={syncing}
              title={t('Refresh data from server')}
              style={{ marginRight: 8 }}
            >
              {syncing ? t('Syncing...') : t('Sync')}
            </button>
            <div className="topbar-profile" ref={profileRef}>
              <button
                type="button"
                className="btn topbar-profile-trigger"
                onClick={() => setProfileOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={profileOpen ? 'true' : 'false'}
                aria-label={t('Open profile menu')}
                title={t('Open profile menu')}
              >
                <span className="topbar-profile-avatar" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" />
                    <path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
                <svg className={`topbar-profile-caret${profileOpen ? ' is-open' : ''}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {profileOpen ? (
                <div className="topbar-profile-menu" role="menu">
                  <div className="topbar-profile-summary">
                    <div className="topbar-profile-name">{auth.user?.name || t('Unknown user')}</div>
                    <div className="topbar-profile-role">{auth.role || t('User')}</div>
                  </div>
                  {canResetOwnPassword ? (
                    <button className="btn topbar-profile-logout" onClick={openPasswordModal} role="menuitem">
                      {t('Change Password')}
                    </button>
                  ) : null}
                  <button className="btn topbar-profile-logout" onClick={handleLogout} role="menuitem">
                    {t('Logout')}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <span>{t('Not signed in')}</span>
        )}
      </div>
      {passwordModalOpen ? (
        <Modal
          title={t('Change Password')}
          onClose={closePasswordModal}
          footer={(
            <>
              <button className="btn" onClick={closePasswordModal} disabled={savingPassword}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={() => void handleChangeOwnPassword()} disabled={savingPassword} style={{ marginLeft: 8 }}>
                {savingPassword ? t('Saving...') : t('Save Password')}
              </button>
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <label>
              <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Current Password')}</div>
              <input className="input" type="password" inputMode="numeric" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} />
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#64748b' }}>{t('New Password')}</div>
              <input className="input" type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Confirm New Password')}</div>
              <input className="input" type="password" inputMode="numeric" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} />
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default Header;
