import { useEffect, useState, useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { loginSuccess } from '../store/authSlice';
import * as authApi from '../api/auth';
import { useToast } from '../components/ToastProvider';
import Modal from '../components/Modal';
import * as usersApi from '../api/users';
import { getApiBase } from '../api/client';
import { clearTenantState } from '../store/persist';
import { resetTenantAppState } from '../store';
import { useAppLanguage } from '../utils/localization';

const COUNTRY_LABELS = {
  GH: 'Ghana',
  ZM: 'Zambia',
  MW: 'Malawi'
};

function detectCardBrand(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^(506|6500)/.test(digits)) return 'Verve';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (/^(6011|65)/.test(digits)) return 'Discover';
  return digits ? 'Card' : 'Unknown';
}

function formatCardNumber(input) {
  const digits = String(input || '').replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatCardExpiry(input) {
  const digits = String(input || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function maskEmail(value) {
  const raw = String(value || '').trim();
  const [left, domain] = raw.split('@');
  if (!left || !domain) return raw;
  const safeLeft = left.length <= 2 ? `${left[0] || ''}*` : `${left.slice(0, 2)}${'*'.repeat(Math.max(1, left.length - 2))}`;
  return `${safeLeft}@${domain}`;
}

function maskPhone(value) {
  const raw = String(value || '').replace(/\s+/g, '');
  if (raw.length <= 4) return raw;
  return `${raw.slice(0, 3)}${'*'.repeat(Math.max(2, raw.length - 5))}${raw.slice(-2)}`;
}

function renderCardBrandLogo(brand) {
  const next = String(brand || '').toLowerCase();
  if (next === 'visa') {
    return <span style={{ fontWeight: 900, fontStyle: 'italic', letterSpacing: 1.2, color: '#f5f5f4' }}>VISA</span>;
  }
  if (next === 'mastercard') {
    return (
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 42, height: 24 }}>
        <span style={{ position: 'absolute', left: 0, width: 22, height: 22, borderRadius: 999, background: '#eb001b', opacity: 0.95 }} />
        <span style={{ position: 'absolute', left: 12, width: 22, height: 22, borderRadius: 999, background: '#f79e1b', opacity: 0.95 }} />
      </span>
    );
  }
  if (next === 'verve') {
    return <span style={{ fontWeight: 900, letterSpacing: 1, color: '#f5f5f4' }}>VERVE</span>;
  }
  return <span style={{ fontWeight: 800, letterSpacing: 1.1, color: '#e5e7eb', textTransform: 'uppercase' }}>{brand}</span>;
}

function renderNetworkBadge(network, active) {
  const label = String(network || '').toUpperCase();
  const palette = label === 'MTN'
    ? { bg: '#fef08a', fg: '#854d0e' }
    : label === 'AIRTELTIGO'
      ? { bg: '#fee2e2', fg: '#1b5299ff' }
      : label === 'TELECEL'
        ? { bg: '#dcfce7', fg: '#991b1b' }
        : label === 'AIRTEL'
          ? { bg: '#fee2e2', fg: '#991b1b' }
          : label === 'ZAMTEL'
            ? { bg: '#e0f2fe', fg: '#075985' }
            : label === 'TNM'
              ? { bg: '#fae8ff', fg: '#86198f' }
              : { bg: '#e2e8f0', fg: '#334155' };
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minWidth: 92,
      padding: '10px 14px',
      borderRadius: 14,
      fontWeight: 800,
      letterSpacing: 0.4,
      background: active ? palette.bg : '#0f172a',
      color: active ? palette.fg : '#e2e8f0',
      border: active ? `1px solid ${palette.fg}22` : '1px solid #334155'
    }}>
      {active ? <span style={{ fontSize: 13, fontWeight: 900 }}>✓</span> : null}
      {label}
    </span>
  );
}

