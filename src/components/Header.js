import { useDispatch, useSelector, useStore } from 'react-redux';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { logout, setUserPreferredLanguage } from '../store/authSlice';
import { setAllSettings, setCurrentBranch } from '../store/settingsSlice';
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

function formatPaymentCurrency(amount, info = {}) {
  if (amount == null) return '';
  const numeric = Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(info?.currencyPosition || 'prefix') === 'suffix'
    ? `${numeric} ${info?.currencySymbol || info?.currencyCode || ''}`.trim()
    : `${info?.currencySymbol || info?.currencyCode || ''}${numeric}`.trim();
}

function Header({ onToggleSidebar }) {
  const auth = useSelector(state => state.auth);
  const settings = useSelector(state => state.settings);
  const currentBranchId = useSelector(state => state.settings.currentBranchId);
  const branches = useSelector(state => state.branches.branches || []);
  const dispatch = useDispatch();
  const store = useStore();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [paymentMonths, setPaymentMonths] = useState('1');
  const [paymentProvider, setPaymentProvider] = useState('paypal');
  const [paymentMethod, setPaymentMethod] = useState('mobile_money');
  const [paymentPhone, setPaymentPhone] = useState('');
  const [paymentEmail, setPaymentEmail] = useState('');
  const [paymentAddress, setPaymentAddress] = useState('');
  const [paymentNetwork, setPaymentNetwork] = useState('');
  const profileRef = useRef(null);
  const roleLower = String(auth.role || '').toLowerCase();
  const canChangeBranch = ['admin', 'manager', 'branch manager', 'superadmin'].includes(roleLower);
  const canResetOwnPassword = ['admin', 'superadmin'].includes(roleLower) || (Array.isArray(auth.grants) && auth.grants.includes('reset_own_password'));
  const expiryTs = settings?.subscriptionExpiresAt ? new Date(settings.subscriptionExpiresAt).getTime() : 0;
  const isPermanent = !!settings?.subscriptionPermanent;
  const isMaster = String(auth.user?.tenantId || '').toLowerCase() === 'master';
  const canManageSubscription = !isMaster && (
    ['admin', 'manager', 'superadmin'].includes(roleLower)
    || (Array.isArray(auth.grants) && ['view_config', 'see_config', 'manage_subscription', 'renew_subscription'].some((grant) => auth.grants.includes(grant)))
  );
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
  const enabledProviders = useMemo(() => (
    Array.isArray(paymentInfo?.enabledGateways)
      ? paymentInfo.enabledGateways
      : []
  ), [paymentInfo]);
  const availablePeriods = useMemo(() => (
    Array.isArray(paymentInfo?.periods) ? paymentInfo.periods : []
  ), [paymentInfo]);
  const selectedPeriod = useMemo(() => (
    availablePeriods.find((period) => Number(period?.months) === Number(paymentMonths || 0)) || availablePeriods[0] || null
  ), [availablePeriods, paymentMonths]);
  const paymentTotal = selectedPeriod?.amount ?? null;
  const isPayPalProvider = paymentProvider === 'paypal';
  const isPaystackProvider = paymentProvider === 'paystack';
  const isDpoProvider = paymentProvider === 'dpo_pay';
  const providerCheckoutLabel = isPayPalProvider
    ? t('Continue Checkout')
    : isPaystackProvider
      ? t('Continue To Paystack Checkout')
      : t('Continue To DPO Checkout');
  const paymentUnavailableMessage = String(
    paymentInfo?.paymentUnavailableMessage
    || settings?.subscriptionPaymentUnavailableMessage
    || 'Online payment is currently unavailable contact Prynovatechnologies@gmail.com for activation code.'
  );

  async function loadRenewalInfo() {
    const tenantId = String(auth.user?.tenantId || '').trim();
    if (!tenantId) throw new Error('Missing tenant ID');
    const info = await authApi.getRenewalInfo(tenantId);
    setPaymentInfo(info);
    setPaymentPhone(String(info?.billingPhone || ''));
    setPaymentEmail(String(info?.billingEmail || ''));
    setPaymentAddress(String(info?.billingAddress || ''));
    setPaymentNetwork(String((info?.mobileMoneyNetworks || [])[0] || ''));
    setPaymentMonths(String(info?.periods?.[0]?.months || 1));
    const enabled = Array.isArray(info?.enabledGateways) ? info.enabledGateways : [];
    setPaymentProvider(enabled.includes(paymentProvider) ? paymentProvider : (enabled[0] || 'paypal'));
    return info;
  }

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
  useEffect(() => {
    if (!availablePeriods.length) return;
    const hasCurrent = availablePeriods.some((period) => Number(period?.months) === Number(paymentMonths || 0));
    if (!hasCurrent) setPaymentMonths(String(availablePeriods[0]?.months || 1));
  }, [availablePeriods, paymentMonths]);
  useEffect(() => {
    if (!enabledProviders.length) return;
    if (!enabledProviders.includes(paymentProvider)) {
      setPaymentProvider(enabledProviders[0] || 'paypal');
    }
  }, [enabledProviders, paymentProvider]);
  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const storedProvider = localStorage.getItem('ptSales:renewalPaymentProvider') || 'dpo_pay';
    const storedTxRef = localStorage.getItem('ptSales:renewalPaymentTxRef') || '';
    const txRef = storedProvider === 'paypal'
      ? (storedTxRef || params.get('token') || '')
      : storedProvider === 'paystack'
        ? (params.get('reference') || params.get('trxref') || storedTxRef)
        : (params.get('CompanyRef') || params.get('companyRef') || storedTxRef);
    const transactionToken = storedProvider === 'paypal'
      ? (params.get('token') || '')
      : storedProvider === 'paystack'
        ? (params.get('reference') || params.get('trxref') || '')
        : (params.get('TransactionToken') || params.get('TransID') || '');
    if (!txRef || !transactionToken) return;
    let ignore = false;
    (async () => {
      try {
        const storedTenantId = localStorage.getItem('ptSales:renewalPaymentTenantId') || '';
        if (!storedTenantId) return;
        const result = await authApi.verifyRenewalPayment({
          tenantId: storedTenantId,
          provider: storedProvider,
          transactionToken: storedProvider === 'paypal' || storedProvider === 'paystack' ? '' : transactionToken,
          orderId: storedProvider === 'paypal' ? transactionToken : '',
          reference: storedProvider === 'paystack' ? transactionToken : '',
          txRef: storedProvider === 'paypal' ? storedTxRef : txRef
        });
        if (ignore) return;
        dispatch(setAllSettings({
          ...settings,
          subscriptionPlan: result?.tenant?.subscriptionPlan || settings?.subscriptionPlan || 'basic',
          subscriptionExpiresAt: result?.tenant?.subscriptionExpiresAt || settings?.subscriptionExpiresAt || null,
          subscriptionPermanent: result?.tenant?.subscriptionPermanent ?? settings?.subscriptionPermanent ?? false,
          subscriptionAmount: result?.tenant?.subscriptionAmount ?? settings?.subscriptionAmount ?? null
        }));
        setPaymentOpen(false);
        setPaymentInfo((prev) => prev ? ({
          ...prev,
          expired: false,
          subscriptionAmount: result?.tenant?.subscriptionAmount ?? prev.subscriptionAmount
        }) : prev);
        try { localStorage.removeItem('ptSales:renewalPaymentTenantId'); } catch {}
        try { localStorage.removeItem('ptSales:renewalPaymentProvider'); } catch {}
        try { localStorage.removeItem('ptSales:renewalPaymentTxRef'); } catch {}
        navigate(location.pathname, { replace: true });
        toast.show(t('Payment verified. Subscription days were extended successfully.'), { type: 'success' });
      } catch (e) {
        if (!ignore) toast.show(String(e?.message || t('Failed to verify payment')), { type: 'error' });
      }
    })();
    return () => { ignore = true; };
  }, [dispatch, location.pathname, location.search, navigate, settings, t, toast]);

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

  async function openPaymentModal() {
    if (paymentLoading) return;
    if (!canManageSubscription) {
      toast.show(t('You are not allowed to extend subscription days'), { type: 'error' });
      return;
    }
    setPaymentLoading(true);
    try {
      await loadRenewalInfo();
      setPaymentOpen(true);
    } catch (e) {
      toast.show(String(e?.message || t('Failed to load renewal details')), { type: 'error' });
    } finally {
      setPaymentLoading(false);
    }
  }

  async function handleStartRenewalPayment() {
    if (paymentLoading) return;
    const activeTenantId = String(paymentInfo?.tenantId || auth.user?.tenantId || '').trim();
    const months = Number(selectedPeriod?.months || paymentMonths || 0);
    if (!activeTenantId || !months) {
      toast.show(t('Choose renewal period'), { type: 'error' });
      return;
    }
    if (paymentTotal == null) {
      toast.show(t('Unable to resolve payable amount for the selected period'), { type: 'error' });
      return;
    }
    if (isDpoProvider && paymentMethod === 'mobile_money' && (!String(paymentPhone || '').trim() || !String(paymentNetwork || '').trim())) {
      toast.show(t('Enter phone number and select mobile money network'), { type: 'error' });
      return;
    }
    if (isPaystackProvider && paymentMethod === 'mobile_money' && !String(paymentPhone || '').trim()) {
      toast.show(t('Enter phone number for mobile money checkout'), { type: 'error' });
      return;
    }
    setPaymentLoading(true);
    try {
      const returnUrl = `${window.location.origin}${location.pathname}`;
      const result = await authApi.startRenewalPayment({
        tenantId: activeTenantId,
        provider: paymentProvider,
        months,
        method: paymentMethod,
        network: paymentMethod === 'mobile_money' ? paymentNetwork : '',
        phone: String(paymentPhone || '').trim(),
        email: String(paymentEmail || '').trim(),
        address: String(paymentAddress || '').trim(),
        customerName: String(auth.user?.name || '').trim(),
        returnUrl
      });
      try { localStorage.setItem('ptSales:renewalPaymentTenantId', activeTenantId); } catch {}
      try { localStorage.setItem('ptSales:renewalPaymentProvider', paymentProvider); } catch {}
      try { localStorage.setItem('ptSales:renewalPaymentTxRef', result.txRef || ''); } catch {}
      window.location.assign(result.checkoutUrl);
    } catch (e) {
      toast.show(String(e?.message || t('Failed to start payment')), { type: 'error' });
    } finally {
      setPaymentLoading(false);
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
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
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
            {!isPermanent && canManageSubscription ? (
              <button
                type="button"
                className="btn"
                onClick={() => void openPaymentModal()}
                disabled={paymentLoading}
                title={t('Extend subscription days')}
                style={{ whiteSpace: 'nowrap', padding: '8px 12px' }}
              >
                {paymentLoading ? t('Opening...') : t('Extend Days')}
              </button>
            ) : null}
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
      {paymentOpen ? (
        <Modal
          title={t('Extend Subscription Days')}
          onClose={() => { if (!paymentLoading) setPaymentOpen(false); }}
          footer={(
            <>
              <button className="btn" onClick={() => setPaymentOpen(false)} disabled={paymentLoading}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={() => void handleStartRenewalPayment()} disabled={paymentLoading || !selectedPeriod || paymentTotal == null || enabledProviders.length === 0} style={{ marginLeft: 8 }}>
                {paymentLoading ? t('Preparing...') : providerCheckoutLabel}
              </button>
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
              <div style={{ fontWeight: 800, color: '#1d4ed8', marginBottom: 4 }}>{t('Self-Service Renewal')}</div>
              <div style={{ color: '#475569', fontSize: 13 }}>
                {t('Choose how many months to pay for. Subscription days are extended only after payment is verified successfully.')}
              </div>
            </div>
            {paymentInfo ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 12 }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{t('Tenant')}</div>
                    <div style={{ fontWeight: 800 }}>{paymentInfo.tenantName || paymentInfo.tenantId}</div>
                  </div>
                  <div style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 12 }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{t('Current Plan')}</div>
                    <div style={{ fontWeight: 800 }}>{settings.subscriptionPlan || 'basic'}</div>
                  </div>
                  <div style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 12 }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{t('Status')}</div>
                    <div style={{ fontWeight: 800 }}>{daysLeft != null && daysLeft >= 0 ? t('{count} day(s) left', { count: daysLeft }) : t('Expired')}</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label>
                    <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Renewal Period')}</div>
                    <select className="input" value={paymentMonths} onChange={(e) => setPaymentMonths(e.target.value)} disabled={paymentLoading}>
                      {availablePeriods.map((period) => (
                        <option key={period.months} value={period.months}>
                          {period.months} month(s){Number(period.discountPercent || 0) > 0 ? ` • ${period.discountPercent}% off` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Total To Pay')}</div>
                    <input className="input" readOnly value={paymentTotal != null ? formatPaymentCurrency(paymentTotal, paymentInfo) : t('Not configured')} />
                  </label>
                </div>
                {enabledProviders.length > 1 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${enabledProviders.length}, minmax(0, 1fr))`, gap: 12 }}>
                    {enabledProviders.includes('paypal') ? (
                      <button type="button" className="btn" style={{ borderColor: paymentProvider === 'paypal' ? '#1d4ed8' : undefined, color: paymentProvider === 'paypal' ? '#1d4ed8' : undefined, background: paymentProvider === 'paypal' ? '#eff6ff' : undefined }} onClick={() => setPaymentProvider('paypal')}>
                        {t('PayPal / Card')}
                      </button>
                    ) : null}
                    {enabledProviders.includes('paystack') ? (
                      <button type="button" className="btn" style={{ borderColor: paymentProvider === 'paystack' ? '#1d4ed8' : undefined, color: paymentProvider === 'paystack' ? '#1d4ed8' : undefined, background: paymentProvider === 'paystack' ? '#eff6ff' : undefined }} onClick={() => setPaymentProvider('paystack')}>
                        {t('Paystack')}
                      </button>
                    ) : null}
                    {enabledProviders.includes('dpo_pay') ? (
                      <button type="button" className="btn" style={{ borderColor: paymentProvider === 'dpo_pay' ? '#1d4ed8' : undefined, color: paymentProvider === 'dpo_pay' ? '#1d4ed8' : undefined, background: paymentProvider === 'dpo_pay' ? '#eff6ff' : undefined }} onClick={() => setPaymentProvider('dpo_pay')}>
                        {t('DPO Pay')}
                      </button>
                    ) : null}
                  </div>
                ) : enabledProviders.length === 0 ? (
                  <div style={{ padding: 12, borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 13 }}>
                    {paymentUnavailableMessage}
                  </div>
                ) : null}
                {!isPayPalProvider ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <button type="button" className="btn" style={{ borderColor: paymentMethod === 'mobile_money' ? '#2563eb' : undefined, color: paymentMethod === 'mobile_money' ? '#2563eb' : undefined, background: paymentMethod === 'mobile_money' ? '#eff6ff' : undefined }} onClick={() => setPaymentMethod('mobile_money')}>
                        {t('Mobile Money')}
                      </button>
                      <button type="button" className="btn" style={{ borderColor: paymentMethod === 'card' ? '#2563eb' : undefined, color: paymentMethod === 'card' ? '#2563eb' : undefined, background: paymentMethod === 'card' ? '#eff6ff' : undefined }} onClick={() => setPaymentMethod('card')}>
                        {t('Card')}
                      </button>
                    </div>
                    {paymentMethod === 'mobile_money' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <label>
                          <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Network')}</div>
                          <select className="input" value={paymentNetwork} onChange={(e) => setPaymentNetwork(e.target.value)} disabled={paymentLoading}>
                            {(paymentInfo.mobileMoneyNetworks || []).map((network) => (
                              <option key={network} value={network}>{network}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <div style={{ marginBottom: 6, color: '#64748b' }}>{t('MoMo Number')}</div>
                          <input className="input" value={paymentPhone} onChange={(e) => setPaymentPhone(e.target.value)} disabled={paymentLoading} />
                        </label>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label>
                    <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Billing Email')}</div>
                    <input className="input" value={paymentEmail} onChange={(e) => setPaymentEmail(e.target.value)} disabled={paymentLoading} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Billing Phone')}</div>
                    <input className="input" value={paymentPhone} onChange={(e) => setPaymentPhone(e.target.value)} disabled={paymentLoading} />
                  </label>
                </div>
                <label>
                  <div style={{ marginBottom: 6, color: '#64748b' }}>{t('Billing Address')}</div>
                  <input className="input" value={paymentAddress} onChange={(e) => setPaymentAddress(e.target.value)} disabled={paymentLoading} />
                </label>
              </>
            ) : (
              <div style={{ color: '#64748b' }}>{t('Loading renewal details...')}</div>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default Header;
