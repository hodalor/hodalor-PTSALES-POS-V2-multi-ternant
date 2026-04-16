import { useEffect, useState, useCallback } from 'react';
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

function LoginPage() {
  const [name, setName] = useState('');
  const [tenantId, setTenantId] = useState('master');
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(true);
  const [captchaInput, setCaptchaInput] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activationOpen, setActivationOpen] = useState(false);
  const [activationTenantId, setActivationTenantId] = useState('');
  const [activationAdminName, setActivationAdminName] = useState('');
  const [activationAdminPin, setActivationAdminPin] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [activationLoading, setActivationLoading] = useState(false);
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

  const regenerateCaptcha = useCallback(() => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let str = '';
    for (let i = 0; i < 4; i += 1) str += chars[Math.floor(Math.random() * chars.length)];
    setCaptcha(str);
    setExpiresAt(Date.now() + 60_000);
    setCaptchaInput('');
  }, []);

  useEffect(() => {
    regenerateCaptcha();
  }, [regenerateCaptcha]);

  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() >= expiresAt) regenerateCaptcha();
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, regenerateCaptcha]);

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
    let previousTenantId = 'master';
    try { previousTenantId = String(localStorage.getItem('ptSales:tenantId') || 'master'); } catch {}
    try { localStorage.setItem('ptSales:tenantId', nextTenantId); } catch {}
    if (remember) {
      try { localStorage.setItem('ptSales:rememberName', name); } catch {}
    } else {
      try { localStorage.removeItem('ptSales:rememberName'); } catch {}
    }
    if (previousTenantId !== nextTenantId) {
      dispatch(resetTenantAppState(nextTenantId));
      clearTenantState(nextTenantId);
      try { localStorage.removeItem('ptSales:state'); } catch {}
      window.location.replace(from || landing);
      return;
    }
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
        <form onSubmit={handleSubmit} className="login-form">
          <input placeholder="tenant id (use master for superadmin)" value={tenantId} onChange={e => setTenantId(e.target.value)} />
          <input placeholder="username" value={name} onChange={e => setName(e.target.value)} />
          <input placeholder="PIN (4-6 digits)" type="password" value={pin} onChange={e => setPin(e.target.value)} />
          <div className="captcha-row">
            <input placeholder="captcha" value={captchaInput} onChange={e => setCaptchaInput(e.target.value)} />
            <div className="captcha-box">{captcha}</div>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Captcha refreshes in {Math.max(0, Math.ceil((expiresAt - Date.now())/1000))}s
          </div>
          <label className="remember-row">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            <span>remember PIN</span>
          </label>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>
        {expiredTenantNotice ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 13 }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Subscription Expired</div>
            <div>{expiredTenantNotice}</div>
          </div>
        ) : null}
        
        <button className="outline" type="button" onClick={() => setResetOpen(true)}>Reset PIN (Admin)</button>
        {expiredTenantNotice ? (
          <button className="outline" type="button" onClick={() => { setActivationTenantId(String(tenantId || '')); setActivationAdminName(String(name || '')); setActivationOpen(true); }}>Activate Subscription</button>
        ) : null}
      </div>
      {activationOpen && (
        <Modal
          title="Activate Subscription"
          onClose={() => { if (!activationLoading) setActivationOpen(false); }}
          footer={
            <>
              <button className="btn" onClick={() => setActivationOpen(false)} disabled={activationLoading}>Cancel</button>
              <button className="btn btn-primary" onClick={onActivateSubscription} disabled={activationLoading}>
                {activationLoading ? 'Activating…' : 'Activate For 30 Days'}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
              <div style={{ fontWeight: 800, color: '#1d4ed8', marginBottom: 4 }}>30-Day Renewal</div>
              <div style={{ color: '#475569', fontSize: 13 }}>
                Enter the tenant admin credentials and the current activation code sent by superadmin. If everything matches, this tenant will be extended for 30 days.
              </div>
            </div>
            <label>
              Tenant ID
              <input className="input" value={activationTenantId} onChange={e => setActivationTenantId(e.target.value)} disabled={activationLoading} />
            </label>
            <label>
              Admin Username
              <input className="input" value={activationAdminName} onChange={e => setActivationAdminName(e.target.value)} disabled={activationLoading} />
            </label>
            <label>
              Admin PIN
              <input className="input" type="password" value={activationAdminPin} onChange={e => setActivationAdminPin(e.target.value)} disabled={activationLoading} />
            </label>
            <label>
              Activation Code
              <input className="input" value={activationCode} onChange={e => setActivationCode(e.target.value.toUpperCase())} disabled={activationLoading} />
            </label>
          </div>
        </Modal>
      )}
      {resetOpen && (
        <Modal
          title="Reset PIN (Admin)"
          onClose={() => { if (!resetLoading) setResetOpen(false); }}
          footer={
            <>
              <button className="btn" onClick={() => setResetOpen(false)} disabled={resetLoading}>Cancel</button>
              <button className="btn btn-primary" onClick={onResetPin} disabled={resetLoading}>
                {resetLoading ? 'Resetting…' : 'Reset PIN'}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>
              Enter Admin credentials, then set a new PIN for the user.
            </div>
            <label>
              Admin username
              <input className="input" value={resetAdminName} onChange={e => setResetAdminName(e.target.value)} disabled={resetLoading} />
            </label>
            <label>
              Admin PIN
              <input className="input" type="password" value={resetAdminPin} onChange={e => setResetAdminPin(e.target.value)} disabled={resetLoading} />
            </label>
            <label>
              Username to reset
              <input className="input" value={resetUserName} onChange={e => setResetUserName(e.target.value)} disabled={resetLoading} />
            </label>
            <label>
              New PIN (4-6 digits)
              <input className="input" type="password" value={resetNewPin} onChange={e => setResetNewPin(e.target.value)} disabled={resetLoading} />
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default LoginPage;
