import { Router } from 'express';
import Settings from '../models/Settings.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { filterGrantsByFeatureFlags } from '../config/tenantAccess.js';

const r = Router();
const TENANT_ADMIN_ALLOWED_KEYS = new Set([
  'clientAppName',
  'clientLogoUrl',
  'receiptBrandName',
  'receiptHeader',
  'receiptFooter',
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
  'themeColor',
  'currentBranchId'
]);

r.use(requireAuth);

r.get('/', async (req, res) => {
  let doc = await Settings.findOne({ key: 'default' });
  if (!doc) return res.json({});
  res.json(doc.data || {});
});

r.put('/', requireAdmin, async (req, res) => {
  const data = { ...(req.body || {}) };
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
  const before = prev && prev.data ? prev.data : {};
  if (data && Object.prototype.hasOwnProperty.call(data, 'userGrants') && data.userGrants && typeof data.userGrants === 'object') {
    const prevMap = before?.userGrants && typeof before.userGrants === 'object' ? before.userGrants : {};
    const incomingMap = data.userGrants;
    const protectedKeys = new Set(['view_audit', 'see_audit']);
    const mergedMap = { ...prevMap };
    Object.keys(incomingMap || {}).forEach(name => {
      const incoming = filterGrantsByFeatureFlags(Array.isArray(incomingMap[name]) ? incomingMap[name] : [], (data.featureFlags || before.featureFlags || {}));
      const previous = Array.isArray(prevMap[name]) ? prevMap[name] : [];
      const keepProtected = previous.filter(g => protectedKeys.has(String(g)));
      const nextUnprotected = incoming.filter(g => !protectedKeys.has(String(g)));
      mergedMap[name] = Array.from(new Set([...(isMasterSuperAdmin ? [] : keepProtected), ...nextUnprotected]));
    });
    data.userGrants = mergedMap;
  }
  const nextData = { ...before, ...data };
  let doc = await Settings.findOneAndUpdate({ key: 'default' }, { data: nextData }, { new: true, upsert: true });
  const after = doc && doc.data ? doc.data : {};
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
  void Audit.create({
    actor: (req.user && req.user.name) || 'unknown',
    actionType: 'settings_update',
    details: { changedKeys: changed, count: changed.length },
    branchId: req.user?.branchId || ''
  }).catch(() => {});
  void ServerLog.create({
    level: 'info',
    actor: (req.user && req.user.name) || 'unknown',
    route: req.originalUrl || req.url || '',
    method: req.method || 'PUT',
    status: 200,
    message: 'Settings updated',
    details: { changedKeys: changed, count: changed.length }
  }).catch(() => {});
});

export default r;
