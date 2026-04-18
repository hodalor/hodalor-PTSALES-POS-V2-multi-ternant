import { EJSON } from 'bson';
import { getMasterConnection, getTenantConnection, normalizeTenantId } from '../config/tenancy.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';

const COLLECTION_ORDER = [
  'settings',
  'branches',
  'categories',
  'suppliers',
  'customers',
  'users',
  'products',
  'productunits',
  'sales',
  'invoices',
  'creditsales',
  'creditrepayments',
  'expenses',
  'expenserequests',
  'refundrequests',
  'purchaserequests',
  'transferrequests',
  'adjustmentrequests',
  'wholesaleoperations',
  'approvals',
  'cashsessions',
  'audits',
  'serverlogs'
];

const SETTINGS_PROTECTED_FIELDS = [
  'featureFlags',
  'subscriptionPlan',
  'subscriptionExpiresAt',
  'subscriptionPermanent',
  'subscriptionAmount'
];

const MERGE_KEY_CANDIDATES = {
  settings: [['key']],
  branches: [['id']],
  categories: [['name']],
  suppliers: [['clientId'], ['name']],
  customers: [['clientId'], ['customerCode'], ['phone']],
  users: [['name']],
  products: [['sku'], ['id']],
  productunits: [['imei'], ['serialNumber'], ['_id']],
  sales: [['clientId'], ['receiptNumber'], ['invoiceSerial'], ['_id']],
  invoices: [['clientId'], ['number'], ['saleId'], ['_id']],
  creditsales: [['saleId'], ['_id']],
  creditrepayments: [['creditSaleId', 'createdAt'], ['_id']],
  expenses: [['clientId'], ['_id']],
  expenserequests: [['clientId'], ['_id']],
  refundrequests: [['clientId'], ['saleId', 'created_at'], ['_id']],
  purchaserequests: [['clientId'], ['_id']],
  transferrequests: [['clientId'], ['_id']],
  adjustmentrequests: [['clientId'], ['_id']],
  wholesaleoperations: [['clientId'], ['operationArea', 'operationType', 'createdAt'], ['_id']],
  approvals: [['referenceModel', 'referenceId'], ['_id']],
  cashsessions: [['clientId'], ['sessionId'], ['_id']],
  audits: [['_id']],
  serverlogs: [['_id']]
};

function sortCollectionNames(names = []) {
  return Array.from(new Set((names || []).map((name) => String(name || '').trim()).filter(Boolean))).sort((a, b) => {
    const ia = COLLECTION_ORDER.indexOf(a);
    const ib = COLLECTION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function sanitizeCollectionName(name) {
  return String(name || '').trim();
}

function normalizeImportPayload(raw = {}) {
  const parsed = EJSON.deserialize(raw);
  const collections = parsed?.collections && typeof parsed.collections === 'object' ? parsed.collections : {};
  return {
    tenantId: String(parsed?.tenantId || ''),
    exportedAt: parsed?.exportedAt || null,
    version: parsed?.version || 1,
    collections: Object.fromEntries(
      Object.entries(collections).map(([name, value]) => [
        sanitizeCollectionName(name),
        Array.isArray(value) ? value : (Array.isArray(value?.documents) ? value.documents : [])
      ])
    )
  };
}

function cleanImportDoc(collectionName, doc, currentSettingsDefault) {
  if (!doc || typeof doc !== 'object') return null;
  const next = { ...doc };
  if (collectionName === 'settings' && String(next.key || '') === 'default') {
    const current = currentSettingsDefault || {};
    next.data = { ...(next.data || {}) };
    SETTINGS_PROTECTED_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(current, field)) next.data[field] = current[field];
    });
  }
  return next;
}

function buildMergeFilter(collectionName, doc = {}) {
  const candidates = MERGE_KEY_CANDIDATES[collectionName] || [['_id']];
  for (const candidate of candidates) {
    const filter = {};
    let valid = true;
    for (const key of candidate) {
      const value = doc?.[key];
      if (value == null || value === '') {
        valid = false;
        break;
      }
      filter[key] = value;
    }
    if (valid && Object.keys(filter).length > 0) return filter;
  }
  if (doc?._id != null) return { _id: doc._id };
  return null;
}