function LoginPage() {
  const [name, setName] = useState('');
  const [tenantId, setTenantId] = useState('master');
  const [pin, setPin] = useState('');
  const [pinVisible, setPinVisible] = useState(false);
  const [remember, setRemember] = useState(true);
  const [captchaInput, setCaptchaInput] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [captchaSecondsLeft, setCaptchaSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activationOpen, setActivationOpen] = useState(false);
  const [activationTenantId, setActivationTenantId] = useState('');
  const [activationAdminName, setActivationAdminName] = useState('');
  const [activationAdminPin, setActivationAdminPin] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [activationLoading, setActivationLoading] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [renewalInfoLoaded, setRenewalInfoLoaded] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState('paypal');
  const [paymentMethod, setPaymentMethod] = useState('mobile_money');
  const [paymentMonths, setPaymentMonths] = useState('1');
  const [paymentNetwork, setPaymentNetwork] = useState('');
  const [paymentPhone, setPaymentPhone] = useState('');
  const [paymentEmail, setPaymentEmail] = useState('');
  const [paymentAddress, setPaymentAddress] = useState('');
  const [paymentCardName, setPaymentCardName] = useState('');
  const [paymentCardNumber, setPaymentCardNumber] = useState('');
  const [paymentCardExpiry, setPaymentCardExpiry] = useState('');
  const [paymentCardCvv, setPaymentCardCvv] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(null);
  const [expiredTenantNotice, setExpiredTenantNotice] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetAdminName, setResetAdminName] = useState('');
  const [resetAdminPin, setResetAdminPin] = useState('');
  const [resetUserName, setResetUserName] = useState('');
  const [resetNewPin, setResetNewPin] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const appName = useSelector(s => s.settings.appName);
  const from = location.state?.from?.pathname;
  const toast = useToast();
  const users = useSelector(s => s.users.users);
  const { t } = useAppLanguage({ tenantId, userName: name });
  

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ptSales:rememberName');
      if (saved) setName(saved);
      const savedTenantId = localStorage.getItem('ptSales:tenantId');
      if (savedTenantId) setTenantId(savedTenantId);
    } catch {}
  }, []);

  useEffect(() => {
    setExpiredTenantNotice('');
  }, [tenantId, name, pin]);

  function formatCurrency(amount, info = paymentInfo) {
    if (amount == null || !info) return '';
    const numeric = Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return info.currencyPosition === 'suffix'
      ? `${numeric} ${info.currencySymbol || info.currencyCode || ''}`.trim()
      : `${info.currencySymbol || info.currencyCode || ''}${numeric}`.trim();
  }

  async function loadRenewalInfo(nextTenantId) {
    const value = String(nextTenantId || '').trim();
    if (!value) return null;
    setRenewalInfoLoaded(false);
    const info = await authApi.getRenewalInfo(value);
    setPaymentInfo(info);
    setPaymentPhone(String(info?.billingPhone || ''));
    setPaymentEmail(String(info?.billingEmail || ''));
    setPaymentAddress(String(info?.billingAddress || ''));
    setPaymentNetwork(String((info?.mobileMoneyNetworks || [])[0] || ''));
    setPaymentMonths(String(info?.periods?.[0]?.months || 1));
    const enabled = Array.isArray(info?.enabledGateways) ? info.enabledGateways : ['paypal', 'paystack', 'dpo_pay'];
    setPaymentProvider(enabled.includes(paymentProvider) ? paymentProvider : enabled[0]);
    setRenewalInfoLoaded(true);
    return info;
  }

  const cardBrand = detectCardBrand(paymentCardNumber);
  const availablePeriods = useMemo(() => paymentInfo?.periods || [], [paymentInfo?.periods]);
  const selectedPeriod = availablePeriods.find((period) => Number(period?.months) === Number(paymentMonths || 0)) || availablePeriods[0] || null;
  const paymentTotal = selectedPeriod?.amount ?? null;
  const countryLabel = COUNTRY_LABELS[String(paymentInfo?.billingCountry || '')] || String(paymentInfo?.billingCountry || '');
  const maskedEmail = maskEmail(paymentEmail || paymentInfo?.billingEmail || '');
  const maskedPhone = maskPhone(paymentPhone || paymentInfo?.billingPhone || '');
  const isPayPalProvider = paymentProvider === 'paypal';
  const isPaystackProvider = paymentProvider === 'paystack';
  const isDpoProvider = paymentProvider === 'dpo_pay';
  const enabledProviders = useMemo(() => (
    Array.isArray(paymentInfo?.enabledGateways)
      ? paymentInfo.enabledGateways
      : paymentInfo
        ? []
        : ['paypal', 'paystack', 'dpo_pay']
  ), [paymentInfo]);
  const canShowPaymentActions = !!expiredTenantNotice && renewalInfoLoaded && enabledProviders.length > 0;
  const paymentUnavailableMessage = String(
    paymentInfo?.paymentUnavailableMessage
    || 'Online payment is currently unavailable contact Prynovatechnologies@gmail.com for activation code.'
  );
  const showProviderChooser = enabledProviders.length > 1;
  const providerCheckoutLabel = isPayPalProvider ? 'Continue Checkout' : isPaystackProvider ? 'Continue To Paystack Checkout' : 'Continue To DPO Checkout';

  const regenerateCaptcha = useCallback(() => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    setCaptcha((previous) => {
      let next = '';
      do {
        next = '';
        for (let i = 0; i < 4; i += 1) next += chars[Math.floor(Math.random() * chars.length)];
      } while (next === previous);
      return next;
    });
    setExpiresAt(Date.now() + 60_000);
    setCaptchaInput('');
  }, []);

  useEffect(() => {
    regenerateCaptcha();
  }, [regenerateCaptcha]);

  useEffect(() => {
    if (!availablePeriods.length) return;
    const hasCurrent = availablePeriods.some((period) => Number(period?.months) === Number(paymentMonths || 0));
    if (!hasCurrent) {
      setPaymentMonths(String(availablePeriods[0]?.months || 1));
    }
  }, [availablePeriods, paymentMonths]);

  useEffect(() => {
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setCaptchaSecondsLeft(remaining);
      if (expiresAt && Date.now() >= expiresAt) regenerateCaptcha();
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, regenerateCaptcha]);
  useEffect(() => {
    setCaptchaSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
  }, [expiresAt]);

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
        setPaymentSuccess(result);
        setPaymentOpen(true);
        setPaymentInfo((prev) => prev ? { ...prev, subscriptionAmount: prev.subscriptionAmount } : prev);
        setExpiredTenantNotice('');
        setTenantId(storedTenantId);
        try { localStorage.removeItem('ptSales:renewalPaymentTenantId'); } catch {}
        try { localStorage.removeItem('ptSales:renewalPaymentProvider'); } catch {}
        try { localStorage.removeItem('ptSales:renewalPaymentTxRef'); } catch {}
        navigate('/login', { replace: true });
        toast.show('Payment verified. Activation code is ready and email has been sent.', { type: 'success' });
      } catch (e) {
        if (!ignore) toast.show(String(e?.message || 'Failed to verify payment'), { type: 'error' });
      }
    })();
    return () => { ignore = true; };
  }, [location.search, navigate, toast]);

  useEffect(() => {
    if (!enabledProviders.includes(paymentProvider)) {
      setPaymentProvider(enabledProviders[0] || 'paypal');
    }
  }, [enabledProviders, paymentProvider]);
  useEffect(() => {
    let ignore = false;
    if (!expiredTenantNotice) {
      setPaymentInfo(null);
      setRenewalInfoLoaded(false);
      return () => { ignore = true; };
    }
    const activeTenantId = String(activationTenantId || tenantId || '').trim();
    if (!activeTenantId) return () => { ignore = true; };
    (async () => {
      try {
        const info = await authApi.getRenewalInfo(activeTenantId);
        if (ignore) return;
        setPaymentInfo(info);
        setPaymentPhone(String(info?.billingPhone || ''));
        setPaymentEmail(String(info?.billingEmail || ''));
        setPaymentAddress(String(info?.billingAddress || ''));
        setPaymentNetwork(String((info?.mobileMoneyNetworks || [])[0] || ''));
        setPaymentMonths(String(info?.periods?.[0]?.months || 1));
        const enabled = Array.isArray(info?.enabledGateways) ? info.enabledGateways : ['paypal', 'paystack', 'dpo_pay'];
        setPaymentProvider(enabled[0] || 'paypal');
        setRenewalInfoLoaded(true);
      } catch {
        if (!ignore) {
          setPaymentInfo(null);
          setRenewalInfoLoaded(true);
        }
      }
    })();
    return () => { ignore = true; };
  }, [activationTenantId, expiredTenantNotice, tenantId]);

  async function doServerLogin(u, p) {
    const resp = await authApi.login({ username: u, pin: p, tenantId });
    try { localStorage.setItem('ptSales:authToken', resp.token); } catch {}
    return resp;
  }
  async function hashPin(str) {
    const enc = new TextEncoder().encode(String(str || ''));
    const buf = await crypto.subtle.digest('SHA-256', enc);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function offlineLogin(u, p) {
    try {
      const raw = localStorage.getItem('ptSales:offlineCreds');
      const map = raw ? JSON.parse(raw) : {};
      const rec = map && typeof map === 'object' ? map[`${String(tenantId || 'master')}:${String(u)}`] : null;
      if (!rec) return null;
      const h = await hashPin(p);
      if (rec.pinHash !== h) return null;
      const localUser = rec.user || users.find(x => String(x.name) === String(u)) || { id: u, name: u };
      return { role: rec.role || localUser.role || 'Cashier', user: localUser, landing: '/pos' };
    } catch {
      return null;
    }
  }

  async function onResetPin() {
    if (resetLoading) return;
    const adminName = resetAdminName.trim();
    const adminPin = resetAdminPin.trim();
    const userName = resetUserName.trim();
    const newPin = resetNewPin.trim();
    if (!adminName || !adminPin || !userName || !newPin) {
      toast.show('Fill all fields', { type: 'error' });
      return;
    }
    if (!/^\d{4,6}$/.test(adminPin)) {
      toast.show('Admin PIN must be 4-6 digits', { type: 'error' });
      return;
    }
    if (!/^\d{4,6}$/.test(newPin)) {
      toast.show('New PIN must be 4-6 digits', { type: 'error' });
      return;
    }
    let prevToken = null;
    try {
      prevToken = localStorage.getItem('ptSales:authToken');
    } catch {}
    setResetLoading(true);
    try {
      const resp = await authApi.login({ username: adminName, pin: adminPin, tenantId });
      const role = String(resp?.role || '').toLowerCase();
      if (role !== 'admin' && role !== 'superadmin') {
        toast.show('Only Admin/SuperAdmin can reset PIN', { type: 'error' });
        return;
      }
      try { localStorage.setItem('ptSales:authToken', resp.token); } catch {}
      await usersApi.update(userName, { pin: newPin });
      toast.show('PIN reset successful', { type: 'success' });
      setResetOpen(false);
      setResetAdminPin('');
      setResetUserName('');
      setResetNewPin('');
    } catch (e) {
      toast.show(e?.message || 'Failed to reset PIN', { type: 'error' });
    } finally {
      try {
        try { await authApi.logout(); } catch {}
        if (prevToken) localStorage.setItem('ptSales:authToken', prevToken);
        else localStorage.removeItem('ptSales:authToken');
      } catch {}
      setResetLoading(false);
    }
  }

  async function onActivateSubscription() {
    if (activationLoading) return;
    const nextTenantId = activationTenantId.trim();
    const adminName = activationAdminName.trim();
    const adminPin = activationAdminPin.trim();
    const code = activationCode.trim().toUpperCase();
    if (!nextTenantId || !adminName || !adminPin || !code) {
      toast.show('Fill all activation fields', { type: 'error' });
      return;
    }
    if (!/^\d{4,6}$/.test(adminPin)) {
      toast.show('Admin PIN must be 4-6 digits', { type: 'error' });
      return;
    }
    setActivationLoading(true);
    try {
      await authApi.activateSubscription({
        tenantId: nextTenantId,
        username: adminName,
        pin: adminPin,
        activationCode: code
      });
      setActivationOpen(false);
      setTenantId(nextTenantId);
      setName(adminName);
      setPin('');
      setActivationAdminPin('');
      setActivationCode('');
      setExpiredTenantNotice('');
      toast.show('Subscription extended for 30 days. You can log in now.', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to activate subscription'), { type: 'error' });
    } finally {
      setActivationLoading(false);
    }
  }

  async function openPaymentModal(options = {}) {
    const nextTenantId = String(tenantId || activationTenantId || '').trim();
    if (!nextTenantId) {
      toast.show('Enter tenant ID first', { type: 'error' });
      return;
    }
    setPaymentLoading(true);
    try {
      const info = await loadRenewalInfo(nextTenantId);
      setPaymentMonths(String(info?.periods?.[0]?.months || 1));
      setPaymentProvider('paypal');
      if (options.closeActivation) setActivationOpen(false);
      setPaymentOpen(true);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load renewal details'), { type: 'error' });
    } finally {
      setPaymentLoading(false);
    }
  }

  async function onStartPayment() {
    if (paymentLoading) return;
    const activeTenantId = String(paymentInfo?.tenantId || tenantId || activationTenantId || '').trim();
    const months = Number(selectedPeriod?.months || paymentMonths || 0);
    if (!activeTenantId || !months) {
      toast.show('Choose tenant and renewal period', { type: 'error' });
      return;
    }
    if (paymentTotal == null) {
      toast.show('Unable to resolve payable amount for the selected period', { type: 'error' });
      return;
    }
    if (isDpoProvider && paymentMethod === 'mobile_money' && (!paymentPhone.trim() || !paymentNetwork.trim())) {
      toast.show('Enter phone number and select mobile money network', { type: 'error' });
      return;
    }
    if (isPaystackProvider && paymentMethod === 'mobile_money' && !paymentPhone.trim()) {
      toast.show('Enter phone number for mobile money checkout', { type: 'error' });
      return;
    }
    setPaymentLoading(true);
    try {
      const result = await authApi.startRenewalPayment({
        tenantId: activeTenantId,
        provider: paymentProvider,
        months,
        method: paymentMethod,
        network: paymentMethod === 'mobile_money' ? paymentNetwork : '',
        phone: paymentPhone.trim(),
        email: paymentEmail.trim(),
        address: paymentAddress.trim(),
        customerName: paymentCardName.trim() || activationAdminName.trim() || name.trim()
      });
      try { localStorage.setItem('ptSales:renewalPaymentTenantId', activeTenantId); } catch {}
      try { localStorage.setItem('ptSales:renewalPaymentProvider', paymentProvider); } catch {}
      try { localStorage.setItem('ptSales:renewalPaymentTxRef', result.txRef || ''); } catch {}
      window.location.assign(result.checkoutUrl);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to start payment'), { type: 'error' });
    } finally {
      setPaymentLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (loading) return;
    if (Date.now() >= expiresAt) {
      toast.show('Captcha expired', { type: 'error' });
      regenerateCaptcha();
      return;
    }
    if (captchaInput.trim().toUpperCase() !== captcha.toUpperCase()) {
      toast.show('Captcha mismatch', { type: 'error' });
      regenerateCaptcha();
      return;
    }
    setLoading(true);
    let role = null;
    let grants = [];
    let landing = '/pos';
    let user = null;
    try {
      const resp = await doServerLogin(name, pin);
      role = resp.role;
      grants = Array.isArray(resp.grants) ? resp.grants : [];
      landing = resp.landing || landing;
      user = resp.user;
      try { sessionStorage.setItem('ptSales:sessionPin', pin); } catch {}
      try {
        const h = await hashPin(pin);
        const raw = localStorage.getItem('ptSales:offlineCreds');
        const map = raw ? JSON.parse(raw) : {};
        map[`${String(tenantId || 'master')}:${String(name)}`] = { pinHash: h, role, user };
        localStorage.setItem('ptSales:offlineCreds', JSON.stringify(map));
      } catch {}
    } catch (e) {
      const msg = String(e?.message || '');
      const m = msg.toLowerCase();
      const isNetwork = m.includes('failed to fetch') || m.includes('network') || m.includes('timeout');
      const isUnauthorized = m.includes('401') || m.includes('unauthorized') || m.includes('invalid');
      const isExpired = m.includes('subscription expired');
      if (!isNetwork && isUnauthorized) {
        toast.show('Invalid username or PIN', { type: 'error' });
        regenerateCaptcha();
        setLoading(false);
        return;
      }
      if (isExpired) {
        try { localStorage.removeItem('ptSales:authToken'); } catch {}
        setActivationTenantId(String(tenantId || ''));
        setActivationAdminName(String(name || ''));
        setExpiredTenantNotice('Subscription expired. This tenant cannot log in until it is renewed or activated.');
        setActivationOpen(true);
        toast.show('Subscription expired. Login denied until renewal.', { type: 'error' });
        regenerateCaptcha();
        setLoading(false);
        return;
      }
      let offline = null;
      try { offline = await offlineLogin(name, pin); } catch {}
      if (!offline) {
        if (isNetwork) {
          const base = (() => { try { return getApiBase(); } catch { return ''; } })();
          toast.show(`Cannot reach server at ${base}. Check API Endpoint or connection.`, { type: 'error' });
        } else if (msg) {
          toast.show(msg, { type: 'error' });
        } else {
          toast.show('Invalid credentials or no offline record', { type: 'error' });
        }
        regenerateCaptcha();
        setLoading(false);
        return;
      }
      role = offline.role;
      grants = Array.isArray(offline.grants) ? offline.grants : [];
      user = offline.user;
      landing = offline.landing || landing;
      try { localStorage.setItem('ptSales:authToken', 'offline'); } catch {}
    }
    const nextTenantId = String(user?.tenantId || tenantId || 'master');
    try { localStorage.setItem('ptSales:tenantId', nextTenantId); } catch {}
    if (remember) {
      try { localStorage.setItem('ptSales:rememberName', name); } catch {}
    } else {
      try { localStorage.removeItem('ptSales:rememberName'); } catch {}
    }
    dispatch(resetTenantAppState(nextTenantId));
    clearTenantState(nextTenantId);
    try { localStorage.removeItem('ptSales:state'); } catch {}
    dispatch(loginSuccess({ user, role, grants }));
    navigate(from || landing, { replace: true });
  }

  // removed API endpoint controls from login

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src="/logo512.png" alt="logo" />
          <div>
            <div className="brand-name">{appName}</div>
          </div>
        </div>
        {loading ? (
          <div style={{ minHeight: 320, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div style={{ display: 'grid', gap: 14, justifyItems: 'center', maxWidth: 420 }}>
              <div className="brand-loader">
                <div className="brand-loader-ring" />
                <img className="brand-loader-logo" src="/logo512.png" alt="logo" />
              </div>
              <div className="brand-loader-copy brand-loader-copy-delay-1" style={{ fontSize: 22, fontWeight: 800 }}>{appName}</div>
              <div className="brand-loader-copy brand-loader-copy-delay-2" style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{t('Signing you in...')}</div>
              <div className="brand-loader-copy brand-loader-copy-delay-3" style={{ color: '#64748b', fontSize: 14 }}>
                {t('Verifying tenant, credentials, and secure access.')}
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <input placeholder={t('tenant id')} value={tenantId} onChange={e => setTenantId(e.target.value)} />
            <input placeholder={t('username')} value={name} onChange={e => setName(e.target.value)} />
            <div className="login-password-field">
              <input placeholder={t('PIN (4-6 digits)')} type={pinVisible ? 'text' : 'password'} value={pin} onChange={e => setPin(e.target.value)} />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setPinVisible((open) => !open)}
                aria-label={pinVisible ? t('Hide PIN') : t('Show PIN')}
                title={pinVisible ? t('Hide PIN') : t('Show PIN')}
              >
                {pinVisible ? (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M10.58 10.58A3 3 0 0 0 13.42 13.42" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M9.88 5.09A10.94 10.94 0 0 1 12 4.9c5.05 0 9.27 3.11 10.5 7.1a11.32 11.32 0 0 1-3.02 4.52M6.1 6.1A11.38 11.38 0 0 0 1.5 12c1.23 3.99 5.45 7.1 10.5 7.1 1.94 0 3.77-.46 5.35-1.27" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M1.5 12C2.73 8.01 6.95 4.9 12 4.9S21.27 8.01 22.5 12C21.27 15.99 17.05 19.1 12 19.1S2.73 15.99 1.5 12Z" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                  </svg>
                )}
              </button>
            </div>
            <div className="captcha-row" data-no-localize="true">
              <input placeholder={t('captcha')} value={captchaInput} onChange={e => setCaptchaInput(e.target.value)} />
              <div className="captcha-box">{captcha}</div>
              <button
                type="button"
                className="outline"
                onClick={regenerateCaptcha}
                title={t('Refresh captcha')}
                aria-label={t('Refresh captcha')}
                style={{ width: 42, minWidth: 42, padding: 0, display: 'inline-grid', placeItems: 'center' }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                  <path d="M20 12a8 8 0 0 1-13.66 5.66M4 12a8 8 0 0 1 13.66-5.66" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M16 4h4v4M8 20H4v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }} data-no-localize="true">
              {t('Captcha refreshes in {count}s', { count: captchaSecondsLeft })}
            </div>
            <label className="remember-row">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              <span>{t('remember PIN')}</span>
            </label>
            <button type="submit" className="primary" disabled={loading}>
              {loading ? t('Logging in...') : t('Log In')}
            </button>
          </form>
        )}
        {expiredTenantNotice ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 13 }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>{t('Subscription Expired')}</div>
            <div>{expiredTenantNotice}</div>
          </div>
        ) : null}
        {paymentSuccess ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: '#ecfdf5', border: '1px solid #86efac', color: '#166534', fontSize: 13 }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>{t('Payment Confirmed')}</div>
            <div>{t('Activation Code')}: <strong>{paymentSuccess.activationCode}</strong></div>
            <div>{t('Code Expires At')}: {paymentSuccess.activationCodeExpiresAt ? new Date(paymentSuccess.activationCodeExpiresAt).toLocaleString() : t('Not set')}</div>
            <div>{t('Renewal Amount')}: {paymentInfo ? formatCurrency(paymentSuccess.amount) : paymentSuccess.amount}</div>
          </div>
        ) : null}
        
        {!loading ? <button className="outline" type="button" onClick={() => setResetOpen(true)}>{t('Reset PIN (Admin)')}</button> : null}
        {expiredTenantNotice ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <button className="outline" type="button" onClick={() => { setActivationTenantId(String(tenantId || '')); setActivationAdminName(String(name || '')); setActivationOpen(true); }}>{t('Activate Subscription')}</button>
            {canShowPaymentActions ? (
              <button className="outline" type="button" onClick={openPaymentModal} disabled={paymentLoading}>{t('Make Payment')}</button>
            ) : null}
          </div>
        ) : null}
      </div>
      {activationOpen && (
        <Modal
          title={t('Activate Subscription')}
          onClose={() => { if (!activationLoading) setActivationOpen(false); }}
          footer={
            <>
              <button className="btn" onClick={() => setActivationOpen(false)} disabled={activationLoading || paymentLoading}>{t('Cancel')}</button>
              {canShowPaymentActions ? (
                <button className="btn" onClick={() => openPaymentModal({ closeActivation: true })} disabled={activationLoading || paymentLoading}>
                  {paymentLoading ? t('Opening Payment...') : t('Make Payment Instead')}
                </button>
              ) : null}
              <button className="btn btn-primary" onClick={onActivateSubscription} disabled={activationLoading || paymentLoading}>
                {activationLoading ? t('Activating...') : t('Activate For 30 Days')}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
              <div style={{ fontWeight: 800, color: '#1d4ed8', marginBottom: 4 }}>{t('30-Day Renewal')}</div>
              <div style={{ color: '#475569', fontSize: 13 }}>
                {t('Enter the tenant admin credentials and the current activation code sent by superadmin. If everything matches, this tenant will be extended for 30 days.')}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label>
                {t('Tenant ID')}
                <input className="input" value={activationTenantId} onChange={e => setActivationTenantId(e.target.value)} disabled={activationLoading || paymentLoading} />
              </label>
              <label>
                {t('Admin Username')}
                <input className="input" value={activationAdminName} onChange={e => setActivationAdminName(e.target.value)} disabled={activationLoading || paymentLoading} />
              </label>
              <label>
                {t('Admin PIN')}
                <input className="input" type="password" value={activationAdminPin} onChange={e => setActivationAdminPin(e.target.value)} disabled={activationLoading || paymentLoading} />
              </label>
              <label>
                {t('Activation Code')}
                <input className="input" value={activationCode} onChange={e => setActivationCode(e.target.value.toUpperCase())} disabled={activationLoading || paymentLoading} />
              </label>
            </div>
            <div style={{ color: '#64748b', fontSize: 13 }}>
              {canShowPaymentActions
                ? <>If you do not have the activation code, choose <strong>Make Payment Instead</strong> to continue with self-service renewal.</>
                : <>{paymentUnavailableMessage}</>}
            </div>
          </div>
        </Modal>
      )}
      {paymentOpen && (
        <Modal
          title={t('Subscription Payment')}
          onClose={() => { if (!paymentLoading) setPaymentOpen(false); }}
          footer={
            <>
              <button className="btn" onClick={() => setPaymentOpen(false)} disabled={paymentLoading}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={onStartPayment} disabled={paymentLoading || !selectedPeriod || paymentTotal == null || enabledProviders.length === 0 || !enabledProviders.includes(paymentProvider)}>
                {paymentLoading ? t('Preparing...') : t(providerCheckoutLabel)}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
              <div style={{ fontWeight: 800, color: '#1d4ed8', marginBottom: 4 }}>{t('Self-Service Renewal')}</div>
              <div style={{ color: '#475569', fontSize: 13 }}>
                {t('Renewal amount follows the tenant currency and plan amount configured by superadmin. Secure payment continues on the payment provider page.')}
              </div>
            </div>
            {paymentInfo ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 12 }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{t('Tenant')}</div>
                    <div style={{ fontWeight: 800 }}>{paymentInfo.tenantName || paymentInfo.tenantId}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }}>
                        {paymentInfo.billingCountry || 'GH'}
                      </span>
                      <span style={{ marginLeft: 8 }}>{countryLabel}</span>
                    </div>
                  </div>
                  <div style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 12 }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{t('Monthly Amount')}</div>
                    <div style={{ fontWeight: 800 }}>{paymentInfo.subscriptionAmount != null ? formatCurrency(paymentInfo.subscriptionAmount, paymentInfo) : t('Not configured')}</div>
                  </div>
                  <div style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 12 }}>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{t('Billing Contact')}</div>
                    <div style={{ fontWeight: 700 }}>{maskedEmail || t('No email set')}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>{maskedPhone || t('No phone set')}</div>
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('Billing Address')}</div>
                  <div style={{ color: '#64748b', fontSize: 13 }}>{paymentAddress || paymentInfo.billingAddress || t('No billing address set')}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label>
                    {t('Renewal Period')}
                    <select className="input" value={paymentMonths} onChange={(e) => setPaymentMonths(e.target.value)} disabled={paymentLoading}>
                      {(paymentInfo.periods || []).map((period) => (
                        <option key={period.months} value={period.months}>
                          {period.months} month(s){Number(period.discountPercent || 0) > 0 ? ` • ${period.discountPercent}% off` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Total To Pay')}
                    <input className="input" readOnly value={paymentTotal != null ? formatCurrency(paymentTotal, paymentInfo) : t('Not configured')} />
                  </label>
                </div>
                {enabledProviders.length > 0 && showProviderChooser ? (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${enabledProviders.length}, minmax(0, 1fr))`, gap: 12 }}>
                    {enabledProviders.includes('paypal') ? (
                      <button
                        type="button"
                        className="btn"
                        style={{ borderColor: paymentProvider === 'paypal' ? '#1d4ed8' : undefined, color: paymentProvider === 'paypal' ? '#1d4ed8' : undefined, background: paymentProvider === 'paypal' ? '#eff6ff' : undefined }}
                        onClick={() => setPaymentProvider('paypal')}
                      >
                        {t('PayPal / Card')}
                      </button>
                    ) : null}
                    {enabledProviders.includes('paystack') ? (
                      <button
                        type="button"
                        className="btn"
                        style={{ borderColor: paymentProvider === 'paystack' ? '#1d4ed8' : undefined, color: paymentProvider === 'paystack' ? '#1d4ed8' : undefined, background: paymentProvider === 'paystack' ? '#eff6ff' : undefined }}
                        onClick={() => setPaymentProvider('paystack')}
                      >
                        {t('Paystack')}
                      </button>
                    ) : null}
                    {enabledProviders.includes('dpo_pay') ? (
                      <button
                        type="button"
                        className="btn"
                        style={{ borderColor: paymentProvider === 'dpo_pay' ? '#1d4ed8' : undefined, color: paymentProvider === 'dpo_pay' ? '#1d4ed8' : undefined, background: paymentProvider === 'dpo_pay' ? '#eff6ff' : undefined }}
                        onClick={() => setPaymentProvider('dpo_pay')}
                      >
                        {t('DPO Pay')}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  enabledProviders.length === 0 ? (
                    <div style={{ padding: 12, borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 13 }}>
                      No payment gateway is currently enabled by superadmin.
                    </div>
                  ) : null
                )}
                {isPayPalProvider ? null : (
                  <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <button type="button" className="btn" style={{ borderColor: paymentMethod === 'mobile_money' ? '#2563eb' : undefined, color: paymentMethod === 'mobile_money' ? '#2563eb' : undefined, background: paymentMethod === 'mobile_money' ? '#eff6ff' : undefined }} onClick={() => setPaymentMethod('mobile_money')}>{t('Mobile Money')}</button>
                  <button type="button" className="btn" style={{ borderColor: paymentMethod === 'card' ? '#2563eb' : undefined, color: paymentMethod === 'card' ? '#2563eb' : undefined, background: paymentMethod === 'card' ? '#eff6ff' : undefined }} onClick={() => setPaymentMethod('card')}>{t('Card')}</button>
                </div>
                {paymentMethod === 'mobile_money' ? (
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 12, alignItems: 'end' }}>
                      <label>
                        {t('Network')}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                          {(paymentInfo.mobileMoneyNetworks || []).map((network) => (
                            <button
                              key={network}
                              type="button"
                              className="btn"
                              style={{ padding: 0, border: 'none', background: 'transparent' }}
                              onClick={() => setPaymentNetwork(network)}
                            >
                              {renderNetworkBadge(network, paymentNetwork === network)}
                            </button>
                          ))}
                        </div>
                      </label>
                      <label>
                        {t('MoMo Number')}
                        <input className="input" value={paymentPhone} onChange={(e) => setPaymentPhone(e.target.value)} disabled={paymentLoading} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, padding: 22, background: 'linear-gradient(145deg, #050505 0%, #151515 40%, #232323 60%, #090909 100%)', color: '#d1d5db', minHeight: 220, boxShadow: '0 18px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
                      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 18% 16%, rgba(255,255,255,0.18), transparent 30%), radial-gradient(circle at 82% 78%, rgba(255,255,255,0.10), transparent 22%)' }} />
                      <div style={{ position: 'absolute', top: -40, left: -120, width: 180, height: 320, transform: 'rotate(24deg)', background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.10) 48%, rgba(255,255,255,0.24) 50%, rgba(255,255,255,0.08) 54%, rgba(255,255,255,0) 100%)', animation: 'payment-card-shine 3.8s linear infinite' }} />
                      <style>{`@keyframes payment-card-shine { 0% { transform: translateX(-140px) rotate(24deg); opacity: 0; } 18% { opacity: 0.7; } 50% { opacity: 1; } 100% { transform: translateX(420px) rotate(24deg); opacity: 0; } }`}</style>
                      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 26 }}>
                        <span style={{ fontWeight: 800, letterSpacing: 1.4, color: '#f3f4f6', textTransform: 'uppercase' }}>{t('Premium Card')}</span>
                        {renderCardBrandLogo(cardBrand)}
                      </div>
                      <div style={{ position: 'relative', width: 54, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #f5f5f4 0%, #a8a29e 45%, #fafaf9 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 6px 12px rgba(0,0,0,0.28)', marginBottom: 28 }} />
                      <div style={{ position: 'relative', fontSize: 28, letterSpacing: 4, marginBottom: 28, color: '#f5f5f4', textShadow: '0 1px 1px rgba(255,255,255,0.15)' }}>{formatCardNumber(paymentCardNumber || '#### #### #### ####') || '#### #### #### ####'}</div>
                      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 11, color: '#a3a3a3', letterSpacing: 1.2, textTransform: 'uppercase' }}>{t('Card Holder')}</div>
                          <div style={{ fontWeight: 800, color: '#f3f4f6', letterSpacing: 0.8, textTransform: 'uppercase' }}>{paymentCardName || 'YOUR NAME'}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: '#a3a3a3', letterSpacing: 1.2, textTransform: 'uppercase' }}>{t('Expiry')}</div>
                          <div style={{ fontWeight: 800, color: '#f3f4f6', letterSpacing: 0.8 }}>{paymentCardExpiry || 'MM/YY'}</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1.25fr) 78px 78px', gap: 10, alignItems: 'end' }}>
                      <label style={{ minWidth: 0 }}>
                        {t('Name On Card')}
                        <input className="input" value={paymentCardName} onChange={(e) => setPaymentCardName(e.target.value)} disabled={paymentLoading} />
                      </label>
                      <label style={{ minWidth: 0 }}>
                        {t('Card Number')}
                        <input className="input" value={formatCardNumber(paymentCardNumber)} onChange={(e) => setPaymentCardNumber(formatCardNumber(e.target.value))} placeholder="4111 1111 1111 1111" disabled={paymentLoading} />
                      </label>
                      <label style={{ minWidth: 0 }}>
                        {t('Expiry')}
                        <input className="input" value={paymentCardExpiry} onChange={(e) => setPaymentCardExpiry(formatCardExpiry(e.target.value))} placeholder="MM/YY" disabled={paymentLoading} style={{width:"70px"}}/>
                      </label>
                      <label style={{ minWidth: 0 }}>
                        {t('Security Code')}
                        <input className="input" type="password" value={paymentCardCvv} onChange={(e) => setPaymentCardCvv(e.target.value)} placeholder="CVV" disabled={paymentLoading} style={{width:"70px"}}/>
                      </label>
                    </div>
                  </div>
                )}
                  </>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <label>
                    {t('Receipt Email')}
                    <input className="input" type="email" value={paymentEmail} onChange={(e) => setPaymentEmail(e.target.value)} disabled={paymentLoading} />
                  </label>
                  <label>
                    {t('Billing Phone')}
                    <input className="input" value={paymentPhone} onChange={(e) => setPaymentPhone(e.target.value)} disabled={paymentLoading} />
                  </label>
                  <label>
                    {t('Billing Address')}
                    <input className="input" value={paymentAddress} onChange={(e) => setPaymentAddress(e.target.value)} disabled={paymentLoading} />
                  </label>
                </div>
              </>
            ) : (
              <div style={{ color: '#64748b' }}>{t('Loading renewal details...')}</div>
            )}
          </div>
        </Modal>
      )}
      {resetOpen && (
        <Modal
          title={t('Reset PIN (Admin)')}
          onClose={() => { if (!resetLoading) setResetOpen(false); }}
          footer={
            <>
              <button className="btn" onClick={() => setResetOpen(false)} disabled={resetLoading}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={onResetPin} disabled={resetLoading}>
                {resetLoading ? t('Resetting...') : t('Reset PIN')}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>
              {t('Enter Admin credentials, then set a new PIN for the user.')}
            </div>
            <label>
              {t('Admin username')}
              <input className="input" value={resetAdminName} onChange={e => setResetAdminName(e.target.value)} disabled={resetLoading} />
            </label>
            <label>
              {t('Admin PIN')}
              <input className="input" type="password" value={resetAdminPin} onChange={e => setResetAdminPin(e.target.value)} disabled={resetLoading} />
            </label>
            <label>
              {t('Username to reset')}
              <input className="input" value={resetUserName} onChange={e => setResetUserName(e.target.value)} disabled={resetLoading} />
            </label>
            <label>
              {t('New PIN (4-6 digits)')}
              <input className="input" type="password" value={resetNewPin} onChange={e => setResetNewPin(e.target.value)} disabled={resetLoading} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default LoginPage;
