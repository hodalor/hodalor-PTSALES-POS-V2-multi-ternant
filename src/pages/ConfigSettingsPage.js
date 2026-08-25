import { useDispatch, useSelector } from 'react-redux';
import { setAppName, setFooterText, setCurrentBranch, setReceiptHeader, setReceiptFooter, setReceiptShowPaymentInfo, setReceiptShowTaxInfo, setReceiptShowQrSection, setDistributionPosDefaultPrintMode, setWarehousePosDefaultPrintMode, setBusinessPhone, setBusinessWebsite, setBusinessTpin, setReceiptQrBaseUrl, setInvoicePrefix, setNextInvoiceNumber, setWholesaleInvoicePrefix, setNextWholesaleInvoiceNumber, setWarehouseInvoicePrefix, setNextWarehouseInvoiceNumber, setReceiptPrefix, setNextReceiptNumber, setDrawerOpenOnCash, setTaxRate, setCurrencyCode, setCurrencySymbol, setCurrencyPosition, setRefreshIntervalSec, addCurrency, removeCurrency, setActiveCurrency, setLoyaltyEnabled, setLoyaltyEarnAmount, setLoyaltyEarnPoints, setLoyaltyRedeemValue, setLoyaltyMinRedeemPoints, setLoyaltyMaxRedeemPercent, setClientAppName, setClientLogoUrl, setPreferredLanguage, setInvoiceCompanyAddress, setInvoiceFooter, setInvoiceDeclaration, setInvoiceSignatoryLabel, setInvoiceTitle, setInvoiceWordsLabel, setInvoiceGeneratedNote, setInvoiceNumberDigits, setInvoicePaidStampEnabled, setInvoicePaidStampLabel, setInvoicePaidStampThankYou, setInvoicePaidStampShowDate, setInvoicePaidStampColor, setReceiptBrandName, setAllSettings, addSettingsCategory, removeSettingsCategory } from '../store/settingsSlice';
import { addBranch, removeBranch, setBranches, updateBranch } from '../store/branchesSlice';
import * as branchesApi from '../api/branches';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import { addAudit } from '../store/auditSlice';
import { clearApiBase, fetchJson, getApiBase, getDefaultApiBase, setApiBase } from '../api/client';
import * as settingsApi from '../api/settings';
import * as tenantsApi from '../api/tenants';
import * as reconciliationAccountsApi from '../api/reconciliationAccounts';
import { formatCurrency } from '../utils/currency';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import TenantLimitUpgradeModal from '../components/TenantLimitUpgradeModal';
import { getBeforeInstallPromptEvent, isInstalled, isRelatedInstalled, checkUpdateAndOpen } from '../pwa/installPrompt';
import { clearTenantState } from '../store/persist';
import { CHAT_SOUND_OPTIONS, playChatSound, startOutgoingCallTone, stopIncomingRingtone, unlockChatSound } from '../utils/chatSound';
import { LANGUAGE_OPTIONS, useAppLanguage } from '../utils/localization';
import { clearPendingTenantLimitPayment, clearTenantLimitPaymentUrlQuery, getTenantLimitPaymentVerificationPayload } from '../utils/tenantLimitPayments';

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
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCreditPackageName, setNewCreditPackageName] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSavedPulse, setSettingsSavedPulse] = useState(false);
  const [savingCategories, setSavingCategories] = useState(false);
  const [savingCreditPackages, setSavingCreditPackages] = useState(false);
  const [addingBranch, setAddingBranch] = useState(false);
  const [removingBranchId, setRemovingBranchId] = useState('');
  const [limitUpgradeContext, setLimitUpgradeContext] = useState(null);
  const [tenantQuota, setTenantQuota] = useState(null);
  const [reconciliationAccounts, setReconciliationAccounts] = useState([]);
  const [loadingReconciliationAccounts, setLoadingReconciliationAccounts] = useState(false);
  const [savingReconciliationAccount, setSavingReconciliationAccount] = useState(false);
  const [testingChatSound, setTestingChatSound] = useState(false);
  const [testingCallSound, setTestingCallSound] = useState(false);
  const [reconciliationForm, setReconciliationForm] = useState({
    name: '',
    bankName: '',
    accountName: '',
    accountNumber: '',
    sharedAcrossBranches: false,
    branchIds: []
  });
  const toast = useToast();
  const { t } = useAppLanguage();
  const initialTaxRef = useRef(settings.taxRate);
  const initialSettingsRef = useRef(settings || {});
  const initialSettingsCapturedRef = useRef(false);
  const resolvedRole = String(auth.role || auth.user?.role || '').toLowerCase();
  const canEditTax = ['admin', 'manager'].includes(resolvedRole) || resolvedRole === 'superadmin';
  const roleLower = resolvedRole;
  const canManageBranches = roleLower === 'admin' || roleLower === 'superadmin';
  const isSuperAdmin = roleLower === 'superadmin';
  const isMasterSuperAdmin = isSuperAdmin && String(auth.user?.tenantId || '').toLowerCase() === 'master';
  const canManageFinanceAccounts = isSuperAdmin || roleLower === 'admin' || (Array.isArray(auth.grants) && auth.grants.includes('manage_finance_accounts'));
  const tenantAllowedSettingKeys = useRef(new Set([
    'clientAppName',
    'clientLogoUrl',
    'preferredLanguage',
    'chatNotificationSound',
    'callNotificationSound',
    'webRtcIceServers',
    'receiptBrandName',
    'receiptHeader',
    'receiptFooter',
    'receiptShowPaymentInfo',
    'receiptShowTaxInfo',
    'receiptShowQrSection',
    'distributionPosDefaultPrintMode',
    'warehousePosDefaultPrintMode',
    'businessPhone',
    'businessWebsite',
    'businessTpin',
    'receiptQrBaseUrl',
    'invoiceCompanyAddress',
    'invoiceFooter',
    'invoiceDeclaration',
    'invoiceSignatoryLabel',
    'invoiceTitle',
    'invoiceWordsLabel',
    'invoiceGeneratedNote',
    'invoicePaidStampEnabled',
    'invoicePaidStampLabel',
    'invoicePaidStampThankYou',
    'invoicePaidStampShowDate',
    'invoicePaidStampColor',
    'taxRate',
    'currencyCode',
    'currencySymbol',
    'currencyPosition',
    'currencies',
    'activeCurrencyCode',
    'themeColor',
    'subscriptionPaymentUnavailableMessage',
    'systemUpgradeNoticeEnabled',
    'systemUpgradeNoticeTitle',
    'systemUpgradeNoticeMessage',
    'currentBranchId',
    'categories',
    'creditPackages',
    'userGrants'
  ]));
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

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!canManageFinanceAccounts) return;
      try {
        setLoadingReconciliationAccounts(true);
        const rows = await reconciliationAccountsApi.listReconciliationAccounts();
        if (alive) setReconciliationAccounts(Array.isArray(rows) ? rows : []);
      } catch (e) {
        if (alive) toast.show(String(e?.message || 'Failed to load finance accounts'), { type: 'error' });
      } finally {
        if (alive) setLoadingReconciliationAccounts(false);
      }
    })();
    return () => { alive = false; };
  }, [canManageFinanceAccounts, toast]);

  const loadTenantQuota = useCallback(async () => {
    const tenantId = String(auth.user?.tenantId || '');
    if (!auth.isAuthenticated || !tenantId || tenantId.toLowerCase() === 'master') {
      setTenantQuota(null);
      return null;
    }
    const meta = await tenantsApi.me().catch(() => null);
    setTenantQuota(meta);
    return meta;
  }, [auth.isAuthenticated, auth.user?.tenantId]);

  useEffect(() => {
    void loadTenantQuota();
  }, [loadTenantQuota]);

  useEffect(() => {
    let ignore = false;
    const payload = getTenantLimitPaymentVerificationPayload(window.location.search);
    if (!auth.isAuthenticated || !payload) return () => { ignore = true; };
    (async () => {
      try {
        const result = await tenantsApi.verifyLimitUpgradePayment(payload);
        if (ignore) return;
        clearPendingTenantLimitPayment();
        clearTenantLimitPaymentUrlQuery();
        setLimitUpgradeContext(null);
        await loadTenantQuota();
        toast.show(String(result?.message || 'Limit increased successfully'), { type: 'success' });
      } catch (e) {
        if (ignore) return;
        toast.show(String(e?.message || 'Failed to verify limit payment'), { type: 'error' });
      }
    })();
    return () => { ignore = true; };
  }, [auth.isAuthenticated, loadTenantQuota, toast]);

  const branchQuotaCards = useMemo(() => {
    const limits = tenantQuota?.limits || {};
    const totalBranches = branches.length;
    const maxBranches = limits.maxBranches ?? null;
    const remainingBranches = maxBranches == null ? 'Unlimited' : Math.max(0, Number(maxBranches) - Number(totalBranches || 0));
    return [
      { label: 'Branch Limit', value: maxBranches == null ? 'Unlimited' : maxBranches },
      { label: 'Branches Used', value: totalBranches },
      { label: 'Branch Slots Left', value: remainingBranches }
    ];
  }, [tenantQuota, branches.length]);

  useEffect(() => {
    const unlock = () => {
      unlockChatSound().catch(() => {});
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  function buildSettingsPayload() {
    const copy = { ...(settings || {}) };
    const baseline = initialSettingsRef.current || {};
    const changed = {};
    Object.keys(copy).forEach(key => {
      if (JSON.stringify(copy[key]) !== JSON.stringify(baseline[key])) changed[key] = copy[key];
    });
    if (roleLower === 'admin' && changed && Object.prototype.hasOwnProperty.call(changed, 'featureFlags')) {
      delete changed.featureFlags;
    }
    if (!isMasterSuperAdmin) {
      Object.keys(changed).forEach((key) => {
        if (!tenantAllowedSettingKeys.current.has(key)) delete changed[key];
      });
    }
    return changed;
  }

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

  async function persistCategories(nextCategories, rollbackCategories, successMessage) {
    try {
      setSavingCategories(true);
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          dispatch(setAllSettings({ ...(settings || {}), categories: rollbackCategories }));
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return false;
        }
        await enqueueHttp({ collection: 'settings', label: 'Category settings', path: '/api/settings', method: 'PUT', body: { categories: nextCategories } });
        initialSettingsRef.current = { ...(initialSettingsRef.current || {}), categories: nextCategories };
        initialSettingsCapturedRef.current = true;
        toast.show('Categories saved offline. Will backup when online.', { type: 'success' });
        return true;
      }
      await settingsApi.save({ categories: nextCategories });
      initialSettingsRef.current = { ...(initialSettingsRef.current || {}), categories: nextCategories };
      initialSettingsCapturedRef.current = true;
      toast.show(successMessage, { type: 'success' });
      return true;
    } catch (e) {
      dispatch(setAllSettings({ ...(settings || {}), categories: rollbackCategories }));
      toast.show(String(e?.message || 'Failed to save categories'), { type: 'error' });
      return false;
    } finally {
      setSavingCategories(false);
    }
  }

  async function addConfigCategory() {
    const value = String(newCategoryName || '').trim();
    if (!value || savingCategories) return;
    const existing = Array.isArray(settings.categories) ? settings.categories : [];
    if (existing.some(item => String(item).toLowerCase() === value.toLowerCase())) {
      toast.show('Category already exists', { type: 'error' });
      return;
    }
    const nextCategories = [...existing, value];
    dispatch(addSettingsCategory(value));
    setNewCategoryName('');
    await persistCategories(nextCategories, existing, 'Category added');
  }

  async function removeConfigCategory(categoryName) {
    if (savingCategories) return;
    const existing = Array.isArray(settings.categories) ? settings.categories : [];
    const nextCategories = existing.filter(item => String(item).toLowerCase() !== String(categoryName || '').toLowerCase());
    dispatch(removeSettingsCategory(categoryName));
    await persistCategories(nextCategories, existing, 'Category removed');
  }

  async function persistCreditPackages(nextPackages, rollbackPackages, successMessage) {
    try {
      setSavingCreditPackages(true);
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          dispatch(setAllSettings({ ...(settings || {}), creditPackages: rollbackPackages }));
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return false;
        }
        await enqueueHttp({ collection: 'settings', label: 'Credit package settings', path: '/api/settings', method: 'PUT', body: { creditPackages: nextPackages } });
        initialSettingsRef.current = { ...(initialSettingsRef.current || {}), creditPackages: nextPackages };
        initialSettingsCapturedRef.current = true;
        toast.show('Credit packages saved offline. Will backup when online.', { type: 'success' });
        return true;
      }
      await settingsApi.save({ creditPackages: nextPackages });
      initialSettingsRef.current = { ...(initialSettingsRef.current || {}), creditPackages: nextPackages };
      initialSettingsCapturedRef.current = true;
      toast.show(successMessage, { type: 'success' });
      return true;
    } catch (e) {
      dispatch(setAllSettings({ ...(settings || {}), creditPackages: rollbackPackages }));
      toast.show(String(e?.message || 'Failed to save credit packages'), { type: 'error' });
      return false;
    } finally {
      setSavingCreditPackages(false);
    }
  }

  async function addCreditPackage() {
    const value = String(newCreditPackageName || '').trim();
    if (!value || savingCreditPackages) return;
    const existing = Array.isArray(settings.creditPackages) ? settings.creditPackages : [];
    if (existing.some(item => String(item).toLowerCase() === value.toLowerCase())) {
      toast.show('Credit package already exists', { type: 'error' });
      return;
    }
    const nextPackages = [...existing, value];
    dispatch(setAllSettings({ ...(settings || {}), creditPackages: nextPackages }));
    setNewCreditPackageName('');
    await persistCreditPackages(nextPackages, existing, 'Credit package added');
  }

  async function removeCreditPackage(packageName) {
    if (savingCreditPackages) return;
    const existing = Array.isArray(settings.creditPackages) ? settings.creditPackages : [];
    const nextPackages = existing.filter(item => String(item).toLowerCase() !== String(packageName || '').toLowerCase());
    dispatch(setAllSettings({ ...(settings || {}), creditPackages: nextPackages }));
    await persistCreditPackages(nextPackages, existing, 'Credit package removed');
  }

  function renderCategoriesCard() {
    return (
      <div className="card" style={{ alignSelf: 'start', padding: 20 }}>
        <h3 className="section-title" style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Manage Categories</h3>
        <div style={{ color: '#64748b', fontSize: 13, marginTop: 12, marginBottom: 16 }}>
          Add or remove product categories here. Changes save instantly and product creation updates immediately for this tenant.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 18 }}>
          <input className="input" placeholder="New category" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} style={{ width: '100%', minHeight: 48 }} disabled={savingCategories} />
          <button className="btn btn-primary" type="button" onClick={addConfigCategory} style={{ minWidth: 92, minHeight: 48 }} disabled={savingCategories}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {savingCategories && <Spinner />}
              {savingCategories ? 'Saving…' : 'Add'}
            </span>
          </button>
        </div>
        <div style={{ display: 'grid', gap: 0 }}>
          {(settings.categories || []).map(cat => (
            <div key={cat} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 18, color: '#0f172a' }}>{cat}</div>
              <button className="btn" type="button" onClick={() => removeConfigCategory(cat)} style={{ minWidth: 96, borderRadius: 14, padding: '10px 14px' }} disabled={savingCategories}>Remove</button>
            </div>
          ))}
          {(!settings.categories || settings.categories.length === 0) && (
            <div style={{ color: '#64748b', padding: '8px 0' }}>No categories added yet.</div>
          )}
        </div>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 12 }}>
          Categories saved here are available in the product creation form for this tenant.
        </div>
      </div>
    );
  }

  function renderCreditPackagesCard() {
    return (
      <div className="card" style={{ alignSelf: 'start', padding: 20 }}>
        <h3 className="section-title" style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Credit Packages</h3>
        <div style={{ color: '#64748b', fontSize: 13, marginTop: 12, marginBottom: 16 }}>
          Add the credit package names you want cashiers to choose from during credit checkout. The selected package is saved on the sale and printed on receipts.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 18 }}>
          <input className="input" placeholder="New credit package" value={newCreditPackageName} onChange={e => setNewCreditPackageName(e.target.value)} style={{ width: '100%', minHeight: 48 }} disabled={savingCreditPackages} />
          <button className="btn btn-primary" type="button" onClick={addCreditPackage} style={{ minWidth: 92, minHeight: 48 }} disabled={savingCreditPackages}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {savingCreditPackages && <Spinner />}
              {savingCreditPackages ? 'Saving…' : 'Add'}
            </span>
          </button>
        </div>
        <div style={{ display: 'grid', gap: 0 }}>
          {(settings.creditPackages || []).map((creditPackage) => (
            <div key={creditPackage} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 18, color: '#0f172a' }}>{creditPackage}</div>
              <button className="btn" type="button" onClick={() => removeCreditPackage(creditPackage)} style={{ minWidth: 96, borderRadius: 14, padding: '10px 14px' }} disabled={savingCreditPackages}>Remove</button>
            </div>
          ))}
          {(!settings.creditPackages || settings.creditPackages.length === 0) && (
            <div style={{ color: '#64748b', padding: '8px 0' }}>No credit packages added yet.</div>
          )}
        </div>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 12 }}>
          Keep the names short so they fit well on receipts, sales records, and credit control filters.
        </div>
      </div>
    );
  }

  async function createFinanceAccount() {
    if (!canManageFinanceAccounts || savingReconciliationAccount) return;
    if (!String(reconciliationForm.name || '').trim()) {
      toast.show('Account name is required', { type: 'error' });
      return;
    }
    if (!reconciliationForm.sharedAcrossBranches && (!Array.isArray(reconciliationForm.branchIds) || reconciliationForm.branchIds.length === 0)) {
      toast.show('Select at least one branch or mark the account as shared', { type: 'error' });
      return;
    }
    try {
      setSavingReconciliationAccount(true);
      const saved = await reconciliationAccountsApi.createReconciliationAccount({
        ...reconciliationForm,
        branchIds: reconciliationForm.sharedAcrossBranches ? [] : reconciliationForm.branchIds
      });
      setReconciliationAccounts((prev) => [...prev, saved].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))));
      setReconciliationForm({
        name: '',
        bankName: '',
        accountName: '',
        accountNumber: '',
        sharedAcrossBranches: false,
        branchIds: []
      });
      toast.show('Finance account created', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to create finance account'), { type: 'error' });
    } finally {
      setSavingReconciliationAccount(false);
    }
  }

  async function editFinanceAccount(account) {
    if (!canManageFinanceAccounts) return;
    const { promptDialog } = await import('../utils/dialogs');
    const name = await promptDialog('Account name', account.name || '');
    if (!name || !String(name).trim()) return;
    const bankName = await promptDialog('Bank name', account.bankName || '');
    const accountName = await promptDialog('Account name on bank record', account.accountName || '');
    const accountNumber = await promptDialog('Account number', account.accountNumber || '');
    const sharedAcrossBranches = window.confirm('Should this account be available to all branches? Click OK for Yes, Cancel for branch-specific.');
    const payload = {
      name: String(name || '').trim(),
      bankName: String(bankName || '').trim(),
      accountName: String(accountName || '').trim(),
      accountNumber: String(accountNumber || '').trim(),
      sharedAcrossBranches,
      branchIds: sharedAcrossBranches ? [] : (Array.isArray(account.branchIds) ? account.branchIds : [])
    };
    try {
      const saved = await reconciliationAccountsApi.updateReconciliationAccount(account._id, payload);
      setReconciliationAccounts((prev) => prev.map((item) => String(item._id) === String(saved._id) ? saved : item));
      toast.show('Finance account updated', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update finance account'), { type: 'error' });
    }
  }

  async function toggleFinanceAccountActive(account) {
    if (!canManageFinanceAccounts) return;
    try {
      const saved = await reconciliationAccountsApi.updateReconciliationAccount(account._id, {
        name: account.name,
        bankName: account.bankName,
        accountName: account.accountName,
        accountNumber: account.accountNumber,
        sharedAcrossBranches: !!account.sharedAcrossBranches,
        branchIds: account.sharedAcrossBranches ? [] : (account.branchIds || []),
        active: !account.active
      });
      setReconciliationAccounts((prev) => prev.map((item) => String(item._id) === String(saved._id) ? saved : item));
      toast.show(saved.active ? 'Account activated' : 'Account deactivated', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update account'), { type: 'error' });
    }
  }

  function renderFinanceAccountsCard() {
    if (!canManageFinanceAccounts) return null;
    return (
      <div className="card" style={{ alignSelf: 'start', padding: 20 }}>
        <h3 className="section-title" style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Finance Accounts</h3>
        <div style={{ color: '#64748b', fontSize: 13, marginTop: 12, marginBottom: 16 }}>
          Create company deposit accounts here. Accounts can be shared by all branches or limited to specific branches, and balances increase only after reconciliation approval.
        </div>
        <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <input className="input" placeholder="Account label" value={reconciliationForm.name} onChange={(e) => setReconciliationForm((prev) => ({ ...prev, name: e.target.value }))} />
            <input className="input" placeholder="Bank name" value={reconciliationForm.bankName} onChange={(e) => setReconciliationForm((prev) => ({ ...prev, bankName: e.target.value }))} />
            <input className="input" placeholder="Bank account name" value={reconciliationForm.accountName} onChange={(e) => setReconciliationForm((prev) => ({ ...prev, accountName: e.target.value }))} />
            <input className="input" placeholder="Account number" value={reconciliationForm.accountNumber} onChange={(e) => setReconciliationForm((prev) => ({ ...prev, accountNumber: e.target.value }))} />
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={reconciliationForm.sharedAcrossBranches} onChange={(e) => setReconciliationForm((prev) => ({ ...prev, sharedAcrossBranches: e.target.checked, branchIds: e.target.checked ? [] : prev.branchIds }))} />
            <span>Available to all branches</span>
          </label>
          {!reconciliationForm.sharedAcrossBranches && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, color: '#64748b' }}>Assign branches</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                {branches.map((branch) => {
                  const checked = reconciliationForm.branchIds.includes(branch.id);
                  return (
                    <label key={branch.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 12px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setReconciliationForm((prev) => ({
                          ...prev,
                          branchIds: e.target.checked
                            ? [...prev.branchIds, branch.id]
                            : prev.branchIds.filter((item) => String(item) !== String(branch.id))
                        }))}
                      />
                      <span>{branch.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <button className="btn btn-primary" type="button" onClick={createFinanceAccount} disabled={savingReconciliationAccount}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {savingReconciliationAccount && <Spinner />}
                {savingReconciliationAccount ? 'Saving…' : 'Create Finance Account'}
              </span>
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 0 }}>
          {reconciliationAccounts.map((account) => (
            <div key={account._id} style={{ padding: '14px 0', borderBottom: '1px solid #e2e8f0', display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{account.name}</div>
                  <div style={{ color: '#64748b', fontSize: 13 }}>
                    {[account.bankName, account.accountName, account.accountNumber].filter(Boolean).join(' • ') || 'No bank details yet'}
                  </div>
                </div>
                <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn" type="button" onClick={() => editFinanceAccount(account)}>Edit</button>
                  <button className="btn" type="button" onClick={() => toggleFinanceAccountActive(account)}>{account.active ? 'Deactivate' : 'Activate'}</button>
                </div>
              </div>
              <div style={{ color: '#475569', fontSize: 13 }}>
                Scope:
                {' '}
                {account.sharedAcrossBranches ? 'All branches' : (branches.filter((branch) => (account.branchIds || []).includes(branch.id)).map((branch) => branch.name).join(', ') || 'No branches')}
              </div>
              <div style={{ color: '#0f172a', fontSize: 13, fontWeight: 700 }}>
                Balance: {formatCurrency(account.balance || 0, settings)}
              </div>
            </div>
          ))}
          {!loadingReconciliationAccounts && reconciliationAccounts.length === 0 && (
            <div style={{ color: '#64748b', padding: '8px 0' }}>No finance accounts added yet.</div>
          )}
        </div>
      </div>
    );
  }

  function addNewBranch() {
    if (!branchName.trim() || !branchCode.trim()) return;
    const currentBranchLimit = tenantQuota?.limits?.maxBranches;
    const currentBranchCount = tenantQuota?.usage?.totalBranches;
    if (currentBranchLimit != null && Number(currentBranchCount || 0) >= Number(currentBranchLimit || 0)) {
      setLimitUpgradeContext({
        ...(tenantQuota || {}),
        resourceType: 'branch',
        limits: tenantQuota?.limits,
        usage: tenantQuota?.usage,
        addOnPricing: tenantQuota?.addOnPricing,
        enabledGateways: tenantQuota?.enabledGateways || [],
        mobileMoneyNetworks: tenantQuota?.mobileMoneyNetworks || []
      });
      return;
    }
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
          .then((saved) => {
            dispatch(updateBranch({
              id: created.id,
              name: saved?.name || created.name,
              code: saved?.code || created.code,
              branchType: saved?.branchType || created.branchType || branchType,
              offline: false,
              syncPending: true
            }));
          })
          .catch((e) => {
            dispatch(removeBranch(created.id));
            if (e?.data?.code === 'TENANT_BRANCH_LIMIT_REACHED') {
              setLimitUpgradeContext({
                ...(tenantQuota || {}),
                ...(e.data || {}),
                limits: e?.data?.limits || tenantQuota?.limits,
                usage: e?.data?.usage || tenantQuota?.usage,
                addOnPricing: e?.data?.addOnPricing || tenantQuota?.addOnPricing,
                enabledGateways: e?.data?.enabledGateways || tenantQuota?.enabledGateways || [],
                mobileMoneyNetworks: e?.data?.mobileMoneyNetworks || tenantQuota?.mobileMoneyNetworks || []
              });
              if (!tenantQuota?.addOnPricing || !tenantQuota?.enabledGateways?.length) {
                void loadTenantQuota();
              }
              return;
            }
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
    const patch = { name: newName.trim() };
    const previous = {
      id: b.id,
      name: b.name,
      code: b.code,
      branchType: b.branchType
    };
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        return;
      }
      dispatch(updateBranch({ id: b.id, name: patch.name, offline: true }));
      try {
        await enqueueHttp({ collection: 'branches', label: 'Branch update', path: `/api/branches/${encodeURIComponent(b.id)}`, method: 'PUT', body: patch });
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
      } catch {
        toast.show('Failed to save offline', { type: 'error' });
      }
      return;
    }
    try {
      dispatch(updateBranch({ id: b.id, name: patch.name }));
      const saved = await branchesApi.update(b.id, patch);
      const latestBranches = await branchesApi.list().catch(() => null);
      dispatch(updateBranch({
        id: b.id,
        name: saved?.name || patch.name,
        code: saved?.code ?? b.code,
        branchType: saved?.branchType || b.branchType
      }));
      if (Array.isArray(latestBranches) && latestBranches.length > 0) {
        dispatch(setBranches(latestBranches));
      }
      toast.show('Branch updated', { type: 'success' });
    } catch (e) {
      dispatch(updateBranch(previous));
      toast.show(String(e?.message || 'Failed to update branch on server'), { type: 'error' });
    }
  }
  
  async function onRemoveBranch(b) {
    if (!canManageBranches) {
      toast.show('Only Admin or SuperAdmin can remove branches', { type: 'error' });
      return;
    }
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Remove branch ${b.name}? It will go to Super Bin and stock quantities will stay unchanged.`);
    if (!ok) return;
    if (!navigator.onLine) {
      if (!offlineBackupAllowed) {
        toast.show('Offline: connect internet and try again.', { type: 'error' });
        return;
      }
      dispatch(removeBranch(b.id));
      try {
        await enqueueHttp({ collection: 'branches', label: 'Branch delete', path: `/api/branches/${encodeURIComponent(b.id)}`, method: 'DELETE', body: {} });
        toast.show('Saved offline. Branch will move to Super Bin when online.', { type: 'success' });
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
      toast.show('Branch moved to Super Bin', { type: 'success' });
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
      <div className="card" style={{ padding: 18, alignSelf: 'start' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div>
            <h3 className="section-title" style={{ margin: 0, fontSize: 18 }}>{title}</h3>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{description}</div>
          </div>
          <div style={{ color: '#64748b', fontSize: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 999, padding: '4px 10px' }}>{groupBranches.length} location(s)</div>
        </div>
        <ul>
          {groupBranches.map(b => (
            <li key={b.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 12, padding: '14px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 18, color: '#0f172a' }}>{b.name} ({b.code})</span>
                <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, ...badgeStyle }}>
                  {String(b.branchType || 'retail')}
                </span>
              </span>
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <button className="btn" onClick={() => onEditBranch(b)} disabled={!canManageBranches || !!removingBranchId} style={{ borderRadius: 14, padding: '10px 14px' }}>Edit</button>
                <button className="btn" onClick={() => onRemoveBranch(b)} disabled={!canManageBranches || b.id === 'main' || !!removingBranchId} style={{ borderRadius: 14, padding: '10px 14px' }}>
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
    <div className="config-page" style={{ padding: 16 }}>
      <div className="config-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Configuration</h1>
          <div className="config-subtitle">Manage branding, invoicing, categories, branches, currency, and tenant behavior from one place.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <OfflineQueueIndicator collection="settings" label="Settings queued" />
          <OfflineQueueIndicator collection="branches" label="Branches queued" />
        </div>
      </div>
      <div className="config-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="config-column" style={{ display: 'grid', gap: 16, alignContent: 'start', alignItems: 'start' }}>
          <div className="card config-panel">
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
            <div className="card config-panel">
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
              <label style={{ display: 'block', marginTop: 8 }}>
                {t('Default Language')}
                <select
                  className="select"
                  value={settings.preferredLanguage || 'en'}
                  onChange={e => dispatch(setPreferredLanguage(e.target.value))}
                  style={{ display: 'block', width: '100%', marginTop: 6 }}
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{t(option.label)}</option>
                  ))}
                </select>
              </label>
              <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>
                {t('Sets the tenant default language. Each signed-in user can still choose a personal language from the top bar.')}
              </div>
              <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <h3 className="section-title" style={{ margin: '0 0 8px 0' }}>Communication Sounds</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block' }}>
                      Message Sound
                      <select
                        className="select"
                        value={settings.chatNotificationSound || 'bright'}
                        onChange={e => setSetting('chatNotificationSound', e.target.value)}
                        style={{ display: 'block', width: '100%', marginTop: 6 }}
                      >
                        {CHAT_SOUND_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        className="btn"
                        type="button"
                        onClick={async () => {
                          try {
                            setTestingChatSound(true);
                            await unlockChatSound().catch(() => {});
                            await playChatSound(settings.chatNotificationSound || 'bright');
                          } catch {
                            toast.show('Unable to play the selected message sound right now.', { type: 'error' });
                          } finally {
                            setTestingChatSound(false);
                          }
                        }}
                        disabled={testingChatSound}
                      >
                        {testingChatSound ? 'Testing...' : 'Test Message Sound'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block' }}>
                      Call Sound
                      <select
                        className="select"
                        value={settings.callNotificationSound || 'bright'}
                        onChange={e => setSetting('callNotificationSound', e.target.value)}
                        style={{ display: 'block', width: '100%', marginTop: 6 }}
                      >
                        {CHAT_SOUND_OPTIONS.map((option) => (
                          <option key={`call-${option.value}`} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        className="btn"
                        type="button"
                        onClick={async () => {
                          try {
                            setTestingCallSound(true);
                            await unlockChatSound().catch(() => {});
                            await startOutgoingCallTone(settings.callNotificationSound || 'bright');
                            window.setTimeout(() => {
                              stopIncomingRingtone();
                              setTestingCallSound(false);
                            }, 2200);
                          } catch {
                            stopIncomingRingtone();
                            setTestingCallSound(false);
                            toast.show('Unable to play the selected call sound right now.', { type: 'error' });
                          }
                        }}
                        disabled={testingCallSound}
                      >
                        {testingCallSound ? 'Testing...' : 'Test Call Sound'}
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>
                  Available here for tenant admins and master superadmin. Message Sound is for new messages. Call Sound is for incoming and outgoing call ringing.
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={{ display: 'block' }}>
                    WebRTC ICE Servers
                    <textarea
                      className="input"
                      rows="4"
                      value={settings.webRtcIceServers || 'stun:stun.l.google.com:19302'}
                      onChange={e => setSetting('webRtcIceServers', e.target.value)}
                      style={{ display: 'block', width: '100%', marginTop: 6 }}
                      placeholder={'stun:stun.l.google.com:19302\nturn:your-turn-server:3478|turnUser|turnPassword'}
                    />
                  </label>
                  <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>
                    One server per line. Use `stun:host:port` for STUN, or `turn:host:port|username|password` for TURN relay support on difficult networks.
                  </div>
                </div>
              </div>
              <label style={{ display: 'block', marginTop: 8 }}>
                Subscription Payment Unavailable Message
                <textarea
                  className="input"
                  rows="3"
                  value={settings.subscriptionPaymentUnavailableMessage || ''}
                  onChange={e => setSetting('subscriptionPaymentUnavailableMessage', e.target.value)}
                  style={{ display: 'block', width: '100%', marginTop: 6 }}
                />
              </label>
              {isMasterSuperAdmin ? (
                <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  <h3 className="section-title" style={{ margin: '0 0 8px 0' }}>System Upgrade Notice</h3>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={!!settings.systemUpgradeNoticeEnabled}
                      onChange={(e) => setSetting('systemUpgradeNoticeEnabled', e.target.checked)}
                    />
                    <span>Show database upgrade notice to tenants</span>
                  </label>
                  <label style={{ display: 'block' }}>
                    Upgrade Notice Title
                    <input
                      className="input"
                      value={settings.systemUpgradeNoticeTitle || ''}
                      onChange={e => setSetting('systemUpgradeNoticeTitle', e.target.value)}
                      style={{ display: 'block', width: '100%', marginTop: 6 }}
                      placeholder="Example: Database Upgrade In Progress"
                    />
                  </label>
                  <label style={{ display: 'block', marginTop: 10 }}>
                    Upgrade Notice Message
                    <textarea
                      className="input"
                      rows="4"
                      value={settings.systemUpgradeNoticeMessage || ''}
                      onChange={e => setSetting('systemUpgradeNoticeMessage', e.target.value)}
                      style={{ display: 'block', width: '100%', marginTop: 6 }}
                      placeholder="Example: A database upgrade is currently in progress. Your data is safe and will continue appearing as the update completes. Thank you for your patience."
                    />
                  </label>
                  <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>
                    Controlled only by master superadmin. When enabled, tenants will see this notice across the app to reassure them during the upgrade.
                  </div>
                </div>
              ) : null}
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
            <div className="card config-panel">
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
          <div className="card config-note-card" style={{ padding: 12, color: '#64748b' }}>
            Receipt uses the Client App Logo (falls back to /clientlogo512.png or /logo512.png).
          </div>
          <div className="card config-panel" style={{ padding: 12 }}>
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
          <div className="card config-panel">
          <h3 className="section-title" style={{ margin: '8px 0' }}>Receipt Settings</h3>
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
          <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Receipt Sections</div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
              Section 1 stays on by default. Turn on the extra sections only when the tenant wants more receipt detail.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input type="checkbox" checked={!!settings.receiptShowPaymentInfo} onChange={e => dispatch(setReceiptShowPaymentInfo(e.target.checked))} />
              <span>Show Section 2: Payment Info</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input type="checkbox" checked={!!settings.receiptShowTaxInfo} onChange={e => dispatch(setReceiptShowTaxInfo(e.target.checked))} />
              <span>Show Section 3: Tax Info</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={!!settings.receiptShowQrSection} onChange={e => dispatch(setReceiptShowQrSection(e.target.checked))} />
              <span>Show Section 4: QR Code and Receipt Link</span>
            </label>
          </div>
          <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Distribution POS Default Print</div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
              Choose what should print automatically after a sale on Distribution POS. Retail POS keeps using the normal receipt flow.
            </div>
            <select
              className="select"
              value={settings.distributionPosDefaultPrintMode || 'receipt'}
              onChange={e => dispatch(setDistributionPosDefaultPrintMode(e.target.value))}
              style={{ display: 'block', width: '100%' }}
            >
              <option value="receipt">Receipt Only</option>
              <option value="invoice">Invoice Only</option>
              <option value="both">Both Receipt and Invoice</option>
            </select>
          </div>
          <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Warehouse POS Default Print</div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
              Choose what should print automatically after a sale on Warehouse POS. Retail POS keeps using the normal receipt flow.
            </div>
            <select
              className="select"
              value={settings.warehousePosDefaultPrintMode || 'receipt'}
              onChange={e => dispatch(setWarehousePosDefaultPrintMode(e.target.value))}
              style={{ display: 'block', width: '100%' }}
            >
              <option value="receipt">Receipt Only</option>
              <option value="invoice">Invoice Only</option>
              <option value="both">Both Receipt and Invoice</option>
            </select>
          </div>
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
          <div className="card config-panel">
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
          <div className="card config-panel">
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
            <div className="card config-panel">
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
                      clearTenantState(auth.user?.tenantId || 'default');
                      localStorage.removeItem('ptSales:state');
                      toast.show('Local data cleared', { type: 'success' });
                    } catch {}
                  }}
                >
                  Clear Local Data
                </button>
              </div>
              {isMasterSuperAdmin ? (
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
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        try {
                          clearApiBase();
                          const next = getDefaultApiBase();
                          setApiBaseState(next);
                          toast.show('API base reset to default', { type: 'success' });
                        } catch {
                          toast.show('Failed to reset API base', { type: 'error' });
                        }
                      }}
                    >
                      Reset API Base
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
          <div className="card config-savebar" style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
                    const payload = buildSettingsPayload();
                    if (Object.keys(payload).length === 0) {
                      toast.show('No settings changes to save', { type: 'success' });
                      return;
                    }
                    await enqueueHttp({ collection: 'settings', label: 'Settings', path: '/api/settings', method: 'PUT', body: payload });
                    toast.show('Saved offline. Will backup when online.', { type: 'success' });
                    return;
                  }
                  const payload = buildSettingsPayload();
                  if (Object.keys(payload).length === 0) {
                    toast.show('No settings changes to save', { type: 'success' });
                    return;
                  }
                  await settingsApi.save(payload);
                  initialSettingsRef.current = { ...(initialSettingsRef.current || {}), ...payload };
                  initialSettingsCapturedRef.current = true;
                  setSettingsSavedPulse(true);
                  setTimeout(() => setSettingsSavedPulse(false), 1600);
                  toast.show('Settings saved', { type: 'success' });
                } catch (e) {
                  toast.show(String(e?.message || 'Failed to save settings'), { type: 'error' });
                } finally {
                  setSavingSettings(false);
                }
              }}
              disabled={savingSettings}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {savingSettings && <Spinner />}
                {savingSettings ? 'Saving…' : settingsSavedPulse ? 'Saved' : 'Save'}
              </span>
            </button>
          </div>
        </div>
        <div className="config-column" style={{ display: 'grid', gap: 16, alignContent: 'start', alignItems: 'start' }}>
          {renderCategoriesCard()}
          {renderCreditPackagesCard()}
          {renderFinanceAccountsCard()}
          <div className="card config-panel" style={{ alignSelf: 'start', width: '100%' }}>
            <h2 className="section-title" style={{ marginBottom: 6, fontSize: 24, fontWeight: 800 }}>Branches</h2>
            <div className="page-subtitle-compact" style={{ marginBottom: 16 }}>
              Manage tenant locations here. Branch changes save instantly and are available immediately across the app.
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
            {tenantQuota ? (
              <div className="stats-grid">
                {branchQuotaCards.map((item) => (
                  <div className="card stat-card" key={item.label}>
                    <div className="stat-label">{item.label}</div>
                    <div className="stat-value" style={{ fontSize: typeof item.value === 'string' && item.value.length > 10 ? 20 : undefined }}>{item.value}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="stats-grid">
              <div className="card stat-card">
                <div className="stat-label">Retail Branches</div>
                <div className="stat-value">{branches.filter(b => String(b.branchType || 'retail').toLowerCase() === 'retail').length}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Distribution Shops</div>
                <div className="stat-value" style={{ color: '#1d4ed8' }}>{branches.filter(b => String(b.branchType || 'retail').toLowerCase() === 'wholesale').length}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Warehouses</div>
                <div className="stat-value" style={{ color: '#6d28d9' }}>{branches.filter(b => String(b.branchType || 'retail').toLowerCase() === 'warehouse').length}</div>
              </div>
            </div>
            <div className="surface-panel">
              <label>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Current Branch</div>
                <div className="section-note" style={{ marginBottom: 10 }}>Choose the default active branch for this user session.</div>
                <select className="select" value={settings.currentBranchId} onChange={e => dispatch(setCurrentBranch(e.target.value))} style={{ display: 'block', width: '100%', marginTop: 6 }}>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            </div>
            <div className="surface-panel">
              <h3 className="section-title" style={{ margin: '0 0 8px 0', fontSize: 18 }}>Create Location</h3>
              <div className="section-note" style={{ marginBottom: 12 }}>Create retail branches, wholesale shops, or warehouse locations from here. Saves immediately.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
                <input className="input" placeholder="Branch name" value={branchName} onChange={e => setBranchName(e.target.value)} disabled={!canManageBranches} />
                <input className="input" placeholder="Code" value={branchCode} onChange={e => setBranchCode(e.target.value)} disabled={!canManageBranches} />
                <select className="select" value={branchType} onChange={e => setBranchType(e.target.value)} disabled={!canManageBranches}>
                  <option value="retail">Retail</option>
                  <option value="wholesale">Wholesale</option>
                  <option value="warehouse">Warehouse</option>
                </select>
                <button className="btn btn-primary" onClick={addNewBranch} disabled={!canManageBranches || addingBranch} style={{ minWidth: 110 }}>
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
      <TenantLimitUpgradeModal
        open={!!limitUpgradeContext}
        onClose={() => setLimitUpgradeContext(null)}
        context={limitUpgradeContext}
        resourceType="branch"
        toast={toast}
      />
    </div>
  );
}

export default ConfigSettingsPage;
