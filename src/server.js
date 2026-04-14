import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import connectDb from './config/db.js';
import router from './routes/index.js';
import { parseAuth } from './middleware/auth.js';
import ServerLog from './models/ServerLog.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev', {
    skip: (req) => req.url.includes('/api/auth/me') || req.url.includes('/api/server-logs')
  }));
}
app.use(parseAuth);

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
app.listen(port, () => {
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
