import { openDB } from 'idb';

const DB_NAME = 'ptSalesOffline';
const STORE = 'queue';

let syncing = false;

function reportQueuedSalesImeiDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'queued-sales-imei',
      runId: 'pre-fix',
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now()
    })
  }).catch(() => {});
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getDb() {
  return openDB(DB_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    }
  });
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function buildFingerprint(type, payload) {
  const p = payload || {};
  return `${String(type || '')}|${String(p.method || '')}|${String(p.path || '')}|${stableStringify(p.body ?? p)}`;
}

function normalizeErrorMessage(error) {
  const raw = String(error?.message || error || '').trim();
  return raw || 'Unknown sync error';
}

export async function enqueue(type, payload) {
  const db = await getDb();
  const ts = Date.now();
  const fingerprint = buildFingerprint(type, payload);
  const existing = (await db.getAll(STORE)).find((item) => String(item.fingerprint || '') === fingerprint);
  const record = {
    type,
    payload,
    ts,
    fingerprint,
    attempts: 0,
    lastError: '',
    lastAttemptAt: 0
  };
  if (existing?.id != null) {
    await db.put(STORE, { ...existing, ...record, id: existing.id });
    return existing.id;
  }
  return db.add(STORE, record);
}

export async function getAll() {
  const db = await getDb();
  return db.getAll(STORE);
}

export async function clear() {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.clear();
  await tx.done;
}

export async function remove(id) {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function removeMany(ids = []) {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  for (const id of ids) {
    if (id == null) continue;
    await tx.store.delete(id);
  }
  await tx.done;
}

export async function removeByFingerprint(fingerprint) {
  const db = await getDb();
  const items = await db.getAll(STORE);
  const matches = items.filter((item) => String(item.fingerprint || '') === String(fingerprint || ''));
  await removeMany(matches.map((item) => item.id));
}

export async function updateMeta(id, patch = {}) {
  const db = await getDb();
  const current = await db.get(STORE, id);
  if (!current) return;
  await db.put(STORE, { ...current, ...patch, id: current.id });
}

export async function attemptSync(syncHandler) {
  if (syncing) return false;
  syncing = true;
  try {
    const items = await getAll();
    items.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    let allOk = true;
    let total = items.length;
    let failed = 0;
    const errors = [];
    for (const item of items) {
      const isSaleItem = item?.type === 'sale'
        || String(item?.payload?.collection || '') === 'sales'
        || String(item?.payload?.path || '') === '/api/sales';
      let ok = false;
      let attempt = 0;
      const maxAttempts = 3;
      while (!ok && attempt < maxAttempts) {
        try {
          // exponential backoff: 0, 1s, 3s
          if (attempt > 0) await sleep([0, 1000, 3000][attempt] || 5000);
          await syncHandler(item);
          ok = true;
        } catch (e) {
          attempt += 1;
          if (attempt >= maxAttempts) {
            await updateMeta(item.id, {
              attempts: Number(item.attempts || 0) + attempt,
              lastError: normalizeErrorMessage(e),
              lastAttemptAt: Date.now()
            });
          }
        }
      }
      if (ok) {
        if (isSaleItem) {
          // #region debug-point E:queue-sale-remove
          reportQueuedSalesImeiDebug({
            hypothesisId: 'E',
            location: 'queue.js:attemptSync:remove-success',
            msg: '[DEBUG] Queue item removed after successful sale sync',
            data: {
              queueId: Number(item?.id || 0),
              fingerprint: String(item?.fingerprint || ''),
              collection: String(item?.payload?.collection || ''),
              path: String(item?.payload?.path || '/api/sales')
            }
          });
          // #endregion
        }
        await removeByFingerprint(item.fingerprint || buildFingerprint(item.type, item.payload));
      } else {
        allOk = false;
        failed += 1;
        const failedItem = (await getAll()).find((entry) => entry.id === item.id) || item;
        if (isSaleItem) {
          // #region debug-point E:queue-sale-retained
          reportQueuedSalesImeiDebug({
            hypothesisId: 'E',
            location: 'queue.js:attemptSync:retain-failed',
            msg: '[DEBUG] Queue item retained after failed sale sync',
            data: {
              queueId: Number(item?.id || 0),
              fingerprint: String(item?.fingerprint || ''),
              attempts: Number(failedItem?.attempts || 0),
              lastError: String(failedItem?.lastError || ''),
              collection: String(item?.payload?.collection || ''),
              path: String(item?.payload?.path || '/api/sales')
            }
          });
          // #endregion
        }
        errors.push(`Failed item id=${item.id}: ${failedItem.lastError || 'Unknown sync error'}`);
      }
    }
    return { ok: allOk, total, failed, errors };
  } finally {
    syncing = false;
  }
}