async function syncTenantMetaFromSettings(tenantId) {
  const tid = normalizeTenantId(tenantId);
  if (!tid || tid.toLowerCase() === 'master') return;
  const conn = await getTenantConnection(tid);
  const settingsDoc = await conn.db.collection('settings').findOne({ key: 'default' });
  const data = settingsDoc?.data || {};
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  await TenantModel.findOneAndUpdate(
    { tenantId: tid },
    {
      $set: {
        clientAppName: String(data.clientAppName || ''),
        logo: String(data.clientLogoUrl || ''),
        themeColor: String(data.themeColor || '')
      }
    }
  );
}

export async function exportTenantData(tenantId) {
  const tid = normalizeTenantId(tenantId);
  const conn = await getTenantConnection(tid);
  const collections = await conn.db.listCollections().toArray();
  const names = sortCollectionNames(
    collections.map((item) => sanitizeCollectionName(item?.name)).filter((name) => name && !name.startsWith('system.'))
  );
  const data = {};
  for (const name of names) {
    const docs = await conn.db.collection(name).find({}).toArray();
    data[name] = { count: docs.length, documents: docs };
  }
  return EJSON.serialize({
    version: 1,
    tenantId: tid,
    exportedAt: new Date(),
    collectionCount: names.length,
    counts: Object.fromEntries(names.map((name) => [name, Number(data[name]?.count || 0)])),
    collections: data
  });
}

export async function importTenantData(tenantId, rawPayload = {}, mode = 'keep_current') {
  const tid = normalizeTenantId(tenantId);
  const payload = normalizeImportPayload(rawPayload);
  const conn = await getTenantConnection(tid);
  const db = conn.db;
  const currentSettingsDefault = (await db.collection('settings').findOne({ key: 'default' }))?.data || {};
  const collectionNames = sortCollectionNames(Object.keys(payload.collections || {}));
  const stats = {};

  if (mode === 'overwrite') {
    const existingCollections = await db.listCollections().toArray();
    for (const item of existingCollections) {
      const name = sanitizeCollectionName(item?.name);
      if (!name || name.startsWith('system.')) continue;
      await db.collection(name).deleteMany({});
    }
    for (const name of collectionNames) {
      const docs = (payload.collections[name] || [])
        .map((doc) => cleanImportDoc(name, doc, currentSettingsDefault))
        .filter(Boolean);
      if (docs.length > 0) {
        await db.collection(name).insertMany(docs, { ordered: false });
      }
      stats[name] = { inserted: docs.length, updated: 0, skipped: 0 };
    }
    await syncTenantMetaFromSettings(tid);
    return {
      ok: true,
      tenantId: tid,
      mode,
      importedCollections: collectionNames.length,
      stats
    };
  }

  for (const name of collectionNames) {
    const docs = Array.isArray(payload.collections[name]) ? payload.collections[name] : [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    for (const rawDoc of docs) {
      const doc = cleanImportDoc(name, rawDoc, currentSettingsDefault);
      if (!doc) {
        skipped += 1;
        continue;
      }
      const filter = buildMergeFilter(name, doc);
      if (!filter) {
        await db.collection(name).insertOne(doc);
        inserted += 1;
        continue;
      }
      const replacement = { ...doc };
      if (!Object.prototype.hasOwnProperty.call(filter, '_id')) delete replacement._id;
      const exists = await db.collection(name).findOne(filter, { projection: { _id: 1 } });
      await db.collection(name).replaceOne(filter, replacement, { upsert: true });
      if (exists) updated += 1;
      else inserted += 1;
    }
    stats[name] = { inserted, updated, skipped };
  }
  await syncTenantMetaFromSettings(tid);
  return {
    ok: true,
    tenantId: tid,
    mode,
    importedCollections: collectionNames.length,
    stats
  };
}
