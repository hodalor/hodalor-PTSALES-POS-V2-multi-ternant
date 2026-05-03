import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import * as tenantsApi from '../api/tenants';
import { useToast } from '../components/ToastProvider';
import Modal from '../components/Modal';
import { TENANT_SIDEBAR_SECTIONS } from '../utils/tenantAccess';
import { formatDurationMs, importTenantTransferInSteps, parseTenantTransferFile, summarizeTenantImportResults } from '../utils/tenantTransfer';
import LoadingDots from '../components/LoadingDots';

const DEFAULT_SUBSCRIPTION_MANAGEMENT = {
  plans: [
    { key: 'basic', label: 'Basic', monthlyAmount: 0, features: [] },
    { key: 'pro', label: 'Pro', monthlyAmount: 0, features: [] },
    { key: 'enterprise', label: 'Enterprise', monthlyAmount: 0, features: [] }
  ],
  periods: [
    { months: 1, discountPercent: 0 },
    { months: 3, discountPercent: 0 },
    { months: 6, discountPercent: 0 },
    { months: 12, discountPercent: 0 }
  ]
};

function calculateDiscountedAmount(monthlyAmount, months, discountPercent) {
  const base = Number(monthlyAmount || 0) * Number(months || 0);
  const discount = Number(discountPercent || 0);
  const amount = base - ((base * discount) / 100);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
}

function calculateDiscountPercent(monthlyAmount, months, amount) {
  const base = Number(monthlyAmount || 0) * Number(months || 0);
  const total = Number(amount || 0);
  if (!base || !Number.isFinite(total)) return 0;
  return Number((((base - total) / base) * 100).toFixed(4));
}

function getPlanFeaturesFromConfig(config, planKey) {
  const key = String(planKey || '').trim().toLowerCase();
  return (config?.plans || []).find((plan) => String(plan.key) === key)?.features || [];
}

const EMPTY_FORM = {
  tenantId: '',
  name: '',
  subscriptionPlan: 'basic',
  clientAppName: '',
  themeColor: '#16a34a',
  subscriptionExpiresAt: '',
  subscriptionPermanent: false,
  subscriptionAmount: '',
  activationCode: '',
  activationCodeExpiresAt: '',
  renewalHistory: [],
  paymentHistory: [],
  billingEmail: '',
  billingPhone: '',
  billingAddress: '',
  billingCountry: 'GH',
  adminName: '',
  adminPin: '',
  maxUserAccountsOverride: '',
  maxActiveUsersOverride: '',
  features: []
};

