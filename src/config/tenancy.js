import mongoose from 'mongoose';

const tenantConnections = new Map();
let baseConnectionPromise = null;
let masterConnectionPromise = null;
const resolvedTenantCache = new Map();
const RESOLVED_TENANT_TTL_MS = 30_000;
const RESOLVED_TENANT_CACHE_MAX = 200;

function mongoConnectionOptions() {
  return {
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: Math.max(1, Number(process.env.MONGODB_MAX_POOL_SIZE || 10)),
    minPoolSize: Math.max(0, Number(process.env.MONGODB_MIN_POOL_SIZE || 0)),
    maxIdleTimeMS: Math.max(5_000, Number(process.env.MONGODB_MAX_IDLE_MS || 30_000)),
    // Prevent Mongoose from ensuring indexes on every tenant DB warm-up in production.
    autoIndex: String(process.env.MONGODB_AUTO_INDEX || '').toLowerCase() === 'true'
      ? true
      : process.env.NODE_ENV !== 'production',
    // zlib ships with Node. snappy/zstd need optional native packages and can fail Cloud Run boot.
    compressors: ['zlib']
  };
}

export function normalizeTenantId(value) {
  const raw = String(value || 'master').trim();
  if (!raw) return 'master';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function getTenantDbName(tenantId) {
  const tid = normalizeTenantId(tenantId);
  if (tid.toLowerCase() === 'master') {
    return String(process.env.MONGODB_MASTER_DB || 'master');
  }
  return `db_${tid}`;
}

async function getBaseConnection() {
  if (baseConnectionPromise) return baseConnectionPromise;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');
  // One shared MongoClient/pool for the process; tenant DBs use useDb({ useCache: true }).
  const conn = mongoose.createConnection(uri, mongoConnectionOptions());
  baseConnectionPromise = conn.asPromise().then(() => conn).catch((err) => {
    baseConnectionPromise = null;
    throw err;
  });
  return baseConnectionPromise;
}

function cachedDb(base, dbName) {
  return base.useDb(dbName, { useCache: true });
}

export async function connectMaster() {
  if (masterConnectionPromise) return masterConnectionPromise;
  masterConnectionPromise = getBaseConnection()
    .then((base) => cachedDb(base, getTenantDbName('master')))
    .catch((err) => {
      masterConnectionPromise = null;
      throw err;
    });
  return masterConnectionPromise;
}

export async function getMasterConnection() {
  return connectMaster();
}

function rememberResolvedTenant(key, value) {
  resolvedTenantCache.set(key, { ts: Date.now(), value });
  if (resolvedTenantCache.size <= RESOLVED_TENANT_CACHE_MAX) return;
  const oldestKey = resolvedTenantCache.keys().next().value;
  if (oldestKey != null) resolvedTenantCache.delete(oldestKey);
}

export async function resolveStoredTenantId(tenantId) {
  const tid = normalizeTenantId(tenantId);
  if (!tid || tid.toLowerCase() === 'master') return 'master';
  const cacheKey = tid.toLowerCase();
  const cached = resolvedTenantCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < RESOLVED_TENANT_TTL_MS) return cached.value;
  const master = await getMasterConnection();
  const row = await master.db.collection('tenants').findOne({
    tenantId: { $regex: `^${tid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
  }, { projection: { tenantId: 1 } });
  const value = row?.tenantId ? String(row.tenantId) : tid;
  rememberResolvedTenant(cacheKey, value);
  return value;
}

export async function getTenantConnection(tenantId) {
  const tid = await resolveStoredTenantId(tenantId);
  if (tid.toLowerCase() === 'master') return connectMaster();
  if (tenantConnections.has(tid)) return tenantConnections.get(tid);
  const promise = getBaseConnection()
    .then((base) => cachedDb(base, getTenantDbName(tid)))
    .catch((err) => {
      tenantConnections.delete(tid);
      throw err;
    });
  tenantConnections.set(tid, promise);
  return promise;
}
