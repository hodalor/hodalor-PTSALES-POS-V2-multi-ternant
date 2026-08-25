import { Router } from 'express';
import Settings from '../models/Settings.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { filterGrantsByFeatureFlags, featureFlagsFromEnabled, TENANT_GRANT_KEYS } from '../config/tenantAccess.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';
import { getMasterConnection } from '../config/tenancy.js';
import { uploadMediaString } from '../utils/mediaStorage.js';

const r = Router();
const TENANT_ADMIN_ALLOWED_KEYS = new Set([
  'clientAppName',
  'clientLogoUrl',
  'preferredLanguage',
  'receiptBrandName',
  'chatNotificationSound',
  'callNotificationSound',
  'webRtcIceServers',
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
  'creditPackages'
]);

function normalizeSettingsData(input = {}) {
  const next = { ...(input || {}) };
  const parsedTax = Number(next.taxRate);
  next.taxRate = Number.isFinite(parsedTax) ? Math.max(0, Math.min(1, parsedTax)) : 0;
  next.currencies = Array.isArray(next.currencies)
    ? next.currencies
        .map((entry) => ({
          code: String(entry?.code || '').trim().toUpperCase(),
          symbol: String(entry?.symbol || '').trim(),
          position: String(entry?.position || 'prefix') === 'suffix' ? 'suffix' : 'prefix'
        }))
        .filter((entry) => entry.code)
    : [];
  const activeCurrencyCode = String(next.activeCurrencyCode || next.currencyCode || '').trim().toUpperCase();
  const selectedCurrency = next.currencies.find((entry) => entry.code === activeCurrencyCode) || null;
  if (selectedCurrency) {
    next.activeCurrencyCode = selectedCurrency.code;
    next.currencyCode = selectedCurrency.code;
    next.currencySymbol = selectedCurrency.symbol || next.currencySymbol || '';
    next.currencyPosition = selectedCurrency.position || next.currencyPosition || 'prefix';
  } else {
    next.activeCurrencyCode = activeCurrencyCode || 'GHS';
    next.currencyCode = String(next.currencyCode || next.activeCurrencyCode || 'GHS').trim().toUpperCase() || 'GHS';
    next.currencySymbol = String(next.currencySymbol || '₵').trim() || '₵';
    next.currencyPosition = String(next.currencyPosition || 'prefix') === 'suffix' ? 'suffix' : 'prefix';
  }
  if (!String(next.chatNotificationSound || '').trim()) next.chatNotificationSound = 'bright';
  if (!String(next.callNotificationSound || '').trim()) next.callNotificationSound = 'bright';
  if (!String(next.webRtcIceServers || '').trim()) next.webRtcIceServers = 'stun:stun.l.google.com:19302';
  next.receiptShowPaymentInfo = !!next.receiptShowPaymentInfo;
  next.receiptShowTaxInfo = !!next.receiptShowTaxInfo;
  next.receiptShowQrSection = !!next.receiptShowQrSection;
  next.distributionPosDefaultPrintMode = ['receipt', 'invoice', 'both'].includes(String(next.distributionPosDefaultPrintMode || '').trim().toLowerCase())
    ? String(next.distributionPosDefaultPrintMode || '').trim().toLowerCase()
    : 'receipt';
  next.warehousePosDefaultPrintMode = ['receipt', 'invoice', 'both'].includes(String(next.warehousePosDefaultPrintMode || '').trim().toLowerCase())
    ? String(next.warehousePosDefaultPrintMode || '').trim().toLowerCase()
    : 'receipt';
  next.systemUpgradeNoticeEnabled = !!next.systemUpgradeNoticeEnabled;
  if (!String(next.systemUpgradeNoticeTitle || '').trim()) {
    next.systemUpgradeNoticeTitle = 'Database Upgrade In Progress';
  }
  if (!String(next.systemUpgradeNoticeMessage || '').trim()) {
    next.systemUpgradeNoticeMessage = 'A database upgrade is currently in progress. Your data is safe. Some records may take a little longer to appear while we complete the update. Thank you for your patience.';
  }
  next.categories = Array.isArray(next.categories)
    ? Array.from(new Set(next.categories.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
  next.creditPackages = Array.isArray(next.creditPackages)
    ? Array.from(new Set(next.creditPackages.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
  return next;
}

r.use(requireAuth);

r.get('/', async (req, res) => {
  let doc = await Settings.findOne({ key: 'default' });
  const tenantId = String(req.user?.tenantId || req.tenantId || '').trim();
  if (tenantId && tenantId.toLowerCase() !== 'master') {
    try {
      const master = await getMasterConnection();
      const TenantModel = TenantModelFor(master);
      const tenant = await TenantModel.findOne({ tenantId }).lean();
      const MasterSettings = master.model('Settings', Settings.schema);
      const masterSettingsDoc = await MasterSettings.findOne({ key: 'default' }).lean().catch(() => null);
      const masterSettings = normalizeSettingsData(masterSettingsDoc?.data || {});
      if (tenant) {
        const before = normalizeSettingsData(doc?.data || {});
        const nextData = {
          ...before,
          clientAppName: tenant.clientAppName || before.clientAppName || tenant.name || '',
          clientLogoUrl: tenant.logo || before.clientLogoUrl || '',
          themeColor: tenant.themeColor || before.themeColor || '',
          subscriptionPlan: tenant.subscriptionPlan || before.subscriptionPlan || 'basic',
          subscriptionExpiresAt: tenant.subscriptionExpiresAt || before.subscriptionExpiresAt || null,
          featureFlags: featureFlagsFromEnabled(Array.isArray(tenant.features) ? tenant.features : []),
          systemUpgradeNoticeEnabled: !!masterSettings.systemUpgradeNoticeEnabled,
          systemUpgradeNoticeTitle: String(masterSettings.systemUpgradeNoticeTitle || ''),
          systemUpgradeNoticeMessage: String(masterSettings.systemUpgradeNoticeMessage || '')
        };
        if (!doc || JSON.stringify(before) !== JSON.stringify(nextData)) {
          doc = await Settings.findOneAndUpdate(
            { key: 'default' },
            { key: 'default', data: nextData },
            { new: true, upsert: true }
          );
        }
      }
    } catch {}
  }
  const data = normalizeSettingsData(doc?.data || {});
  if (!doc) return res.json(data);
  if (JSON.stringify(doc.data || {}) !== JSON.stringify(data)) {
    doc = await Settings.findOneAndUpdate({ key: 'default' }, { key: 'default', data }, { new: true, upsert: true });
  }
  res.json(data);
});

r.put('/', requireAdmin, async (req, res) => {
  const data = { ...(req.body || {}) };
  if (Object.prototype.hasOwnProperty.call(data, 'clientLogoUrl')) {
    data.clientLogoUrl = await uploadMediaString(data.clientLogoUrl, {
      tenantId: String(req.user?.tenantId || req.tenantId || 'master').trim(),
      folder: 'tenant-logos',
      originalName: `${req.user?.tenantId || req.tenantId || 'tenant'}-logo`
    });
  }
  const role = String(req.user?.role || '').toLowerCase();
  const isMasterSuperAdmin = role === 'superadmin' && String(req.user?.tenantId || req.tenantId || '').toLowerCase() === 'master';
  if (Object.prototype.hasOwnProperty.call(data, 'featureFlags') && !isMasterSuperAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (!isMasterSuperAdmin) {
    const attemptedKeys = Object.keys(data || {});
    const forbidden = attemptedKeys.filter((key) => !TENANT_ADMIN_ALLOWED_KEYS.has(key) && key !== 'featureFlags' && key !== 'userGrants');
    if (forbidden.length > 0) {
      return res.status(403).json({ error: `Forbidden keys: ${forbidden.join(', ')}` });
    }
  }
  const prev = await Settings.findOne({ key: 'default' });
  const before = normalizeSettingsData(prev && prev.data ? prev.data : {});
  if (data && Object.prototype.hasOwnProperty.call(data, 'userGrants') && data.userGrants && typeof data.userGrants === 'object') {
    const prevMap = before?.userGrants && typeof before.userGrants === 'object' ? before.userGrants : {};
    const incomingMap = data.userGrants;
    const protectedKeys = new Set(['view_audit', 'see_audit']);
    const manageableGrantKeys = isMasterSuperAdmin
      ? filterGrantsByFeatureFlags(TENANT_GRANT_KEYS, (data.featureFlags || before.featureFlags || {}))
      : filterGrantsByFeatureFlags(TENANT_GRANT_KEYS, (data.featureFlags || before.featureFlags || {})).filter((key) => !protectedKeys.has(String(key)));
    const mergedMap = { ...prevMap };
    Object.keys(incomingMap || {}).forEach(name => {
      const incoming = filterGrantsByFeatureFlags(Array.isArray(incomingMap[name]) ? incomingMap[name] : [], (data.featureFlags || before.featureFlags || {}));
      const previous = Array.isArray(prevMap[name]) ? prevMap[name] : [];
      const keepProtected = previous.filter(g => protectedKeys.has(String(g)));
      const nextUnprotected = incoming.filter(g => !protectedKeys.has(String(g)) && manageableGrantKeys.includes(String(g)));
      mergedMap[name] = Array.from(new Set([...(isMasterSuperAdmin ? [] : keepProtected), ...nextUnprotected]));
    });
    data.userGrants = mergedMap;
  }
  const nextData = normalizeSettingsData({ ...before, ...data });
  let doc = await Settings.findOneAndUpdate({ key: 'default' }, { data: nextData }, { new: true, upsert: true });
  const after = normalizeSettingsData(doc && doc.data ? doc.data : {});
  const tenantId = String(req.user?.tenantId || req.tenantId || '').trim();
  const changed = [];
  Object.keys(data || {}).forEach(k => {
    try {
      const a = JSON.stringify(before[k]);
      const b = JSON.stringify(after[k]);
      if (a !== b) changed.push(k);
    } catch {
      changed.push(k);
    }
  });
  res.json(after || {});
  void Promise.resolve().then(async () => {
    if (tenantId && tenantId.toLowerCase() !== 'master') {
      const changedIdentity = {};
      if (Object.prototype.hasOwnProperty.call(data, 'clientAppName')) changedIdentity.clientAppName = String(after.clientAppName || '');
      if (Object.prototype.hasOwnProperty.call(data, 'clientLogoUrl')) changedIdentity.logo = String(after.clientLogoUrl || '');
      if (Object.prototype.hasOwnProperty.call(data, 'themeColor')) changedIdentity.themeColor = String(after.themeColor || '');
      if (Object.keys(changedIdentity).length > 0) {
        try {
          const master = await getMasterConnection();
          const TenantModel = TenantModelFor(master);
          await TenantModel.findOneAndUpdate({ tenantId }, { $set: changedIdentity });
        } catch {}
      }
    }
    await Audit.create({
      actor: (req.user && req.user.name) || 'unknown',
      actionType: 'settings_update',
      details: { changedKeys: changed, count: changed.length },
      branchId: req.user?.branchId || ''
    }).catch(() => {});
    await ServerLog.create({
      level: 'info',
      actor: (req.user && req.user.name) || 'unknown',
      route: req.originalUrl || req.url || '',
      method: req.method || 'PUT',
      status: 200,
      message: 'Settings updated',
      details: { changedKeys: changed, count: changed.length }
    }).catch(() => {});
  });
});

export default r;
