import { useDispatch, useSelector } from 'react-redux';
import { setAppName, setFooterText, setCurrentBranch, setReceiptHeader, setReceiptFooter, setBusinessPhone, setBusinessWebsite, setBusinessTpin, setReceiptQrBaseUrl, setInvoicePrefix, setNextInvoiceNumber, setWholesaleInvoicePrefix, setNextWholesaleInvoiceNumber, setWarehouseInvoicePrefix, setNextWarehouseInvoiceNumber, setReceiptPrefix, setNextReceiptNumber, setDrawerOpenOnCash, setTaxRate, setCurrencyCode, setCurrencySymbol, setCurrencyPosition, setRefreshIntervalSec, addCurrency, removeCurrency, setActiveCurrency, setLoyaltyEnabled, setLoyaltyEarnAmount, setLoyaltyEarnPoints, setLoyaltyRedeemValue, setLoyaltyMinRedeemPoints, setLoyaltyMaxRedeemPercent, setClientAppName, setClientLogoUrl, setInvoiceCompanyAddress, setInvoiceFooter, setInvoiceDeclaration, setInvoiceSignatoryLabel, setInvoiceTitle, setInvoiceWordsLabel, setInvoiceGeneratedNote, setInvoiceNumberDigits, setInvoicePaidStampEnabled, setInvoicePaidStampLabel, setInvoicePaidStampThankYou, setInvoicePaidStampShowDate, setInvoicePaidStampColor, setReceiptBrandName, setAllSettings } from '../store/settingsSlice';
import { addBranch, removeBranch, updateBranch } from '../store/branchesSlice';
import * as branchesApi from '../api/branches';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/ToastProvider';
import { addAudit } from '../store/auditSlice';
import { fetchJson, getApiBase, setApiBase } from '../api/client';
import * as settingsApi from '../api/settings';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import { getBeforeInstallPromptEvent, isInstalled, isRelatedInstalled, checkUpdateAndOpen } from '../pwa/installPrompt';

