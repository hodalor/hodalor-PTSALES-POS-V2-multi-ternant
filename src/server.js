import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import connectDb from './config/db.js';
import { runWithRequestContext } from './config/requestContext.js';
import router from './routes/index.js';
import { parseAuth } from './middleware/auth.js';
import { tenantContext } from './middleware/tenant.js';
import ServerLog from './models/ServerLog.js';
import Settings from './models/Settings.js';

dotenv.config();

const app = express();
const featureFlagCache = new Map();
const FEATURE_FLAG_CACHE_TTL_MS = 10_000;
app.use(cors());
app.use(express.json({ limit: '50mb' }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev', {
    skip: (req) => req.url.includes('/api/auth/me') || req.url.includes('/api/server-logs')
  }));
}
app.use(parseAuth);
app.use(tenantContext);
app.use((req, _res, next) => runWithRequestContext({
  db: req.db || null,
  tenantId: req.tenantId || req.user?.tenantId || 'master',
  user: req.user || null
}, next));
app.use('/api', async (req, res, next) => {
  const tenantId = String(req.user?.tenantId || req.tenantId || 'master').toLowerCase();
  const role = String(req.user?.role || '').toLowerCase();
  if (role === 'superadmin' && tenantId === 'master') return next();
  if (String(req.path || '').startsWith('/settings') && String(req.method || '').toUpperCase() === 'GET') return next();
  const feature = featureForApiPath(req.path || '');
  if (!feature) return next();
  try {
    const tenantKey = String(req.user?.tenantId || req.tenantId || 'master');
    const cached = featureFlagCache.get(tenantKey);
    let flags = null;
    if (cached && (Date.now() - cached.ts) < FEATURE_FLAG_CACHE_TTL_MS) {
      flags = cached.flags;
    } else {
      const doc = await Settings.findOne({ key: 'default' });
      flags = doc?.data?.featureFlags || {};
      featureFlagCache.set(tenantKey, { ts: Date.now(), flags });
    }
    if (flags[feature] === false) {
      return res.status(403).json({ error: 'Feature not enabled for this tenant' });
    }
  } catch {}
  next();
});

function errorMeaning(code) {
  const c = String(code || '');
  if (c === 'E11000') return 'Duplicate key error';
  if (c === 'ValidationError') return 'Validation failed';
  if (c === 'CastError') return 'Invalid ID or type cast failed';
  if (c === 'ECONNREFUSED') return 'Connection refused';
  if (c === 'ETIMEDOUT') return 'Operation timed out';
  if (c === 'ENOENT') return 'Resource not found on filesystem';
  return '';
}

function featureForApiPath(pathname) {
  const path = String(pathname || '');
  if (path.startsWith('/auth') || path.startsWith('/tenants')) return '';
  if (path.startsWith('/products')) return 'modules.products';
  if (path.startsWith('/branches')) return 'admin.config';
  if (path.startsWith('/sales')) return 'modules.sales';
  if (path.startsWith('/refunds')) return 'modules.refunds';
  if (path.startsWith('/stock')) return 'modules.inventory';
  if (path.startsWith('/suppliers')) return 'modules.suppliers';
  if (path.startsWith('/customers')) return 'modules.customers';
  if (path.startsWith('/settings')) return 'admin.config';
  if (path.startsWith('/users')) return 'admin.users';
  if (path.startsWith('/server-logs')) return 'admin.serverLogs';
  if (path.startsWith('/audits')) return 'admin.audit';
  if (path.startsWith('/cashsessions')) return 'admin.cashDrawer';
  if (path.startsWith('/expenses')) return 'modules.expenses';
  if (path.startsWith('/invoices')) return 'modules.invoices';
  if (path.startsWith('/purchases')) return 'modules.purchases';
  if (path.startsWith('/transfers')) return 'modules.transfers';
  if (path.startsWith('/adjustments')) return 'modules.adjustments';
  if (path.startsWith('/approvals')) return 'modules.approvalsCenter';
  if (path.startsWith('/wholesale')) return 'modules.wholesalePos';
  if (path.startsWith('/credits')) return 'modules.creditControl';
  if (path.startsWith('/product-units')) return 'modules.products';
  if (path.startsWith('/chat-messages')) return 'modules.communication';
  if (path.startsWith('/pt-ai')) return 'modules.communication';
  return '';
}

app.get('/', (req, res) => {
  res.json({ ok: true, name: 'ptsales-backend' });
});

app.use('/api', router);

app.use(async (err, req, res, next) => {
  try {
    const code = err && (err.code || err.name || err.err && err.err.code);
    await ServerLog.create({
      level: 'error',
      actor: req.user?.name || 'server',
      route: req.originalUrl || req.url || '',
      method: req.method || '',
      status: 500,
      message: err?.message || 'Unhandled error',
      errorCode: code ? String(code) : '',
      errorMeaning: errorMeaning(code),
      details: { body: req.body, query: req.query },
      stack: err?.stack || ''
    });
  } catch {}
  res.status(500).json({ error: 'Server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const port = process.env.PORT || 4000;
const server = app.listen(port, () => {
  console.log(`API on ${port}`);
  ServerLog.create({ level: 'info', message: `Server started on ${port}`, actor: 'server' }).catch(() => {});
  Promise.resolve().then(async () => {
    try {
      await connectDb();
    } catch (err) {
      console.error('Mongo connect error:', err?.message || String(err));
      ServerLog.create({
        level: 'error',
        actor: 'server',
        message: 'Mongo connect error',
        errorCode: err && (err.code || err.name) ? String(err.code || err.name) : '',
        errorMeaning: errorMeaning(err?.code || err?.name),
        stack: String(err?.stack || '')
      }).catch(() => {});
    }
  });
});
server.on('error', (err) => {
  const code = err && (err.code || err.name);
  console.error(`Server failed to start on port ${port}:`, err?.message || String(err));
  ServerLog.create({
    level: 'error',
    actor: 'server',
    message: `Server failed to start on port ${port}`,
    errorCode: code ? String(code) : '',
    errorMeaning: errorMeaning(code),
    stack: String(err?.stack || '')
  }).catch(() => {});
});

process.on('unhandledRejection', (reason) => {
  const code = reason && (reason.code || reason.name);
  ServerLog.create({
    level: 'error',
    actor: 'server',
    message: String(reason && reason.message || 'Unhandled rejection'),
    errorCode: code ? String(code) : '',
    errorMeaning: errorMeaning(code),
    stack: String(reason && reason.stack || '')
  }).catch(() => {});
});
process.on('uncaughtException', (err) => {
  const code = err && (err.code || err.name);
  ServerLog.create({
    level: 'error',
    actor: 'server',
    message: String(err && err.message || 'Uncaught exception'),
    errorCode: code ? String(code) : '',
    errorMeaning: errorMeaning(code),
    stack: String(err && err.stack || '')
  }).catch(() => {});
});
