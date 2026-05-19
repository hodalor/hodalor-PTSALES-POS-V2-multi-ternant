import dotenv from 'dotenv';
import { connectMaster, getTenantConnection } from '../src/config/tenancy.js';
import { isDataUrl, isMediaStorageConfigured, sanitizeMediaForLogs, signMediaUrl, uploadMediaArray, uploadMediaString } from '../src/utils/mediaStorage.js';

dotenv.config();

function trimString(value = '') {
  return String(value || '').trim();
}

function buildStats() {
  return {
    scanned: 0,
    changed: 0,
    skipped: 0,
    errors: 0
  };
}

function mergeStats(target, source) {
  target.scanned += Number(source?.scanned || 0);
  target.changed += Number(source?.changed || 0);
  target.skipped += Number(source?.skipped || 0);
  target.errors += Number(source?.errors || 0);
}

async function normalizeStoredMedia(value, options = {}) {
  const current = trimString(value);
  if (!current) return '';
  if (isDataUrl(current)) {
    return uploadMediaString(current, options);
  }
  return signMediaUrl(current);
}

async function backfillMasterTenants(master) {
  const collection = master.db.collection('tenants');
  const rows = await collection.find({}, { projection: { tenantId: 1, logo: 1 } }).toArray();
  const stats = buildStats();
  for (const row of rows) {
    stats.scanned += 1;
    const current = trimString(row?.logo);
    const next = await normalizeStoredMedia(current, {
      tenantId: trimString(row?.tenantId) || 'master',
      folder: 'tenant-logos',
      originalName: `${trimString(row?.tenantId) || 'tenant'}-logo`
    });
    if (!next || next === current) {
      stats.skipped += 1;
      continue;
    }
    try {
      await collection.updateOne({ _id: row._id }, { $set: { logo: next } });
      stats.changed += 1;
    } catch (err) {
      stats.errors += 1;
      console.error('[master tenants] failed:', sanitizeMediaForLogs({ tenantId: row?.tenantId, error: err?.message || err }));
    }
  }
  return stats;
}

async function backfillSettings(connection, tenantId) {
  const collection = connection.db.collection('settings');
  const rows = await collection.find({ key: 'default' }, { projection: { data: 1 } }).toArray();
  const stats = buildStats();
  for (const row of rows) {
    stats.scanned += 1;
    const current = trimString(row?.data?.clientLogoUrl);
    const next = await normalizeStoredMedia(current, {
      tenantId,
      folder: 'tenant-logos',
      originalName: `${tenantId}-client-logo`
    });
    if (!next || next === current) {
      stats.skipped += 1;
      continue;
    }
    try {
      await collection.updateOne({ _id: row._id }, { $set: { 'data.clientLogoUrl': next } });
      stats.changed += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(`[${tenantId} settings] failed:`, sanitizeMediaForLogs({ error: err?.message || err }));
    }
  }
  return stats;
}

async function backfillProducts(connection, tenantId) {
  const collection = connection.db.collection('products');
  const rows = await collection.find({}, { projection: { sku: 1, name: 1, image: 1, variants: 1 } }).toArray();
  const stats = buildStats();
  for (const row of rows) {
    stats.scanned += 1;
    const set = {};
    try {
      const currentImage = trimString(row?.image);
      const nextImage = await normalizeStoredMedia(currentImage, {
          tenantId,
          folder: 'products',
          originalName: trimString(row?.sku) || trimString(row?.name) || 'product-image'
        });
      if (nextImage && nextImage !== currentImage) {
        set.image = nextImage;
      }
      const variants = Array.isArray(row?.variants) ? row.variants : [];
      for (let index = 0; index < variants.length; index += 1) {
        const variant = variants[index];
        const image = trimString(variant?.image);
        const nextImage = await normalizeStoredMedia(image, {
          tenantId,
          folder: 'product-variants',
          originalName: trimString(variant?.sku) || trimString(variant?.label) || `${trimString(row?.sku) || trimString(row?.name) || 'variant'}-${index + 1}`
        });
        if (nextImage && nextImage !== image) {
          set[`variants.${index}.image`] = nextImage;
        }
      }
      if (Object.keys(set).length === 0) {
        stats.skipped += 1;
        continue;
      }
      await collection.updateOne({ _id: row._id }, { $set: set });
      stats.changed += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(`[${tenantId} products] failed:`, sanitizeMediaForLogs({ sku: row?.sku, name: row?.name, error: err?.message || err }));
    }
  }
  return stats;
}

