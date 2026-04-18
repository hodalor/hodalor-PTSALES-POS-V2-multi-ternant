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

function sortCollections(names = []) {
  return Array.from(new Set((names || []).map((name) => String(name || '').trim()).filter(Boolean))).sort((a, b) => {
    const ia = COLLECTION_ORDER.indexOf(a);
    const ib = COLLECTION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export function summarizeTenantTransferPayload(payload = {}) {
  const collections = payload?.collections && typeof payload.collections === 'object' ? payload.collections : {};
  const names = sortCollections(Object.keys(collections));
  const counts = {};
  let totalDocuments = 0;
  for (const name of names) {
    const value = collections[name];
    const docs = Array.isArray(value) ? value : (Array.isArray(value?.documents) ? value.documents : []);
    counts[name] = docs.length;
    totalDocuments += docs.length;
  }
  return {
    tenantId: String(payload?.tenantId || ''),
    collectionNames: names,
    counts,
    totalCollections: names.length,
    totalDocuments
  };
}

export async function parseTenantTransferFile(file) {
  const raw = await file.text();
  const parsed = JSON.parse(raw);
  return {
    raw: parsed,
    summary: summarizeTenantTransferPayload(parsed)
  };
}

export async function importTenantTransferInSteps({ payload, mode = 'keep_current', importFn, onProgress }) {
  if (!payload || typeof payload !== 'object') throw new Error('Import payload is required');
  if (typeof importFn !== 'function') throw new Error('Import function is required');
  const summary = summarizeTenantTransferPayload(payload);
  const names = summary.collectionNames;
  if (names.length === 0) throw new Error('Backup file does not contain any collections');

  const results = [];
  const startedAt = Date.now();
  const buildProgress = (extra = {}) => {
    const completedCollections = Number(extra.completedCollections || 0);
    const totalCollections = names.length;
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const remainingCollections = Math.max(0, totalCollections - completedCollections);
    const remainingMs = completedCollections > 0 ? Math.round((elapsedMs / completedCollections) * remainingCollections) : null;
    return {
      elapsedMs,
      remainingMs,
      startedAt,
      totalCollections,
      ...extra
    };
  };
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const collectionPayload = {
      ...payload,
      collections: {
        [name]: payload.collections?.[name]
      }
    };
    const percentage = Math.round((index / names.length) * 100);
    onProgress?.(buildProgress({
      phase: 'running',
      currentCollection: name,
      currentCount: summary.counts[name] || 0,
      completedCollections: index,
      totalCollections: names.length,
      percentage
    }));
    const result = await importFn({
      mode: index === 0 ? mode : 'keep_current',
      data: collectionPayload
    });
    results.push({ collection: name, result });
    onProgress?.(buildProgress({
      phase: 'running',
      currentCollection: name,
      currentCount: summary.counts[name] || 0,
      completedCollections: index + 1,
      totalCollections: names.length,
      percentage: Math.round(((index + 1) / names.length) * 100)
    }));
  }

  onProgress?.(buildProgress({
    phase: 'done',
    currentCollection: names[names.length - 1] || '',
    currentCount: summary.counts[names[names.length - 1]] || 0,
    completedCollections: names.length,
    totalCollections: names.length,
    percentage: 100,
    remainingMs: 0
  }));

  return {
    ok: true,
    summary,
    steps: results
  };
}

export function summarizeTenantImportResults(results = []) {
  const perCollection = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const step of results) {
    const collection = String(step?.collection || '');
    const stats = step?.result?.stats && typeof step.result.stats === 'object' ? step.result.stats : {};
    const current = stats[collection] || Object.values(stats)[0] || {};
    const row = {
      collection,
      inserted: Number(current?.inserted || 0),
      updated: Number(current?.updated || 0),
      skipped: Number(current?.skipped || 0)
    };
    inserted += row.inserted;
    updated += row.updated;
    skipped += row.skipped;
    perCollection.push(row);
  }
  return {
    inserted,
    updated,
    skipped,
    perCollection
  };
}

export function formatDurationMs(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
