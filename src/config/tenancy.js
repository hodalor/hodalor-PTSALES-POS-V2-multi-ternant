import mongoose from 'mongoose';

const tenantConnections = new Map();
let masterConnectionPromise = null;

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

export async function connectMaster() {
  if (masterConnectionPromise) return masterConnectionPromise;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');
  const dbName = getTenantDbName('master');
  const conn = mongoose.createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 15000
  });
  masterConnectionPromise = conn.asPromise().then(() => conn).catch((err) => {
    masterConnectionPromise = null;
    throw err;
  });
  return masterConnectionPromise;
}

export async function getMasterConnection() {
  return connectMaster();
}

export async function getTenantConnection(tenantId) {
  const tid = normalizeTenantId(tenantId);
  if (tid.toLowerCase() === 'master') return connectMaster();
  if (tenantConnections.has(tid)) return tenantConnections.get(tid);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');
  const conn = mongoose.createConnection(uri, {
    dbName: getTenantDbName(tid),
    serverSelectionTimeoutMS: 15000
  });
  const promise = conn.asPromise().then(() => conn).catch((err) => {
    tenantConnections.delete(tid);
    throw err;
  });
  tenantConnections.set(tid, promise);
  return promise;
}