function TenantsPage() {
  const toast = useToast();
  const settings = useSelector((s) => s.settings);
  const [activeTab, setActiveTab] = useState('tenants');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [runningAudit, setRunningAudit] = useState(false);
  const [cleaningAuditKey, setCleaningAuditKey] = useState('');
  const [refreshingActivation, setRefreshingActivation] = useState(false);
  const [editing, setEditing] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [userAudit, setUserAudit] = useState({ scannedTenants: 0, duplicateCount: 0, duplicateUserNames: [] });
  const [limitDefaults, setLimitDefaults] = useState({
    basic: { maxUserAccounts: '', maxActiveUsers: '' },
    pro: { maxUserAccounts: '', maxActiveUsers: '' },
    enterprise: { maxUserAccounts: '', maxActiveUsers: '' }
  });
  const [paymentManagement, setPaymentManagement] = useState({ gateways: [], enabledGateways: [], paymentHistory: [], summary: { totalCollected: 0, transactionCount: 0, cardCollected: 0, mobileMoneyCollected: 0, gatewayCount: 0 } });
  const [savingPaymentManagement, setSavingPaymentManagement] = useState(false);
  const [paymentFilters, setPaymentFilters] = useState({ provider: 'all', channel: 'all', tenantId: 'all', search: '' });
  const [subscriptionManagement, setSubscriptionManagement] = useState(DEFAULT_SUBSCRIPTION_MANAGEMENT);
  const [savingSubscriptionManagement, setSavingSubscriptionManagement] = useState(false);
  const [selectedPlanKey, setSelectedPlanKey] = useState('basic');
  const [tenantTransferLoading, setTenantTransferLoading] = useState('');
  const [tenantImportTarget, setTenantImportTarget] = useState(null);
  const [tenantImportMode, setTenantImportMode] = useState('keep_current');
  const [tenantImportPayload, setTenantImportPayload] = useState(null);
  const [tenantImportSummary, setTenantImportSummary] = useState(null);
  const [tenantImportProgress, setTenantImportProgress] = useState(null);
  const [lastTenantImportSummary, setLastTenantImportSummary] = useState(null);
  const tenantImportInputRef = useRef(null);

  const sections = useMemo(() => TENANT_SIDEBAR_SECTIONS, []);
  const filteredPaymentRows = useMemo(() => {
    const rowsList = Array.isArray(paymentManagement.paymentHistory) ? paymentManagement.paymentHistory : [];
    const provider = String(paymentFilters.provider || 'all');
    const channel = String(paymentFilters.channel || 'all');
    const tenantId = String(paymentFilters.tenantId || 'all');
    const search = String(paymentFilters.search || '').trim().toLowerCase();
    return rowsList.filter((row) => {
      if (provider !== 'all' && String(row.provider || '') !== provider) return false;
      if (channel !== 'all' && String(row.channel || '') !== channel) return false;
      if (tenantId !== 'all' && String(row.tenantId || '') !== tenantId) return false;
      if (search) {
        const hay = `${row.tenantId || ''} ${row.tenantName || ''} ${row.transactionRef || ''} ${row.provider || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [paymentFilters, paymentManagement.paymentHistory]);

  const paymentSummary = useMemo(() => {
    const totalCollected = filteredPaymentRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const cardCollected = filteredPaymentRows.filter((row) => row.channel === 'card').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const mobileMoneyCollected = filteredPaymentRows.filter((row) => row.channel === 'mobile_money').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    return {
      totalCollected,
      transactionCount: filteredPaymentRows.length,
      cardCollected,
      mobileMoneyCollected,
      gatewayCount: Array.from(new Set(filteredPaymentRows.map((row) => row.provider).filter(Boolean))).length
    };
  }, [filteredPaymentRows]);
  const tenantSummary = useMemo(() => ({
    total: rows.length,
    active: rows.filter((row) => row.subscriptionPermanent || !row.subscriptionExpiresAt || new Date(row.subscriptionExpiresAt).getTime() >= Date.now()).length,
    permanent: rows.filter((row) => Boolean(row.subscriptionPermanent)).length,
    expiringSoon: rows.filter((row) => row.subscriptionExpiresAt && !row.subscriptionPermanent && new Date(row.subscriptionExpiresAt).getTime() >= Date.now() && new Date(row.subscriptionExpiresAt).getTime() <= (Date.now() + 7 * 24 * 3600 * 1000)).length,
    expired: rows.filter((row) => row.subscriptionExpiresAt && !row.subscriptionPermanent && new Date(row.subscriptionExpiresAt).getTime() < Date.now()).length
  }), [rows]);

  const planOptions = useMemo(() => (subscriptionManagement?.plans || []).map((plan) => plan.key), [subscriptionManagement]);
  const selectedPlan = useMemo(() => (subscriptionManagement?.plans || []).find((plan) => String(plan.key) === String(selectedPlanKey)) || subscriptionManagement.plans?.[0] || null, [selectedPlanKey, subscriptionManagement]);
  const subscriptionCurrencyCode = String(settings?.activeCurrencyCode || settings?.currencyCode || 'GHS');
  const subscriptionCurrencySymbol = String(settings?.currencySymbol || '');
  const subscriptionCurrencyPosition = String(settings?.currencyPosition || 'prefix');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantRows, defaults, paymentData, subscriptionData] = await Promise.all([tenantsApi.list(), tenantsApi.getLimitDefaults(), tenantsApi.getPaymentManagement(), tenantsApi.getSubscriptionManagement()]);
      setRows(tenantRows);
      setLimitDefaults({
        basic: { maxUserAccounts: defaults?.basic?.maxUserAccounts ?? '', maxActiveUsers: defaults?.basic?.maxActiveUsers ?? '' },
        pro: { maxUserAccounts: defaults?.pro?.maxUserAccounts ?? '', maxActiveUsers: defaults?.pro?.maxActiveUsers ?? '' },
        enterprise: { maxUserAccounts: defaults?.enterprise?.maxUserAccounts ?? '', maxActiveUsers: defaults?.enterprise?.maxActiveUsers ?? '' }
      });
      setPaymentManagement(paymentData || { gateways: [], enabledGateways: [], paymentHistory: [], summary: { totalCollected: 0, transactionCount: 0, cardCollected: 0, mobileMoneyCollected: 0, gatewayCount: 0 } });
      const nextSubscription = subscriptionData || DEFAULT_SUBSCRIPTION_MANAGEMENT;
      setSubscriptionManagement(nextSubscription);
      setSelectedPlanKey(String(nextSubscription?.plans?.[0]?.key || 'basic'));
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load tenants'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  function formatSubscriptionMoney(value) {
    const numeric = Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return subscriptionCurrencyPosition === 'suffix'
      ? `${numeric} ${subscriptionCurrencySymbol || subscriptionCurrencyCode}`.trim()
      : `${subscriptionCurrencySymbol || subscriptionCurrencyCode}${numeric}`.trim();
  }

  function downloadJsonFile(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function setValue(key, value) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === 'subscriptionPlan' ? { features: getPlanFeaturesFromConfig(subscriptionManagement, value) } : {})
    }));
  }

  function resetForm(nextPlan = 'basic') {
    setEditing('');
    setForm({ ...EMPTY_FORM, themeColor: '#16a34a', subscriptionPlan: nextPlan, features: getPlanFeaturesFromConfig(subscriptionManagement, nextPlan) });
  }

  function openCreateModal() {
    resetForm(planOptions[0] || 'basic');
    setShowForm(true);
  }

  function closeModal() {
    setShowForm(false);
    resetForm(planOptions[0] || 'basic');
  }

  async function exportTenantBackup(row) {
    const key = `export:${row.tenantId}`;
    setTenantTransferLoading(key);
    try {
      const data = await tenantsApi.exportTenantData(row.tenantId);
      downloadJsonFile(`${row.tenantId}-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`, data);
      toast.show(`Exported tenant data for ${row.tenantId}`, { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to export tenant data'), { type: 'error' });
    } finally {
      setTenantTransferLoading('');
    }
  }

  function openTenantImport(row) {
    setTenantImportTarget(row);
    setTenantImportMode('keep_current');
    setTenantImportPayload(null);
    setTenantImportSummary(null);
    setTenantImportProgress(null);
    setLastTenantImportSummary(null);
    if (tenantImportInputRef.current) tenantImportInputRef.current.value = '';
  }

  async function onTenantImportFileChange(file) {
    setTenantImportPayload(null);
    setTenantImportSummary(null);
    setTenantImportProgress(null);
    if (!file) return;
    try {
      const parsed = await parseTenantTransferFile(file);
      setTenantImportPayload(parsed.raw);
      setTenantImportSummary(parsed.summary);
      setLastTenantImportSummary(null);
    } catch (e) {
      toast.show(String(e?.message || 'Invalid backup file'), { type: 'error' });
      if (tenantImportInputRef.current) tenantImportInputRef.current.value = '';
    }
  }

  async function importTenantBackup() {
    if (!tenantImportTarget) return;
    if (!tenantImportPayload) {
      toast.show('Choose a backup file first', { type: 'error' });
      return;
    }
    const key = `import:${tenantImportTarget.tenantId}`;
    setTenantTransferLoading(key);
    try {
      const result = await importTenantTransferInSteps({
        payload: tenantImportPayload,
        mode: tenantImportMode,
        importFn: (payload) => tenantsApi.importTenantData(tenantImportTarget.tenantId, payload),
        onProgress: setTenantImportProgress
      });
      setLastTenantImportSummary({
        tenantId: tenantImportTarget.tenantId,
        mode: tenantImportMode,
        completedAt: new Date().toISOString(),
        summary: summarizeTenantImportResults(result.steps)
      });
      toast.show(`Imported tenant data for ${tenantImportTarget.tenantId}`, { type: 'success' });
      setTenantImportTarget(null);
      setTenantImportPayload(null);
      setTenantImportSummary(null);
      setTenantImportProgress(null);
      if (tenantImportInputRef.current) tenantImportInputRef.current.value = '';
      await load();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to import tenant data'), { type: 'error' });
    } finally {
      setTenantTransferLoading('');
    }
  }

  function daysLeftLabel(value) {
    if (!value) return 'No expiry set';
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return 'Invalid date';
    const days = Math.ceil((ts - Date.now()) / (24 * 3600 * 1000));
    if (days < 0) return `Expired ${Math.abs(days)} day(s) ago`;
    if (days === 0) return 'Expires today';
    return `${days} day(s) left`;
  }

  function hasAll(keys) {
    const set = new Set(form.features || []);
    return keys.every((key) => set.has(key));
  }

  function toggleKeys(keys, checked) {
    setForm((prev) => {
      const set = new Set(prev.features || []);
      const shouldEnable = typeof checked === 'boolean' ? checked : !keys.every((key) => set.has(key));
      keys.forEach((key) => {
        if (shouldEnable) set.add(key);
        else set.delete(key);
      });
      return { ...prev, features: Array.from(set) };
    });
  }

  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        tenantId: form.tenantId,
        name: form.name,
        subscriptionPlan: form.subscriptionPlan,
        clientAppName: form.clientAppName,
        themeColor: form.themeColor,
        subscriptionExpiresAt: form.subscriptionExpiresAt || null,
        subscriptionPermanent: !!form.subscriptionPermanent,
        subscriptionAmount: form.subscriptionAmount === '' ? null : Number(form.subscriptionAmount),
        billingEmail: form.billingEmail,
        billingPhone: form.billingPhone,
        billingAddress: form.billingAddress,
        billingCountry: form.billingCountry,
        adminName: form.adminName,
        adminPin: form.adminPin,
        maxUserAccountsOverride: form.maxUserAccountsOverride === '' ? null : Number(form.maxUserAccountsOverride),
        maxActiveUsersOverride: form.maxActiveUsersOverride === '' ? null : Number(form.maxActiveUsersOverride),
        features: form.features
      };
      if (editing) {
        await tenantsApi.update(editing, payload);
        if (form.adminName && form.adminPin) {
          await tenantsApi.setAdmin(editing, { adminName: form.adminName, adminPin: form.adminPin });
        }
        toast.show('Tenant updated', { type: 'success' });
      } else {
        await tenantsApi.create(payload);
        toast.show('Tenant created', { type: 'success' });
      }
      closeModal();
      await load();
    } catch (e2) {
      toast.show(String(e2?.message || 'Failed to save tenant'), { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row) {
    setEditing(String(row.tenantId || ''));
    setForm({
      tenantId: String(row.tenantId || ''),
      name: String(row.name || ''),
      subscriptionPlan: String(row.subscriptionPlan || 'basic'),
      clientAppName: String(row.clientAppName || ''),
      themeColor: String(row.themeColor || '#16a34a'),
      subscriptionExpiresAt: row.subscriptionExpiresAt ? String(row.subscriptionExpiresAt).slice(0, 10) : '',
      subscriptionPermanent: !!row.subscriptionPermanent,
      subscriptionAmount: row.subscriptionAmount ?? '',
      activationCode: String(row.activationCode || ''),
      activationCodeExpiresAt: row.activationCodeExpiresAt ? String(row.activationCodeExpiresAt) : '',
      renewalHistory: Array.isArray(row.renewalHistory) ? row.renewalHistory : [],
      paymentHistory: Array.isArray(row.paymentHistory) ? row.paymentHistory : [],
      billingEmail: String(row.billingEmail || ''),
      billingPhone: String(row.billingPhone || ''),
      billingAddress: String(row.billingAddress || ''),
      billingCountry: String(row.billingCountry || 'GH'),
      adminName: '',
      adminPin: '',
      maxUserAccountsOverride: row.maxUserAccountsOverride ?? '',
      maxActiveUsersOverride: row.maxActiveUsersOverride ?? '',
      features: Array.isArray(row.features) ? row.features : []
    });
    setShowForm(true);
  }

  function setLimitDefault(plan, key, value) {
    setLimitDefaults((prev) => ({
      ...prev,
      [plan]: { ...(prev[plan] || {}), [key]: value }
    }));
  }

  async function saveLimitDefaults() {
    if (savingDefaults) return;
    setSavingDefaults(true);
    try {
      const payload = {
        basic: {
          maxUserAccounts: limitDefaults.basic.maxUserAccounts === '' ? null : Number(limitDefaults.basic.maxUserAccounts),
          maxActiveUsers: limitDefaults.basic.maxActiveUsers === '' ? null : Number(limitDefaults.basic.maxActiveUsers)
        },
        pro: {
          maxUserAccounts: limitDefaults.pro.maxUserAccounts === '' ? null : Number(limitDefaults.pro.maxUserAccounts),
          maxActiveUsers: limitDefaults.pro.maxActiveUsers === '' ? null : Number(limitDefaults.pro.maxActiveUsers)
        },
        enterprise: {
          maxUserAccounts: limitDefaults.enterprise.maxUserAccounts === '' ? null : Number(limitDefaults.enterprise.maxUserAccounts),
          maxActiveUsers: limitDefaults.enterprise.maxActiveUsers === '' ? null : Number(limitDefaults.enterprise.maxActiveUsers)
        }
      };
      const saved = await tenantsApi.updateLimitDefaults(payload);
      setLimitDefaults({
        basic: { maxUserAccounts: saved?.basic?.maxUserAccounts ?? '', maxActiveUsers: saved?.basic?.maxActiveUsers ?? '' },
        pro: { maxUserAccounts: saved?.pro?.maxUserAccounts ?? '', maxActiveUsers: saved?.pro?.maxActiveUsers ?? '' },
        enterprise: { maxUserAccounts: saved?.enterprise?.maxUserAccounts ?? '', maxActiveUsers: saved?.enterprise?.maxActiveUsers ?? '' }
      });
      toast.show('Tenant user limits updated', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to save limits'), { type: 'error' });
    } finally {
      setSavingDefaults(false);
    }
  }

  async function runUserAudit() {
    if (runningAudit) return;
    setRunningAudit(true);
    try {
      const report = await tenantsApi.runUserAudit();
      setUserAudit({
        scannedTenants: Number(report?.scannedTenants || 0),
        duplicateCount: Number(report?.duplicateCount || 0),
        duplicateUserNames: Array.isArray(report?.duplicateUserNames) ? report.duplicateUserNames : []
      });
      toast.show('Tenant user audit completed', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to run tenant user audit'), { type: 'error' });
    } finally {
      setRunningAudit(false);
    }
  }

  async function cleanupAuditOccurrence(tenantId, userName) {
    const key = `${tenantId}:${userName}`;
    if (cleaningAuditKey) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Remove user ${userName} from tenant ${tenantId}?`);
    if (!ok) return;
    setCleaningAuditKey(key);
    try {
      await tenantsApi.cleanupUserAuditRecord({ tenantId, userName });
      setUserAudit((prev) => {
        const nextGroups = (prev.duplicateUserNames || [])
          .map((group) => ({
            ...group,
            occurrences: (group.occurrences || []).filter((occ) => !(String(occ.tenantId) === String(tenantId) && String(group.userName) === String(userName)))
          }))
          .filter((group) => (group.occurrences || []).length > 1);
        return {
          ...prev,
          duplicateUserNames: nextGroups,
          duplicateCount: nextGroups.length
        };
      });
      toast.show(`Removed ${userName} from ${tenantId}`, { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to clean audit record'), { type: 'error' });
    } finally {
      setCleaningAuditKey('');
    }
  }

  async function refreshActivationCodeForCurrentTenant() {
    if (!editing || refreshingActivation) return;
    setRefreshingActivation(true);
    try {
      const updated = await tenantsApi.refreshActivationCode(editing);
      setForm((prev) => ({
        ...prev,
        activationCode: String(updated?.activationCode || ''),
        activationCodeExpiresAt: updated?.activationCodeExpiresAt ? String(updated.activationCodeExpiresAt) : ''
      }));
      setRows((prev) => prev.map((row) => String(row.tenantId) === String(editing) ? { ...row, ...updated } : row));
      toast.show('Activation code refreshed', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to refresh activation code'), { type: 'error' });
    } finally {
      setRefreshingActivation(false);
    }
  }

  function applyPlanDefaults() {
    setForm((prev) => ({ ...prev, features: getPlanFeaturesFromConfig(subscriptionManagement, prev.subscriptionPlan) }));
  }

  async function togglePaymentGateway(gatewayKey, enabled) {
    if (savingPaymentManagement) return;
    const current = Array.isArray(paymentManagement.enabledGateways) ? paymentManagement.enabledGateways : [];
    const next = enabled
      ? Array.from(new Set([...current, gatewayKey]))
      : current.filter((item) => String(item) !== String(gatewayKey));
    setSavingPaymentManagement(true);
    try {
      const updated = await tenantsApi.updatePaymentManagement({ enabledGateways: next });
      setPaymentManagement(updated);
      toast.show('Payment management updated', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update payment management'), { type: 'error' });
    } finally {
      setSavingPaymentManagement(false);
    }
  }

  function setPaymentFilter(key, value) {
    setPaymentFilters((prev) => ({ ...prev, [key]: value }));
  }

  function updateSubscriptionPlanField(planKey, field, value) {
    setSubscriptionManagement((prev) => ({
      ...prev,
      plans: (prev.plans || []).map((plan) => String(plan.key) === String(planKey) ? { ...plan, [field]: field === 'monthlyAmount' ? value : value } : plan)
    }));
  }

  function hasPlanAll(planKey, keys) {
    const plan = (subscriptionManagement.plans || []).find((item) => String(item.key) === String(planKey));
    const set = new Set(plan?.features || []);
    return (Array.isArray(keys) ? keys : []).every((key) => set.has(key));
  }

  function togglePlanKeys(planKey, keys, checked) {
    setSubscriptionManagement((prev) => ({
      ...prev,
      plans: (prev.plans || []).map((plan) => {
        if (String(plan.key) !== String(planKey)) return plan;
        const set = new Set(plan.features || []);
        const list = Array.isArray(keys) ? keys.filter(Boolean) : [];
        const shouldEnable = typeof checked === 'boolean' ? checked : !list.every((key) => set.has(key));
        list.forEach((key) => {
          if (shouldEnable) set.add(key);
          else set.delete(key);
        });
        return { ...plan, features: Array.from(set) };
      })
    }));
  }

  function addSubscriptionPlan() {
    const nextKey = `plan_${Date.now()}`;
    setSubscriptionManagement((prev) => ({
      ...prev,
      plans: [...(prev.plans || []), { key: nextKey, label: 'New Plan', monthlyAmount: 0, features: [] }]
    }));
    setSelectedPlanKey(nextKey);
  }

  function removeSubscriptionPlan(planKey) {
    setSubscriptionManagement((prev) => ({
      ...prev,
      plans: (prev.plans || []).filter((plan) => String(plan.key) !== String(planKey))
    }));
    if (selectedPlanKey === planKey) {
      const remaining = (subscriptionManagement.plans || []).filter((plan) => String(plan.key) !== String(planKey));
      setSelectedPlanKey(String(remaining[0]?.key || ''));
    }
  }

  function updateSubscriptionPeriod(monthsValue, patch) {
    setSubscriptionManagement((prev) => ({
      ...prev,
      periods: (prev.periods || []).map((period) => Number(period.months) === Number(monthsValue) ? { ...period, ...patch } : period)
    }));
  }

  function addSubscriptionPeriod() {
    setSubscriptionManagement((prev) => ({
      ...prev,
      periods: [...(prev.periods || []), { months: (prev.periods || []).length + 1, discountPercent: 0 }]
    }));
  }

  function removeSubscriptionPeriod(monthsValue) {
    setSubscriptionManagement((prev) => ({
      ...prev,
      periods: (prev.periods || []).filter((period) => Number(period.months) !== Number(monthsValue))
    }));
  }

  async function saveSubscriptionManagement() {
    if (savingSubscriptionManagement) return;
    const months = (subscriptionManagement.periods || []).map((period) => Number(period.months || 0));
    const monthSet = new Set(months);
    if (months.some((value) => !Number.isFinite(value) || value < 1)) {
      toast.show('Each subscription period must have a valid month value', { type: 'error' });
      return;
    }
    if (monthSet.size !== months.length) {
      toast.show('Duplicate month rows are not allowed', { type: 'error' });
      return;
    }
    setSavingSubscriptionManagement(true);
    try {
      const payload = {
        plans: (subscriptionManagement.plans || []).map((plan) => ({
          key: plan.key,
          label: plan.label,
          monthlyAmount: plan.monthlyAmount === '' ? 0 : Number(plan.monthlyAmount || 0),
          features: Array.isArray(plan.features) ? plan.features : []
        })),
        periods: (subscriptionManagement.periods || []).map((period) => ({
          months: Number(period.months || 0),
          discountPercent: Number(period.discountPercent || 0)
        }))
      };
      const saved = await tenantsApi.updateSubscriptionManagement(payload);
      setSubscriptionManagement(saved || DEFAULT_SUBSCRIPTION_MANAGEMENT);
      if (!saved?.plans?.some((plan) => String(plan.key) === String(selectedPlanKey))) {
        setSelectedPlanKey(String(saved?.plans?.[0]?.key || ''));
      }
      toast.show('Subscription management updated', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update subscription management'), { type: 'error' });
    } finally {
      setSavingSubscriptionManagement(false);
    }
  }

  return (
    <div className="page-shell" style={{ gap: 16 }}>
      <div className="page-header">
        <div>
        <h1 style={{ marginBottom: 6 }}>Tenants</h1>
        <div className="page-subtitle-compact">Create companies, assign plans, manage payment and renewal settings, and override tenant features from one master control.</div>
        </div>
        {activeTab === 'tenants' ? <button className="btn btn-primary" onClick={openCreateModal}>Add Tenant</button> : null}
      </div>

      <div className="page-tabs">
        <button className="btn" type="button" style={{ background: activeTab === 'tenants' ? '#eff6ff' : undefined, borderColor: activeTab === 'tenants' ? '#1d4ed8' : undefined, color: activeTab === 'tenants' ? '#1d4ed8' : undefined }} onClick={() => setActiveTab('tenants')}>Tenants</button>
        <button className="btn" type="button" style={{ background: activeTab === 'subscription_management' ? '#eff6ff' : undefined, borderColor: activeTab === 'subscription_management' ? '#1d4ed8' : undefined, color: activeTab === 'subscription_management' ? '#1d4ed8' : undefined }} onClick={() => setActiveTab('subscription_management')}>Subscription Management</button>
        <button className="btn" type="button" style={{ background: activeTab === 'payment_management' ? '#eff6ff' : undefined, borderColor: activeTab === 'payment_management' ? '#1d4ed8' : undefined, color: activeTab === 'payment_management' ? '#1d4ed8' : undefined }} onClick={() => setActiveTab('payment_management')}>Payment Management</button>
      </div>

      {activeTab === 'tenants' ? (
        <div className="stats-grid">
          <div className="card stat-card"><div className="stat-label">Total Tenants</div><div className="stat-value">{tenantSummary.total}</div></div>
          <div className="card stat-card"><div className="stat-label">Active</div><div className="stat-value">{tenantSummary.active}</div></div>
          <div className="card stat-card"><div className="stat-label">Permanent</div><div className="stat-value">{tenantSummary.permanent}</div></div>
          <div className="card stat-card"><div className="stat-label">Expiring In 7 Days</div><div className="stat-value">{tenantSummary.expiringSoon}</div></div>
          <div className="card stat-card"><div className="stat-label">Expired</div><div className="stat-value">{tenantSummary.expired}</div></div>
        </div>
      ) : null}

      {activeTab === 'subscription_management' ? (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h2 className="section-title">Subscription Plans</h2>
                <div style={{ color: '#64748b' }}>Create plans, control default monthly amount, and edit plan features.</div>
              </div>
              <button className="btn btn-primary" type="button" onClick={addSubscriptionPlan}>Add Plan</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                {(subscriptionManagement.plans || []).map((plan) => (
                  <button
                    key={plan.key}
                    type="button"
                    className="btn"
                    style={{ textAlign: 'left', justifyContent: 'flex-start', alignItems: 'flex-start', padding: '12px 14px', minHeight: 'unset', height: 'auto', background: selectedPlanKey === plan.key ? '#eff6ff' : '#fff', borderColor: selectedPlanKey === plan.key ? '#1d4ed8' : '#e2e8f0', color: '#0f172a' }}
                    onClick={() => setSelectedPlanKey(plan.key)}
                  >
                    <span>
                      <strong>{plan.label}</strong><br />
                      <span style={{ color: '#64748b', fontSize: 12 }}>{plan.key} • {formatSubscriptionMoney(plan.monthlyAmount || 0)} / month</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="card" style={{ padding: 14, border: '1px solid #e2e8f0' }}>
                {selectedPlan ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, marginBottom: 14 }}>
                      <label>
                        Plan Key
                        <input className="input" value={selectedPlan.key} onChange={(e) => updateSubscriptionPlanField(selectedPlan.key, 'key', e.target.value)} />
                      </label>
                      <label>
                        Plan Label
                        <input className="input" value={selectedPlan.label} onChange={(e) => updateSubscriptionPlanField(selectedPlan.key, 'label', e.target.value)} />
                      </label>
                      <div style={{ alignSelf: 'end' }}>
                        <button className="btn" type="button" style={{ color: '#b91c1c' }} onClick={() => removeSubscriptionPlan(selectedPlan.key)}>Remove</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 12, marginBottom: 14 }}>
                      <label>
                        Monthly Amount
                        <input className="input" type="number" min="0" step="0.01" value={selectedPlan.monthlyAmount} onChange={(e) => updateSubscriptionPlanField(selectedPlan.key, 'monthlyAmount', e.target.value)} />
                      </label>
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {sections.map((section) => {
                        const sectionKeys = Array.from(new Set([section.sectionKey, ...section.items.flatMap((item) => item.keys || [])].filter(Boolean)));
                        const hasAllFeatures = hasPlanAll(selectedPlan.key, sectionKeys);
                        const hasSomeFeatures = (sectionKeys || []).some((key) => (selectedPlan.features || []).includes(key));
                        return (
                          <div key={section.title} className="card" style={{ padding: 12, border: '1px solid #e2e8f0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                              <span style={{ fontWeight: 700 }}>{section.title}</span>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn" type="button" onClick={() => togglePlanKeys(selectedPlan.key, sectionKeys, true)} disabled={hasAllFeatures}>Select All</button>
                                <button className="btn" type="button" onClick={() => togglePlanKeys(selectedPlan.key, sectionKeys, false)} disabled={!hasSomeFeatures}>Clear All</button>
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                              {(section.items || []).map((item) => {
                                const itemKeys = item.keys || [];
                                const checked = hasPlanAll(selectedPlan.key, itemKeys);
                                return (
                                  <label key={`${section.id}:${item.label}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: checked ? '1px solid #1d4ed8' : '1px solid #e2e8f0', borderRadius: 10, background: checked ? '#eff6ff' : '#fff' }}>
                                    <input type="checkbox" checked={checked} onChange={(e) => togglePlanKeys(selectedPlan.key, itemKeys, e.target.checked)} />
                                    <span>{item.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : <div style={{ color: '#64748b' }}>Select a plan to edit.</div>}
              </div>
            </div>
          </div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h2 className="section-title">Renewal Periods</h2>
                <div style={{ color: '#64748b' }}>Set months and discount %. You can also edit the payable amount directly and the discount will auto-adjust from the selected plan monthly amount.</div>
              </div>
              <button className="btn" type="button" onClick={addSubscriptionPeriod}>Add Period</button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th align="left">Months</th>
                  <th align="left">Discount %</th>
                  <th align="left">Amount After Discount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(subscriptionManagement.periods || []).map((period, index) => {
                  const monthlyAmount = Number(selectedPlan?.monthlyAmount || 0);
                  const amount = calculateDiscountedAmount(monthlyAmount, period.months, period.discountPercent);
                  return (
                    <tr key={`${period.months}:${index}`}>
                      <td><input className="input" type="number" min="1" value={period.months} onChange={(e) => updateSubscriptionPeriod(period.months, { months: Number(e.target.value || 1) })} /></td>
                      <td><input className="input" type="number" step="0.0001" value={period.discountPercent} onChange={(e) => updateSubscriptionPeriod(period.months, { discountPercent: Number(e.target.value || 0) })} /></td>
                      <td>
                        <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => updateSubscriptionPeriod(period.months, { discountPercent: calculateDiscountPercent(monthlyAmount, period.months, Number(e.target.value || 0)) })} />
                        <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{formatSubscriptionMoney(amount)}</div>
                      </td>
                      <td><button className="btn" type="button" style={{ color: '#b91c1c' }} onClick={() => removeSubscriptionPeriod(period.months)}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-primary" type="button" onClick={saveSubscriptionManagement} disabled={savingSubscriptionManagement}>{savingSubscriptionManagement ? 'Saving…' : 'Save Subscription Management'}</button>
            </div>
          </div>
          <div className="card">
            <h2 className="section-title">Default User Limits By Plan</h2>
            <div style={{ color: '#64748b', marginBottom: 12 }}>
              Set general limits for each package. Leave blank for unlimited. Each tenant can still override these values individually.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              {Object.keys(limitDefaults).map((plan) => (
                <div key={plan} className="card" style={{ padding: 14, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 800, marginBottom: 10, textTransform: 'capitalize' }}>{plan}</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <label>
                      Max User Accounts
                      <input className="input" type="number" min="1" value={limitDefaults[plan]?.maxUserAccounts ?? ''} onChange={(e) => setLimitDefault(plan, 'maxUserAccounts', e.target.value)} placeholder="Unlimited" />
                    </label>
                    <label>
                      Max Active Users
                      <input className="input" type="number" min="1" value={limitDefaults[plan]?.maxActiveUsers ?? ''} onChange={(e) => setLimitDefault(plan, 'maxActiveUsers', e.target.value)} placeholder="Unlimited" />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn btn-primary" type="button" onClick={saveLimitDefaults} disabled={savingDefaults}>{savingDefaults ? 'Saving…' : 'Save Limit Defaults'}</button>
            </div>
          </div>
        </>
      ) : activeTab === 'payment_management' ? (
        <>
          <div className="card">
            <h2 className="section-title">Payment Gateway Controls</h2>
            <div style={{ color: '#64748b', marginBottom: 12 }}>
              Enable only the gateways you want tenants to see on the expired subscription payment modal.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              {(paymentManagement.gateways || []).map((gateway) => (
                <div key={gateway.key} className="card" style={{ padding: 14, border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>{gateway.label}</div>
                      <div style={{ color: '#64748b', fontSize: 12 }}>{gateway.description}</div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={!!gateway.enabled} disabled={savingPaymentManagement} onChange={(e) => togglePaymentGateway(gateway.key, e.target.checked)} />
                      <span>{gateway.enabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ color: '#64748b', fontSize: 12 }}>Total Collected</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{Number(paymentSummary.totalCollected || 0).toLocaleString()}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ color: '#64748b', fontSize: 12 }}>Transactions</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{paymentSummary.transactionCount}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ color: '#64748b', fontSize: 12 }}>Card Collected</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{Number(paymentSummary.cardCollected || 0).toLocaleString()}</div>
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div style={{ color: '#64748b', fontSize: 12 }}>Mobile Money Collected</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{Number(paymentSummary.mobileMoneyCollected || 0).toLocaleString()}</div>
            </div>
          </div>
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <label>
                Provider
                <select className="input" value={paymentFilters.provider} onChange={(e) => setPaymentFilter('provider', e.target.value)}>
                  <option value="all">All</option>
                  {(paymentManagement.gateways || []).map((gateway) => <option key={gateway.key} value={gateway.key}>{gateway.label}</option>)}
                </select>
              </label>
              <label>
                Channel
                <select className="input" value={paymentFilters.channel} onChange={(e) => setPaymentFilter('channel', e.target.value)}>
                  <option value="all">All</option>
                  <option value="card">Card</option>
                  <option value="mobile_money">Mobile Money</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Tenant
                <select className="input" value={paymentFilters.tenantId} onChange={(e) => setPaymentFilter('tenantId', e.target.value)}>
                  <option value="all">All</option>
                  {rows.map((row) => <option key={row.tenantId} value={row.tenantId}>{row.tenantId}</option>)}
                </select>
              </label>
              <label>
                Search
                <input className="input" value={paymentFilters.search} onChange={(e) => setPaymentFilter('search', e.target.value)} placeholder="Tenant, ref, provider" />
              </label>
            </div>
            <h2 className="section-title">All Tenant Payment History</h2>
            <table className="table">
              <thead>
                <tr>
                  <th align="left">Date</th>
                  <th align="left">Tenant</th>
                  <th align="left">Provider</th>
                  <th align="left">Channel</th>
                  <th align="left">Amount</th>
                  <th align="left">Status</th>
                  <th align="left">Reference</th>
                </tr>
              </thead>
              <tbody>
                {filteredPaymentRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : ''}</td>
                    <td>{row.tenantName || row.tenantId}</td>
                    <td>{row.provider}</td>
                    <td>{row.channel}</td>
                    <td>{Number(row.amount || 0).toLocaleString()} {row.currencyCode || ''}</td>
                    <td>{row.status || ''}</td>
                    <td>{row.transactionRef || row.providerTransactionId || ''}</td>
                  </tr>
                ))}
                {filteredPaymentRows.length === 0 ? <tr><td colSpan="7" style={{ color: '#64748b', padding: 12 }}>No payment records match the current filter.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
      <div className="card">
        <h2 className="section-title">Tenant Directory</h2>
        {lastTenantImportSummary ? (
          <div className="card" style={{ padding: 16, marginBottom: 12, border: '1px solid #bbf7d0', background: '#f0fdf4' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 800, color: '#166534' }}>Last Tenant Import Summary</div>
                <div style={{ color: '#166534', fontSize: 13 }}>
                  Tenant: {lastTenantImportSummary.tenantId} • Mode: {lastTenantImportSummary.mode === 'overwrite' ? 'Overwrite Current Data' : 'Keep Current Data'}
                </div>
              </div>
              <button className="btn" type="button" onClick={() => setLastTenantImportSummary(null)}>Dismiss</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
              <div className="card" style={{ padding: 12 }}><div style={{ color: '#64748b', fontSize: 12 }}>Inserted</div><div style={{ fontSize: 22, fontWeight: 800 }}>{lastTenantImportSummary.summary.inserted}</div></div>
              <div className="card" style={{ padding: 12 }}><div style={{ color: '#64748b', fontSize: 12 }}>Updated</div><div style={{ fontSize: 22, fontWeight: 800 }}>{lastTenantImportSummary.summary.updated}</div></div>
              <div className="card" style={{ padding: 12 }}><div style={{ color: '#64748b', fontSize: 12 }}>Skipped</div><div style={{ fontSize: 22, fontWeight: 800 }}>{lastTenantImportSummary.summary.skipped}</div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              {lastTenantImportSummary.summary.perCollection.map((row) => (
                <div key={row.collection} style={{ padding: '8px 10px', border: '1px solid #d1fae5', borderRadius: 10, background: '#fff' }}>
                  <div style={{ fontWeight: 700 }}>{row.collection}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>Inserted: {row.inserted} • Updated: {row.updated} • Skipped: {row.skipped}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {loading ? <div><LoadingDots label="Loading tenants" /></div> : (
          <table className="table">
            <thead>
              <tr>
                <th align="left">Tenant ID</th>
                <th align="left">Company</th>
                <th align="left">Plan</th>
                <th align="left">Database</th>
                <th align="left">Status</th>
                <th align="left">Theme</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tenantId}>
                  <td>{row.tenantId}</td>
                  <td>{row.name}</td>
                  <td>{row.subscriptionPlan}</td>
                  <td>{row.dbName}</td>
                  <td>{row.disabled ? 'Disabled' : 'Active'}{row.subscriptionExpiresAt ? ` • ${daysLeftLabel(String(row.subscriptionExpiresAt).slice(0, 10))}` : ''}</td>
                  <td><span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 999, background: String(row.themeColor || '#16a34a'), border: '1px solid #cbd5e1' }} /></td>
                  <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" onClick={() => startEdit(row)}>Edit</button>
                    <button className="btn" onClick={() => exportTenantBackup(row)} disabled={tenantTransferLoading === `export:${row.tenantId}` || tenantTransferLoading.startsWith('import:')}>
                      {tenantTransferLoading === `export:${row.tenantId}` ? 'Exporting…' : 'Export Data'}
                    </button>
                    <button className="btn" onClick={() => openTenantImport(row)} disabled={!!tenantTransferLoading}>
                      Import Data
                    </button>
                    <button className="btn" style={{ color: '#b91c1c' }} onClick={async () => {
                      const { confirmDialog } = await import('../utils/dialogs');
                      const ok = await confirmDialog(`Delete tenant ${row.name}? This removes the tenant database.`);
                      if (!ok) return;
                      try {
                        await tenantsApi.remove(row.tenantId);
                        toast.show('Tenant deleted', { type: 'success' });
                        await load();
                      } catch (e) {
                        toast.show(String(e?.message || 'Failed to delete tenant'), { type: 'error' });
                      }
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="7" style={{ color: '#64748b', padding: 12 }}>No tenants yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div>
            <h2 className="section-title">Tenant User Audit</h2>
            <div style={{ color: '#64748b' }}>
              Scans all tenant databases for suspicious duplicate usernames that appear in more than one tenant.
            </div>
          </div>
          <button className="btn btn-primary" type="button" onClick={runUserAudit} disabled={runningAudit}>
            {runningAudit ? 'Scanning…' : 'Run User Audit'}
          </button>
        </div>
        <div style={{ color: '#475569', marginBottom: 10 }}>
          Scanned tenants: {userAudit.scannedTenants} • Duplicate usernames found: {userAudit.duplicateCount}
        </div>
        {(userAudit.duplicateUserNames || []).length === 0 ? (
          <div style={{ color: '#64748b' }}>No suspicious cross-tenant duplicate usernames found.</div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {(userAudit.duplicateUserNames || []).map((group) => (
              <div key={group.userName} className="card" style={{ padding: 14, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{group.userName}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      Suggested owner tenant: {group.suggestedOwnerTenantId || 'Unknown'}
                    </div>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{(group.occurrences || []).length} tenant(s)</div>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {(group.occurrences || []).map((occ) => {
                    const key = `${occ.tenantId}:${group.userName}`;
                    const protectedOwner = group.suggestedOwnerTenantId && String(group.suggestedOwnerTenantId) === String(occ.tenantId);
                    return (
                      <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{occ.tenantId}</div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>Role: {occ.role || 'Unknown'}</div>
                        </div>
                        <button className="btn" type="button" disabled={protectedOwner || cleaningAuditKey === key} onClick={() => cleanupAuditOccurrence(occ.tenantId, group.userName)}>
                          {protectedOwner ? 'Suggested Owner' : cleaningAuditKey === key ? 'Removing…' : 'Remove From Tenant'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      )}
      {showForm && (
        <Modal
          title={editing ? `Edit Tenant: ${editing}` : 'Add Tenant'}
          onClose={closeModal}
          variant="light"
          footer={
            <>
              <button className="btn" type="button" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" form="tenant-form" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Update Tenant' : 'Create Tenant'}</button>
            </>
          }
        >
          <form id="tenant-form" onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <label>
                Tenant ID
                <input className="input" value={form.tenantId} onChange={(e) => setValue('tenantId', e.target.value)} disabled={!!editing} />
              </label>
              <label>
                Company Name
                <input className="input" value={form.name} onChange={(e) => setValue('name', e.target.value)} />
              </label>
              <label>
                Client App Name
                <input className="input" value={form.clientAppName} onChange={(e) => setValue('clientAppName', e.target.value)} />
              </label>
              <label>
                Theme Color
                <input className="input" type="color" value={form.themeColor || '#16a34a'} onChange={(e) => setValue('themeColor', e.target.value)} style={{ height: 44 }} />
              </label>
              <label>
                Billing Email
                <input className="input" type="email" value={form.billingEmail} onChange={(e) => setValue('billingEmail', e.target.value)} />
              </label>
              <label>
                Billing Phone
                <input className="input" value={form.billingPhone} onChange={(e) => setValue('billingPhone', e.target.value)} />
              </label>
              <label>
                Billing Country
                <select className="input" value={form.billingCountry} onChange={(e) => setValue('billingCountry', e.target.value)}>
                  <option value="GH">Ghana</option>
                  <option value="ZM">Zambia</option>
                  <option value="MW">Malawi</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <label>
                Billing Address
                <input className="input" value={form.billingAddress} onChange={(e) => setValue('billingAddress', e.target.value)} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              <label>
                Plan
                <select className="input" value={form.subscriptionPlan} onChange={(e) => setValue('subscriptionPlan', e.target.value)}>
                  {planOptions.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
                </select>
              </label>
              <label>
                Expiry Date
                <input className="input" type="date" value={form.subscriptionExpiresAt || ''} onChange={(e) => setValue('subscriptionExpiresAt', e.target.value)} disabled={!!form.subscriptionPermanent} />
              </label>
              <label>
                Subscription Amount
                <input className="input" type="number" min="0" step="0.01" value={form.subscriptionAmount} onChange={(e) => setValue('subscriptionAmount', e.target.value)} placeholder="Optional amount" />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24 }}>
                <input type="checkbox" checked={!!form.subscriptionPermanent} onChange={(e) => setValue('subscriptionPermanent', e.target.checked)} />
                <span>Permanent Subscription</span>
              </label>
              <label>
                Default Admin Username
                <input className="input" value={form.adminName} onChange={(e) => setValue('adminName', e.target.value)} />
              </label>
              <label>
                Default Admin PIN
                <input className="input" type="password" value={form.adminPin} onChange={(e) => setValue('adminPin', e.target.value)} />
              </label>
            </div>
            <div className="surface-panel">
              <div style={{ fontWeight: 800, marginBottom: 6 }}>User Limits</div>
              <div className="section-note" style={{ marginBottom: 10 }}>
                Leave override fields blank to use the plan default. You can override a tenant regardless of its package.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  Max User Accounts Override
                  <input className="input" type="number" min="1" value={form.maxUserAccountsOverride} onChange={(e) => setValue('maxUserAccountsOverride', e.target.value)} placeholder="Use plan default" />
                </label>
                <label>
                  Max Active Users Override
                  <input className="input" type="number" min="1" value={form.maxActiveUsersOverride} onChange={(e) => setValue('maxActiveUsersOverride', e.target.value)} placeholder="Use plan default" />
                </label>
              </div>
            </div>
            <div className="section-header" style={{ color: '#64748b', fontSize: 13 }}>
              <span className="section-note">Subscription status: {form.subscriptionPermanent ? 'Permanent access enabled' : daysLeftLabel(form.subscriptionExpiresAt)}</span>
              <button className="btn" type="button" onClick={applyPlanDefaults}>Reset Features To Plan Default</button>
            </div>
            {editing && (
              <div className="surface-panel">
                <div className="section-header" style={{ marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>Tenant Activation Code</div>
                    <div className="section-note">Only superadmin can view and refresh this code. Share it with the tenant after payment.</div>
                  </div>
                  <button className="btn" type="button" onClick={refreshActivationCodeForCurrentTenant} disabled={refreshingActivation}>
                    {refreshingActivation ? 'Refreshing…' : 'Refresh Code'}
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label>
                    Subscription Amount
                    <input className="input" value={form.subscriptionAmount === '' ? '' : String(form.subscriptionAmount)} readOnly />
                  </label>
                  <label>
                    Current Activation Code
                    <input className="input" value={form.activationCode || ''} readOnly />
                  </label>
                  <label>
                    Code Expires At
                    <input className="input" value={form.activationCodeExpiresAt ? new Date(form.activationCodeExpiresAt).toLocaleString() : ''} readOnly />
                  </label>
                </div>
              </div>
            )}
            {editing && (
              <div className="surface-panel">
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Payment Records</div>
                {(form.paymentHistory || []).length === 0 ? (
                  <div className="section-note">No payment records yet. Records will appear here after live payment checkout is configured and used.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 240, overflow: 'auto' }}>
                    {(form.paymentHistory || []).slice().reverse().map((entry, index) => (
                      <div key={`${entry.transactionRef || index}:${index}`} className="mini-record">
                        <div className="mini-record-title">
                          <span>{entry.provider || 'payment'} • {entry.method || 'method'}</span>
                          <span className="mini-record-subtle">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}</span>
                        </div>
                        <div className="mini-record-meta">
                          Status: {entry.status || 'unknown'} • Amount: {entry.amount == null ? 'Not set' : Number(entry.amount).toLocaleString()} {entry.currencyCode || ''}
                          {' • '}
                          Months: {entry.months || '-'}
                          {entry.network ? ` • Network: ${entry.network}` : ''}
                        </div>
                        <div className="mini-record-subtle">
                          Ref: {entry.transactionRef || '-'} • Provider Txn: {entry.providerTransactionId || '-'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {editing && (
              <div className="surface-panel">
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Renewal History</div>
                {(form.renewalHistory || []).length === 0 ? (
                  <div className="section-note">No renewal history yet.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflow: 'auto' }}>
                    {(form.renewalHistory || []).slice().reverse().map((entry, index) => (
                      <div key={`${entry.createdAt || index}:${index}`} className="mini-record">
                        <div className="mini-record-title">
                          <span>{String(entry.source || 'renewal').replace(/_/g, ' ')}</span>
                          <span className="mini-record-subtle">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}</span>
                        </div>
                        <div className="mini-record-meta">
                          Amount: {entry.amount == null ? 'Not set' : Number(entry.amount).toLocaleString()}
                          {' • '}
                          Previous Expiry: {entry.previousExpiry ? new Date(entry.previousExpiry).toLocaleString() : 'None'}
                          {' • '}
                          New Expiry: {entry.newExpiry ? new Date(entry.newExpiry).toLocaleString() : (entry.permanentAfter ? 'Permanent' : 'None')}
                        </div>
                        <div className="mini-record-subtle">
                          Actor: {entry.actorName || 'System'} • Note: {entry.note || 'Subscription updated'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Feature Overrides</div>
              <div className="section-note" style={{ marginBottom: 10 }}>
                Features now follow the sidebar structure. Turning on a section like Distribution or Warehouse brings in its submenu items and related approvals by default, and you can still remove any child item manually.
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                {sections.map((section) => {
                  const sectionKeys = Array.from(new Set([section.sectionKey, ...section.items.flatMap((item) => item.keys || [])].filter(Boolean)));
                  const sectionChecked = hasAll(sectionKeys);
                  return (
                  <div key={section.id} className="card" style={{ padding: 14, border: '1px solid #dbe3ee', background: '#ffffff', color: '#0f172a' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, color: '#0f172a' }}>
                      <input type="checkbox" checked={sectionChecked} onChange={(e) => toggleKeys(sectionKeys, e.target.checked)} />
                      <span>
                        <span style={{ display: 'block', fontWeight: 800, color: '#0f172a' }}>{section.title}</span>
                        <span style={{ display: 'block', color: '#64748b', fontSize: 12, marginTop: 4 }}>{section.description}</span>
                      </span>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                      {section.items.map((item) => (
                        <label key={`${section.id}:${item.label}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: '#0f172a', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 10 }}>
                          <input type="checkbox" checked={hasAll(item.keys || [])} onChange={(e) => toggleKeys(item.keys || [], e.target.checked)} />
                          <span style={{ color: '#0f172a' }}>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )})}
              </div>
            </div>
          </form>
        </Modal>
      )}
      {tenantImportTarget && (
        <Modal
          title={`Import Tenant Data: ${tenantImportTarget.tenantId}`}
          onClose={() => { if (!tenantTransferLoading) setTenantImportTarget(null); }}
          variant="light"
          footer={
            <>
              <button className="btn" type="button" onClick={() => setTenantImportTarget(null)} disabled={!!tenantTransferLoading}>Cancel</button>
              <button className="btn btn-primary" type="button" onClick={importTenantBackup} disabled={tenantTransferLoading === `import:${tenantImportTarget.tenantId}` || !tenantImportPayload}>
                {tenantTransferLoading === `import:${tenantImportTarget.tenantId}` ? 'Importing…' : 'Import Tenant Data'}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: '#64748b' }}>
              Import a tenant backup into <strong>{tenantImportTarget.tenantId}</strong>. You can keep current data and merge the backup, or overwrite the current tenant database.
            </div>
            <label>
              Backup File
              <input ref={tenantImportInputRef} className="input" type="file" accept="application/json,.json" onChange={(e) => onTenantImportFileChange(e.target.files?.[0] || null)} disabled={!!tenantTransferLoading} />
            </label>
            <label>
              Import Mode
              <select className="input" value={tenantImportMode} onChange={(e) => setTenantImportMode(e.target.value)} disabled={!!tenantTransferLoading}>
                <option value="keep_current">Keep Current Data</option>
                <option value="overwrite">Overwrite Current Data</option>
              </select>
            </label>
            {tenantImportMode === 'overwrite' ? (
              <div className="card" style={{ padding: 12, border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b' }}>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>Warning: Overwrite Current Data</div>
                <div>This will delete the current tenant collections for <strong>{tenantImportTarget.tenantId}</strong> before importing the backup.</div>
              </div>
            ) : null}
            {tenantImportSummary ? (
              <div className="card" style={{ padding: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Import Preview</div>
                <div style={{ color: '#64748b', marginBottom: 8 }}>
                  Tenant: {tenantImportSummary.tenantId || 'Unknown'} • Collections: {tenantImportSummary.totalCollections} • Documents: {tenantImportSummary.totalDocuments}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, maxHeight: '36vh', overflowY: 'auto' }}>
                  {tenantImportSummary.collectionNames.map((name) => (
                    <div key={name} style={{ padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc' }}>
                      <div style={{ fontWeight: 700 }}>{name}</div>
                      <div style={{ color: '#64748b', fontSize: 12 }}>{tenantImportSummary.counts[name] || 0} item(s)</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {tenantImportProgress ? (
              <div className="card" style={{ padding: 12, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                  <div style={{ fontWeight: 800 }}>Import Progress</div>
                  <div style={{ color: '#2563eb', fontWeight: 800 }}>{tenantImportProgress.percentage}%</div>
                </div>
                <div style={{ height: 10, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ width: `${tenantImportProgress.percentage}%`, height: '100%', background: '#2563eb' }} />
                </div>
                <div style={{ color: '#475569' }}>
                  Copying <strong>{tenantImportProgress.currentCollection}</strong> ({tenantImportProgress.currentCount || 0} item(s)) • {tenantImportProgress.completedCollections}/{tenantImportProgress.totalCollections} collection(s)
                </div>
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>
                  Estimated time remaining: {tenantImportProgress.remainingMs == null ? 'Calculating…' : formatDurationMs(tenantImportProgress.remainingMs)}
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default TenantsPage;