function ConfigSettingsPage() {
  const dispatch = useDispatch();
  const settings = useSelector(s => s.settings);
  const branches = useSelector(s => s.branches.branches);
  const auth = useSelector(s => s.auth);
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [branchType, setBranchType] = useState('retail');
  const [newCurCode, setNewCurCode] = useState('');
  const [newCurSymbol, setNewCurSymbol] = useState('');
  const [newCurPos, setNewCurPos] = useState('prefix');
  const [savingSettings, setSavingSettings] = useState(false);
  const [addingBranch, setAddingBranch] = useState(false);
  const [removingBranchId, setRemovingBranchId] = useState('');
  const toast = useToast();
  const initialTaxRef = useRef(settings.taxRate);
  const initialSettingsRef = useRef(settings || {});
  const initialSettingsCapturedRef = useRef(false);
  const canEditTax = ['Admin','Manager'].includes(auth.role) || String(auth.role || '').toLowerCase() === 'superadmin';
  const roleLower = String(auth.role || '').toLowerCase();
  const canManageBranches = roleLower === 'admin' || roleLower === 'superadmin';
  const isSuperAdmin = roleLower === 'superadmin';
  const isMasterSuperAdmin = isSuperAdmin && String(auth.user?.tenantId || '').toLowerCase() === 'master';
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const setSetting = (key, value) => dispatch(setAllSettings({ ...(settings || {}), [key]: value }));
  const [apiBase, setApiBaseState] = useState(() => {
    try { return getApiBase(); } catch { return ''; }
  });

  useEffect(() => {
    if (!initialSettingsCapturedRef.current && settings && Object.keys(settings).length > 0) {
      initialSettingsRef.current = { ...(settings || {}) };
      initialSettingsCapturedRef.current = true;
    }
  }, [settings]);

  function Spinner() {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
        </path>
      </svg>
    );
  }

  function addNewBranch() {
    if (!branchName.trim() || !branchCode.trim()) return;
    const action = dispatch(addBranch({ name: branchName.trim(), code: branchCode.trim(), branchType, offline: true }));
    const created = action?.payload;
    setAddingBranch(true);
    if (!navigator.onLine && !offlineBackupAllowed) {
      if (created) dispatch(removeBranch(created.id));
      setAddingBranch(false);
      toast.show('Offline: connect internet and try again.', { type: 'error' });
      return;
    }
    if (created) {
      if (!navigator.onLine) {
        enqueueHttp({ collection: 'branches', label: 'Branch', path: '/api/branches', method: 'POST', body: { id: created.id, name: created.name, code: created.code, branchType: created.branchType || branchType } })
          .catch(() => {
            dispatch(removeBranch(created.id));
            toast.show('Failed to save offline', { type: 'error' });
          })
          .finally(() => setAddingBranch(false));
      } else {
        branchesApi.create({ id: created.id, name: created.name, code: created.code, branchType: created.branchType || branchType })
          .then(() => {
            dispatch(updateBranch({ id: created.id, name: created.name, code: created.code, branchType: created.branchType || branchType, offline: false }));
          })
          .catch(() => {
            dispatch(removeBranch(created.id));
            toast.show('Failed to create branch on server', { type: 'error' });
          })
          .finally(() => setAddingBranch(false));
      }
    } else {
      setAddingBranch(false);
    }
    setBranchName('');
    setBranchCode('');
    setBranchType('retail');
  }
  
  async function onEditBranch(b) {
    if (!canManageBranches) {
      toast.show('Only Admin or SuperAdmin can edit branches', { type: 'error' });
      return;
    }
    const { promptDialog } = await import('../utils/dialogs');
    const newName = await promptDialog('Enter new branch name', b.name);
    if (!newName || !newName.trim()) return;
    const newCode = await promptDialog('Enter new branch code', b.code);
    if (!newCode || !newCode.trim()) return;
    const newType = await promptDialog('Enter branch type: retail, wholesale, or warehouse', b.branchType || 'retail');
    if (!newType || !newType.trim()) return;
    const normalizedType = ['retail', 'wholesale', 'warehouse'].includes(String(newType).toLowerCase()) ? String(newType).toLowerCase() : 'retail';
    const patch = { name: newName.trim(), code: newCode.trim(), branchType: normalizedType };
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        return;
      }
      dispatch(updateBranch({ id: b.id, ...patch, offline: true }));
      try {
        await enqueueHttp({ collection: 'branches', label: 'Branch update', path: `/api/branches/${encodeURIComponent(b.id)}`, method: 'PUT', body: patch });
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
      }
      return;
    }
    try {
      await branchesApi.update(b.id, patch);
      dispatch(updateBranch({ id: b.id, ...patch }));
      toast.show('Branch updated', { type: 'success' });
    } catch {
      toast.show('Failed to update branch on server', { type: 'error' });
    }
  }
  
  async function onRemoveBranch(b) {
    if (!canManageBranches) {
      toast.show('Only Admin or SuperAdmin can remove branches', { type: 'error' });
      return;
    }
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Remove branch ${b.name}?`);
    if (!ok) return;
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        return;
      }
      dispatch(removeBranch(b.id));
      try {
        await enqueueHttp({ collection: 'branches', label: 'Branch delete', path: `/api/branches/${encodeURIComponent(b.id)}`, method: 'DELETE', body: {} });
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
      }
      return;
    }
    try {
      setRemovingBranchId(String(b.id || ''));
      dispatch(removeBranch(b.id));
      await branchesApi.remove(b.id);
      if (String(settings.currentBranchId || '') === String(b.id)) {
        const fallback = (branches || []).find(branch => String(branch.id || branch._id || '') !== String(b.id));
        dispatch(setCurrentBranch(String(fallback?.id || fallback?._id || '')));
      }
      toast.show('Branch removed', { type: 'success' });
    } catch (e) {
      dispatch(addBranch(b));
      toast.show(String(e?.message || 'Failed to remove branch on server'), { type: 'error' });
    } finally {
      setRemovingBranchId('');
    }
  }

  function renderBranchGroup(groupType, title, description) {
    const groupBranches = branches.filter(b => String(b.branchType || 'retail').toLowerCase() === groupType);
    const badgeStyle = groupType === 'warehouse'
      ? { background: '#ede9fe', color: '#6d28d9' }
      : groupType === 'wholesale'
        ? { background: '#dbeafe', color: '#1d4ed8' }
        : { background: '#dcfce7', color: '#166534' };
    return (
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div>
            <h3 className="section-title" style={{ margin: 0 }}>{title}</h3>
            <div style={{ color: '#64748b', fontSize: 12 }}>{description}</div>
          </div>
          <div style={{ color: '#64748b', fontSize: 12 }}>{groupBranches.length} location(s)</div>
        </div>
        <ul>
          {groupBranches.map(b => (
            <li key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>{b.name} ({b.code})</span>
                <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, ...badgeStyle }}>
                  {String(b.branchType || 'retail')}
                </span>
              </span>
              <span>
                <button className="btn" onClick={() => onEditBranch(b)} disabled={!canManageBranches || !!removingBranchId}>Edit</button>
                <button className="btn" onClick={() => onRemoveBranch(b)} disabled={!canManageBranches || b.id === 'main' || !!removingBranchId} style={{ marginLeft: 8 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {removingBranchId === String(b.id || '') && <Spinner />}
                    {removingBranchId === String(b.id || '') ? 'Removing…' : 'Remove'}
                  </span>
                </button>
              </span>
            </li>
          ))}
          {groupBranches.length === 0 && <li style={{ padding: '8px 0', color: '#64748b' }}>No {title.toLowerCase()} added yet.</li>}
        </ul>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Configuration</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <OfflineQueueIndicator collection="settings" label="Settings queued" />
          <OfflineQueueIndicator collection="branches" label="Branches queued" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card">
            <h2 className="section-title">App Identity</h2>
            {isMasterSuperAdmin && (
            <>
              <label>
                App Name
                <input className="input" value={settings.appName} onChange={e => dispatch(setAppName(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                <label>
                  Invoice Prefix
                  <input className="input" value={settings.invoicePrefix || ''} onChange={e => dispatch(setInvoicePrefix(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
                </label>
                <label>
                  Next Invoice Number
                  <input className="input" type="number" min="1" value={settings.nextInvoiceNumber || 1} onChange={e => dispatch(setNextInvoiceNumber(Number(e.target.value)))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                <label>
                  Receipt Prefix
                  <input className="input" value={settings.receiptPrefix || ''} onChange={e => dispatch(setReceiptPrefix(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
                </label>
                <label>
                  Next Receipt Number
                  <input className="input" type="number" min="1" value={settings.nextReceiptNumber || 1} onChange={e => dispatch(setNextReceiptNumber(Number(e.target.value)))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
                </label>
              </div>
              <label style={{ display: 'block', marginTop: 12 }}>
                Footer Text
                <input className="input" value={settings.footerText} onChange={e => dispatch(setFooterText(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
            </>
            )}
          </div>
          {(roleLower === 'admin' || isSuperAdmin) && (
            <div className="card">
              <h3 className="section-title" style={{ margin: '8px 0' }}>Client App Name</h3>
              <label>
                Client App Name (Top bar)
                <input className="input" value={settings.clientAppName || ''} onChange={e => dispatch(setClientAppName(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label style={{ display: 'block', marginTop: 8 }}>
                Receipt Brand Name (Receipt header)
                <input className="input" value={settings.receiptBrandName || ''} onChange={e => dispatch(setReceiptBrandName(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label style={{ display: 'block', marginTop: 8 }}>
                Theme Color
                <input className="input" type="color" value={settings.themeColor || '#16a34a'} onChange={e => setSetting('themeColor', e.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, height: 44 }} />
              </label>
              {String(auth.user?.tenantId || '').toLowerCase() !== 'master' && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#f8fafc', color: '#475569' }}>
                  Plan: {String(settings.subscriptionPlan || 'basic')}{settings.subscriptionExpiresAt ? ` • Expires ${new Date(settings.subscriptionExpiresAt).toLocaleDateString()}` : ''}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <h3 className="section-title" style={{ margin: '8px 0' }}>Client App Logo</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img
                    src={settings.clientLogoUrl || '/clientlogo512.png'}
                    alt="client logo preview"
                    width={32}
                    height={32}
                    style={{ borderRadius: 6, border: '1px solid #e2e8f0' }}
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
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0];
                      if (!f) return;
                      const MAX_BYTES = 1400 * 1024; // keep under backend 2MB json limit
                      if (f.size > MAX_BYTES) {
                        toast.show('Logo too large. Please use an image under 1.4MB.', { type: 'error' });
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = String(reader.result || '');
                        dispatch(setClientLogoUrl(dataUrl));
                      };
                      reader.readAsDataURL(f);
                    }}
                  />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => dispatch(setClientLogoUrl(''))}
                    title="Use default logo"
                  >
                    Use default
                  </button>
                </div>
                <div style={{ marginTop: 6, color: '#64748b' }}>
                  Upload image to override top bar logo. Falls back to /clientlogo512.png if empty or load fails.
                </div>
              </div>
            </div>
          )}
          {(roleLower === 'admin' || isSuperAdmin) && (
            <div className="card">
              <h3 className="section-title" style={{ margin: '8px 0' }}>App Installation (PWA)</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      if (await isRelatedInstalled() || isInstalled()) {
                        toast.show('App already installed. Opening…', { type: 'success' });
                        await checkUpdateAndOpen('/');
                        return;
                      }
                      const evt = getBeforeInstallPromptEvent();
                      if (evt) {
                        await evt.prompt();
                        const choice = await evt.userChoice;
                        if (choice && choice.outcome === 'accepted') {
                          toast.show('App installed', { type: 'success' });
                          await checkUpdateAndOpen('/');
                        } else {
                          toast.show('Install dismissed', { type: 'error' });
                        }
                        return;
                      }
                      toast.show('Opening app. Use browser menu to Install.', { type: 'success' });
                      await checkUpdateAndOpen('/');
                    } catch {
                      toast.show('Install failed', { type: 'error' });
                    }
                  }}
                >
                  Install App
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      const status = await checkUpdateAndOpen('/');
                      if (status === 'updated') {
                        toast.show('App updated. Opening…', { type: 'success' });
                      } else if (status === 'up-to-date') {
                        toast.show('App is up to date. Opening…', { type: 'success' });
                      } else {
                        toast.show('Opening app…', { type: 'success' });
                      }
                    } catch {
                      toast.show('Open failed', { type: 'error' });
                    }
                  }}
                >
                  Check & Open
                </button>
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  {isInstalled() ? 'Installed' : 'Not installed'}
                </div>
              </div>
            </div>
          )}
          <div className="card" style={{ padding: 12, color: '#64748b' }}>
            Receipt uses the Client App Logo (falls back to /clientlogo512.png or /logo512.png).
          </div>
          <div className="card" style={{ padding: 12 }}>
            <h3 className="section-title" style={{ margin: '8px 0' }}>Invoice Settings</h3>
            <label style={{ display: 'block', marginTop: 8 }}>
              Company Address (Letterhead)
              <textarea className="input" rows="3" value={settings.invoiceCompanyAddress || ''} onChange={e => dispatch(setInvoiceCompanyAddress(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              Invoice Title
              <input className="input" value={settings.invoiceTitle || 'Invoice'} onChange={e => dispatch(setInvoiceTitle(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              Invoice Footer
              <input className="input" placeholder="© ptSales" value={settings.invoiceFooter || ''} onChange={e => dispatch(setInvoiceFooter(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              Declaration Text
              <textarea className="input" rows="3" placeholder="We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct." value={settings.invoiceDeclaration || ''} onChange={e => dispatch(setInvoiceDeclaration(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              Signatory Label
              <input className="input" placeholder="Authorised Signatory" value={settings.invoiceSignatoryLabel || ''} onChange={e => dispatch(setInvoiceSignatoryLabel(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              Amount-in-words Label
              <input className="input" value={settings.invoiceWordsLabel || 'Amount Chargeable (in words)'} onChange={e => dispatch(setInvoiceWordsLabel(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              Generated Note
              <input className="input" value={settings.invoiceGeneratedNote || 'This is a Computer Generated Invoice'} onChange={e => dispatch(setInvoiceGeneratedNote(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              <label>
                Retail Invoice Prefix
                <input className="input" value={settings.invoicePrefix || ''} onChange={e => dispatch(setInvoicePrefix(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label>
                Number Digits (padding)
                <input className="input" type="number" min="1" max="12" value={settings.invoiceNumberDigits || 6} onChange={e => dispatch(setInvoiceNumberDigits(Number(e.target.value)))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12 }}>
              <label>
                Wholesale Invoice Prefix
                <input className="input" value={settings.wholesaleInvoicePrefix || 'WINV'} onChange={e => dispatch(setWholesaleInvoicePrefix(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label>
                Next Wholesale Invoice Number
                <input className="input" type="number" min="1" value={settings.nextWholesaleInvoiceNumber || 1} onChange={e => dispatch(setNextWholesaleInvoiceNumber(Number(e.target.value)))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 12 }}>
              <label>
                Warehouse Invoice Prefix
                <input className="input" value={settings.warehouseInvoicePrefix || 'WHINV'} onChange={e => dispatch(setWarehouseInvoicePrefix(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label>
                Next Warehouse Invoice Number
                <input className="input" type="number" min="1" value={settings.nextWarehouseInvoiceNumber || 1} onChange={e => dispatch(setNextWarehouseInvoiceNumber(Number(e.target.value)))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
            </div>
            <div className="card" style={{ marginTop: 12, padding: 12 }}>
              <h3 className="section-title" style={{ margin: '8px 0' }}>PAID Stamp (POS Invoices)</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={!!settings.invoicePaidStampEnabled} onChange={e => dispatch(setInvoicePaidStampEnabled(e.target.checked))} />
                <span>Show PAID stamp on POS invoices</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <label>
                  Center Label
                  <input className="input" value={settings.invoicePaidStampLabel || 'PAID'} onChange={e => dispatch(setInvoicePaidStampLabel(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
                </label>
                <label>
                  Thank-you Text
                  <input className="input" value={settings.invoicePaidStampThankYou || 'THANK YOU!'} onChange={e => dispatch(setInvoicePaidStampThankYou(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={!!settings.invoicePaidStampShowDate} onChange={e => dispatch(setInvoicePaidStampShowDate(e.target.checked))} />
                  <span>Include Date</span>
                </label>
                <label>
                  Color
                  <input className="input" type="color" value={settings.invoicePaidStampColor || '#cc0000'} onChange={e => dispatch(setInvoicePaidStampColor(e.target.value))} style={{ display: 'block', width: 120, height: 40, padding: 0, border: 'none' }} />
                </label>
              </div>
              <div style={{ color: '#64748b', marginTop: 6 }}>Top text uses Client App Name automatically.</div>
            </div>
          </div>
          <div className="card">
          <label style={{ display: 'block', marginTop: 0 }}>
            Business Phone
            <input className="input" value={settings.businessPhone || ''} onChange={e => dispatch(setBusinessPhone(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            Website
            <input className="input" value={settings.businessWebsite || ''} onChange={e => dispatch(setBusinessWebsite(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <label>
              TIN/TPIN
              <input className="input" value={settings.businessTpin || ''} onChange={e => dispatch(setBusinessTpin(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 12 }}>
            Receipt QR Base URL
            <input className="input" placeholder="e.g., https://pos.yourdomain.com" value={settings.receiptQrBaseUrl || ''} onChange={e => dispatch(setReceiptQrBaseUrl(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            Receipt Header
            <input className="input" value={settings.receiptHeader} onChange={e => dispatch(setReceiptHeader(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            Receipt Footer
            <input className="input" value={settings.receiptFooter} onChange={e => dispatch(setReceiptFooter(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
          </label>
          {isMasterSuperAdmin && (
            <label style={{ display: 'block', marginTop: 12 }}>
              <input type="checkbox" checked={!!settings.drawerOpenOnCash} onChange={e => dispatch(setDrawerOpenOnCash(e.target.checked))} />
              <span style={{ marginLeft: 8 }}>Trigger Drawer Open on Cash payment</span>
            </label>
          )}
          <label style={{ display: 'block', marginTop: 12 }}>
            Default Tax Rate (%)
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={Math.round((settings.taxRate || 0) * 10000) / 100}
              onChange={e => {
                const pct = Number(e.target.value);
                if (!Number.isNaN(pct) && canEditTax) dispatch(setTaxRate(pct / 100));
              }}
              disabled={!canEditTax}
              style={{ display: 'block', width: '100%', marginTop: 6 }}
            />
          </label>
          </div>
          <div className="card">
            <h3 className="section-title" style={{ margin: '8px 0' }}>Credit Sale Rules</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label>
                Minimum upfront (%)
                <input className="input" type="number" min="0" max="100" value={settings.minimumUpfrontPaymentPercent || 0} onChange={e => setSetting('minimumUpfrontPaymentPercent', Number(e.target.value) || 0)} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label>
                Minimum upfront (fixed)
                <input className="input" type="number" min="0" value={settings.minimumUpfrontPaymentFixed || 0} onChange={e => setSetting('minimumUpfrontPaymentFixed', Number(e.target.value) || 0)} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label>
                Penalty per day
                <input className="input" type="number" min="0" value={settings.penaltyPerDay || 0} onChange={e => setSetting('penaltyPerDay', Number(e.target.value) || 0)} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label>
                Max overdue allowed
                <input className="input" type="number" min="0" value={settings.maxOverdueAllowed || 0} onChange={e => setSetting('maxOverdueAllowed', Number(e.target.value) || 0)} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label>
                Max credit limit per customer
                <input className="input" type="number" min="0" value={settings.maxCreditLimitPerCustomer || 0} onChange={e => setSetting('maxCreditLimitPerCustomer', Number(e.target.value) || 0)} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 28 }}>
                <input type="checkbox" checked={settings.partialPaymentAllowed !== false} onChange={e => setSetting('partialPaymentAllowed', e.target.checked)} />
                Partial repayments allowed
              </label>
            </div>
          </div>
          <div className="card">
            <h3 className="section-title" style={{ margin: '8px 0' }}>Loyalty Points</h3>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <input type="checkbox" checked={!!settings.loyaltyEnabled} onChange={e => dispatch(setLoyaltyEnabled(e.target.checked))} />
              <span style={{ marginLeft: 8 }}>Enable loyalty points</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label>
                Earn: Amount spent
                <input className="input" type="number" min="0" step="0.01" value={settings.loyaltyEarnAmount || 0} onChange={e => dispatch(setLoyaltyEarnAmount(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} disabled={!settings.loyaltyEnabled} />
              </label>
              <label>
                Earn: Points
                <input className="input" type="number" min="0" step="1" value={settings.loyaltyEarnPoints || 0} onChange={e => dispatch(setLoyaltyEarnPoints(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} disabled={!settings.loyaltyEnabled} />
              </label>
              <label>
                Redeem value (money per point)
                <input className="input" type="number" min="0" step="0.01" value={settings.loyaltyRedeemValue || 0} onChange={e => dispatch(setLoyaltyRedeemValue(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} disabled={!settings.loyaltyEnabled} />
              </label>
              <label>
                Minimum redeem points
                <input className="input" type="number" min="0" step="1" value={settings.loyaltyMinRedeemPoints || 0} onChange={e => dispatch(setLoyaltyMinRedeemPoints(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} disabled={!settings.loyaltyEnabled} />
              </label>
              <label>
                Max redeem (% of sale)
                <input className="input" type="number" min="0" max="100" step="1" value={settings.loyaltyMaxRedeemPercent ?? 50} onChange={e => dispatch(setLoyaltyMaxRedeemPercent(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} disabled={!settings.loyaltyEnabled} />
              </label>
            </div>
            <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>
              Example: Earn Amount=100 and Points=5 means every 100 spent earns 5 points. Redeem value controls discount.
            </div>
          </div>
          <div className="card">
            <h3 className="section-title" style={{ margin: '8px 0' }}>Currency</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label>
                Code
                <input className="input" value={settings.currencyCode} onChange={e => dispatch(setCurrencyCode(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
              <label>
                Symbol
                <input className="input" value={settings.currencySymbol} onChange={e => dispatch(setCurrencySymbol(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }} />
              </label>
            </div>
            <label style={{ display: 'block', marginTop: 8 }}>
              Position
              <select className="select" value={settings.currencyPosition} onChange={e => dispatch(setCurrencyPosition(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }}>
                <option value="prefix">Prefix (₵10.00)</option>
                <option value="suffix">Suffix (10.00₵)</option>
              </select>
            </label>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Currencies</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6 }}>
                <select className="select" value={settings.activeCurrencyCode || settings.currencyCode} onChange={e => dispatch(setActiveCurrency(e.target.value))}>
                  {(settings.currencies || []).map(c => <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>)}
                </select>
                <input className="input" placeholder="New code" value={newCurCode} onChange={e => setNewCurCode(e.target.value.toUpperCase())} />
                <input className="input" placeholder="New symbol" value={newCurSymbol} onChange={e => setNewCurSymbol(e.target.value)} />
                <select className="select" value={newCurPos} onChange={e => setNewCurPos(e.target.value)}>
                  <option value="prefix">Prefix</option>
                  <option value="suffix">Suffix</option>
                </select>
                <button className="btn" onClick={() => {
                  if (!newCurCode || !newCurSymbol) return;
                  dispatch(addCurrency({ code: newCurCode, symbol: newCurSymbol, position: newCurPos }));
                  setNewCurCode('');
                  setNewCurSymbol('');
                }}>Add</button>
              </div>
              <ul style={{ marginTop: 8 }}>
                {(settings.currencies || []).map(c => (
                  <li key={c.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', padding: '6px 0' }}>
                    <span>{c.code} {c.position === 'suffix' ? `(10.00${c.symbol})` : `(${c.symbol}10.00)`}</span>
                    <span>
                      <button className="btn" onClick={() => dispatch(setActiveCurrency(c.code))} disabled={(settings.activeCurrencyCode||settings.currencyCode)===c.code}>Use</button>
                      <button className="btn" onClick={() => dispatch(removeCurrency(c.code))} style={{ marginLeft: 6 }} disabled={(settings.activeCurrencyCode||settings.currencyCode)===c.code}>Remove</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {isMasterSuperAdmin && (
            <div className="card">
              <h3 className="section-title" style={{ margin: '8px 0' }}>Background Refresh</h3>
              <label>
                Interval (seconds)
                <input
                  className="input"
                  type="number"
                  min="10"
                  max="3600"
                  value={settings.refreshIntervalSec || 60}
                  onChange={e => dispatch(setRefreshIntervalSec(Number(e.target.value)))}
                  disabled={!canEditTax}
                  style={{ display: 'block', width: '100%', marginTop: 6 }}
                />
              </label>
              <div style={{ marginTop: 6, color: '#64748b' }}>
                Used for auto-refreshing products, customers, suppliers, branches, refunds and sales.
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      const pong = await fetchJson('/');
                      await fetchJson('/api/branches');
                      toast.show(`API OK: ${pong?.name || 'online'}`, { type: 'success' });
                    } catch (e) {
                      toast.show('API test failed', { type: 'error' });
                    }
                  }}
                >
                  Test API
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    try {
                      localStorage.removeItem('ptSales:state');
                      toast.show('Local data cleared', { type: 'success' });
                    } catch {}
                  }}
                >
                  Clear Local Data
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                <h3 className="section-title" style={{ margin: '8px 0' }}>API Endpoint</h3>
                <label>
                  Base URL
                  <input
                    className="input"
                    placeholder="http://localhost:4000"
                    value={apiBase}
                    onChange={e => setApiBaseState(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 6 }}
                  />
                </label>
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      try {
                        setApiBase(apiBase);
                        toast.show('API base saved', { type: 'success' });
                      } catch {
                        toast.show('Failed to save API base', { type: 'error' });
                      }
                    }}
                  >
                    Save API Base
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="card" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (savingSettings) return;
                const before = initialTaxRef.current || 0;
                const after = settings.taxRate || 0;
                if (before !== after) {
                  if (!canEditTax) {
                    toast.show('Not permitted to change tax rate', { type: 'error' });
                    return;
                  }
                  const { promptDialog } = await import('../utils/dialogs');
                  const remark = await promptDialog('Enter remark for tax rate change');
                  if (!remark.trim()) {
                    toast.show('Remark is required for tax change', { type: 'error' });
                    return;
                  }
                  dispatch(addAudit({
                    actor: auth.user?.name || 'unknown',
                    actionType: 'tax_rate_change',
                    details: { from: Math.round(before * 100), to: Math.round(after * 100) },
                    remark
                  }));
                  initialTaxRef.current = after;
                }
                try {
                  setSavingSettings(true);
                  if (!navigator.onLine) {
                    if (!offlineBackupAllowed) {
                      toast.show('Offline: connect internet and try again.', { type: 'error' });
                      return;
                    }
                    const payload = (() => {
                      const copy = { ...(settings || {}) };
                      const baseline = initialSettingsRef.current || {};
                      const changed = {};
                      Object.keys(copy).forEach(key => {
                        if (JSON.stringify(copy[key]) !== JSON.stringify(baseline[key])) changed[key] = copy[key];
                      });
                      if (roleLower === 'admin' && changed && Object.prototype.hasOwnProperty.call(changed, 'featureFlags')) {
                        delete changed.featureFlags;
                      }
                      return changed;
                    })();
                    if (Object.keys(payload).length === 0) {
                      toast.show('No settings changes to save', { type: 'success' });
                      return;
                    }
                    await enqueueHttp({ collection: 'settings', label: 'Settings', path: '/api/settings', method: 'PUT', body: payload });
                    toast.show('Saved offline. Will backup when online.', { type: 'success' });
                    return;
                  }
                  const payload = (() => {
                    const copy = { ...(settings || {}) };
                    const baseline = initialSettingsRef.current || {};
                    const changed = {};
                    Object.keys(copy).forEach(key => {
                      if (JSON.stringify(copy[key]) !== JSON.stringify(baseline[key])) changed[key] = copy[key];
                    });
                    if (roleLower === 'admin' && changed && Object.prototype.hasOwnProperty.call(changed, 'featureFlags')) {
                      delete changed.featureFlags;
                    }
                    return changed;
                  })();
                  if (Object.keys(payload).length === 0) {
                    toast.show('No settings changes to save', { type: 'success' });
                    return;
                  }
                  await settingsApi.save(payload);
                  initialSettingsRef.current = { ...(initialSettingsRef.current || {}), ...payload };
                  initialSettingsCapturedRef.current = true;
                  toast.show('Settings saved', { type: 'success' });
                } catch {
                  toast.show('Failed to save settings', { type: 'error' });
                } finally {
                  setSavingSettings(false);
                }
              }}
              disabled={savingSettings}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {savingSettings && <Spinner />}
                {savingSettings ? 'Saving…' : 'Save'}
              </span>
            </button>
          </div>
        </div>
        <div className="card">
          <h2 className="section-title">Branches</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ color: '#64748b', fontSize: 12 }}>Retail Branches</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{branches.filter(b => String(b.branchType || 'retail').toLowerCase() === 'retail').length}</div>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ color: '#64748b', fontSize: 12 }}>Distribution Shops</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#1d4ed8' }}>{branches.filter(b => String(b.branchType || 'retail').toLowerCase() === 'wholesale').length}</div>
              </div>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ color: '#64748b', fontSize: 12 }}>Warehouses</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#6d28d9' }}>{branches.filter(b => String(b.branchType || 'retail').toLowerCase() === 'warehouse').length}</div>
              </div>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <label>
                Current Branch
                <select className="select" value={settings.currentBranchId} onChange={e => dispatch(setCurrentBranch(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }}>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            </div>
            <div className="card" style={{ padding: 16 }}>
              <h3 className="section-title" style={{ margin: '0 0 8px 0' }}>Create Location</h3>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>Create retail branches, wholesale shops, or warehouse locations from here.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
                <input className="input" placeholder="Branch name" value={branchName} onChange={e => setBranchName(e.target.value)} disabled={!canManageBranches} />
                <input className="input" placeholder="Code" value={branchCode} onChange={e => setBranchCode(e.target.value)} disabled={!canManageBranches} />
                <select className="select" value={branchType} onChange={e => setBranchType(e.target.value)} disabled={!canManageBranches}>
                  <option value="retail">Retail</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="warehouse">Warehouse</option>
                </select>
                <button className="btn btn-primary" onClick={addNewBranch} disabled={!canManageBranches || addingBranch}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {addingBranch && <Spinner />}
                    {addingBranch ? 'Adding…' : 'Add'}
                  </span>
                </button>
              </div>
            </div>
            {renderBranchGroup('retail', 'Retail Branches', 'Retail sales locations and outlets.')}
            {renderBranchGroup('wholesale', 'Wholesale Shops', 'Wholesale-only selling locations and stores.')}
            {renderBranchGroup('warehouse', 'Warehouses', 'Storage and supply locations without POS.')}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConfigSettingsPage;
