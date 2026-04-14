import { openDB } from 'idb';

const DB_NAME = 'ptSalesOffline';
const STORE = 'queue';

let syncing = false;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    }
  });
}

export async function enqueue(type, payload) {
  const db = await getDb();
  const ts = Date.now();
  return db.add(STORE, { type, payload, ts });
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
      let ok = false;
      let attempt = 0;
      const maxAttempts = 3;
      while (!ok && attempt < maxAttempts) {
        try {
          // exponential backoff: 0, 1s, 3s
          if (attempt > 0) await sleep([0, 1000, 3000][attempt] || 5000);
          await syncHandler(item);
          ok = true;
        } catch {
          attempt += 1;
        }
      }
      if (ok) {
        await remove(item.id);
      } else {
        allOk = false;
        failed += 1;
        errors.push(`Failed item id=${item.id}`);
      }
    }
    return { ok: allOk, total, failed, errors };
  } finally {
    syncing = false;
  }
}