async function backfillCustomers(connection, tenantId) {
  const collection = connection.db.collection('customers');
  const rows = await collection.find({}, { projection: { name: 1, phone: 1, photo: 1, idFront: 1, idBack: 1, businessCertificate: 1 } }).toArray();
  const stats = buildStats();
  const fields = ['photo', 'idFront', 'idBack', 'businessCertificate'];
  for (const row of rows) {
    stats.scanned += 1;
    const set = {};
    try {
      for (const field of fields) {
        const current = trimString(row?.[field]);
        const nextValue = await normalizeStoredMedia(current, {
          tenantId,
          folder: 'customers',
          originalName: `${trimString(row?.phone) || trimString(row?.name) || 'customer'}-${field}`
        });
        if (nextValue && nextValue !== current) {
          set[field] = nextValue;
        }
      }
      if (Object.keys(set).length === 0) {
        stats.skipped += 1;
        continue;
      }
      await collection.updateOne({ _id: row._id }, { $set: set });
      stats.changed += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(`[${tenantId} customers] failed:`, sanitizeMediaForLogs({ name: row?.name, phone: row?.phone, error: err?.message || err }));
    }
  }
  return stats;
}

async function backfillRefunds(connection, tenantId) {
  const collection = connection.db.collection('refundrequests');
  const rows = await collection.find({}, { projection: { saleId: 1, receiptNumber: 1, images: 1 } }).toArray();
  const stats = buildStats();
  for (const row of rows) {
    stats.scanned += 1;
    const images = Array.isArray(row?.images) ? row.images : [];
    const nextImages = await Promise.all(images.map((item, index) => normalizeStoredMedia(item, {
      tenantId,
      folder: 'refunds',
      originalName: `${trimString(row?.saleId) || trimString(row?.receiptNumber) || 'refund'}-${index + 1}`
    })));
    const changed = nextImages.some((item, index) => item !== images[index]);
    if (!changed) {
      stats.skipped += 1;
      continue;
    }
    try {
      await collection.updateOne({ _id: row._id }, { $set: { images: nextImages } });
      stats.changed += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(`[${tenantId} refunds] failed:`, sanitizeMediaForLogs({ saleId: row?.saleId, receiptNumber: row?.receiptNumber, error: err?.message || err }));
    }
  }
  return stats;
}

async function backfillCashReconciliations(connection, tenantId) {
  const collection = connection.db.collection('cashreconciliations');
  const rows = await collection.find({}, { projection: { reconciliationNumber: 1, allocations: 1 } }).toArray();
  const stats = buildStats();
  for (const row of rows) {
    stats.scanned += 1;
    const allocations = Array.isArray(row?.allocations) ? row.allocations : [];
    const set = {};
    try {
      for (let index = 0; index < allocations.length; index += 1) {
        const allocation = allocations[index];
        const current = trimString(allocation?.proofImage);
        const nextValue = await normalizeStoredMedia(current, {
          tenantId,
          folder: 'cash-reconciliation-proofs',
          originalName: trimString(allocation?.proofName) || `${trimString(row?.reconciliationNumber) || 'reconciliation'}-${index + 1}`
        });
        if (nextValue && nextValue !== current) {
          set[`allocations.${index}.proofImage`] = nextValue;
        }
      }
      if (Object.keys(set).length === 0) {
        stats.skipped += 1;
        continue;
      }
      await collection.updateOne({ _id: row._id }, { $set: set });
      stats.changed += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(`[${tenantId} reconciliations] failed:`, sanitizeMediaForLogs({ reconciliationNumber: row?.reconciliationNumber, error: err?.message || err }));
    }
  }
  return stats;
}

async function backfillTenantMedia(tenantId) {
  const connection = await getTenantConnection(tenantId);
  const result = {
    tenantId,
    settings: await backfillSettings(connection, tenantId),
    products: await backfillProducts(connection, tenantId),
    customers: await backfillCustomers(connection, tenantId),
    refunds: await backfillRefunds(connection, tenantId),
    cashReconciliations: await backfillCashReconciliations(connection, tenantId)
  };
  return result;
}

function summarizeTenantResult(result) {
  const total = buildStats();
  mergeStats(total, result.settings);
  mergeStats(total, result.products);
  mergeStats(total, result.customers);
  mergeStats(total, result.refunds);
  mergeStats(total, result.cashReconciliations);
  return total;
}

async function main() {
  if (!isMediaStorageConfigured()) {
    throw new Error('Google Cloud Storage is not configured. Set the GCS env values first.');
  }
  const master = await connectMaster();
  const tenantRows = await master.db.collection('tenants').find({}, { projection: { tenantId: 1 } }).toArray();
  const tenantIds = tenantRows.map((row) => trimString(row?.tenantId)).filter(Boolean);

  console.log(`Starting media backfill for ${tenantIds.length} tenant database(s)...`);

  const globalTotal = buildStats();

  const masterTenants = await backfillMasterTenants(master);
  const masterSettings = await backfillSettings(master, 'master');
  mergeStats(globalTotal, masterTenants);
  mergeStats(globalTotal, masterSettings);

  console.log('Master tenants:', masterTenants);
  console.log('Master settings:', masterSettings);

  for (const tenantId of tenantIds) {
    console.log(`Processing tenant ${tenantId}...`);
    const result = await backfillTenantMedia(tenantId);
    const summary = summarizeTenantResult(result);
    mergeStats(globalTotal, summary);
    console.log(`Tenant ${tenantId} summary:`, summary);
  }

  console.log('Backfill complete.');
  console.log('Global summary:', globalTotal);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Media backfill failed:', err?.message || err);
    process.exit(1);
  });
