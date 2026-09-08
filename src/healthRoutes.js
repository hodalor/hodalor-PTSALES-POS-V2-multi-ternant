import mongoose from 'mongoose';

function getDbStateSummary() {
  const hasConfiguredDb = !!String(process.env.MONGODB_URI || '').trim();
  const states = (Array.isArray(mongoose.connections) ? mongoose.connections : [])
    .map((conn) => Number(conn?.readyState || 0));
  const hasHealthyDb = states.some((state) => state === 1);

  return {
    hasConfiguredDb,
    hasHealthyDb,
    states
  };
}

export function registerHealthRoutes(app) {
  app.get('/', (_req, res) => {
    res.json({ ok: true, name: 'ptsales-backend' });
  });

  app.get('/health', (_req, res) => {
    const { hasConfiguredDb, hasHealthyDb, states } = getDbStateSummary();
    if (hasConfiguredDb && !hasHealthyDb) {
      return res.status(503).json({
        ok: false,
        name: 'ptsales-backend',
        dbConfigured: true,
        dbConnected: false,
        dbStates: states
      });
    }
    return res.json({
      ok: true,
      name: 'ptsales-backend',
      uptimeSeconds: Math.round(process.uptime()),
      dbConfigured: hasConfiguredDb,
      dbConnected: hasHealthyDb,
      dbStates: states
    });
  });

  app.get('/healthz', (_req, res) => {
    const { hasConfiguredDb, hasHealthyDb, states } = getDbStateSummary();
    res.json({
      ok: true,
      name: 'ptsales-backend',
      uptimeSeconds: Math.round(process.uptime()),
      dbConfigured: hasConfiguredDb,
      dbConnected: hasHealthyDb,
      dbStates: states
    });
  });

  app.get('/readyz', (_req, res) => {
    const { hasConfiguredDb, hasHealthyDb, states } = getDbStateSummary();
    if (hasConfiguredDb && !hasHealthyDb) {
      return res.status(503).json({
        ok: false,
        name: 'ptsales-backend',
        dbConfigured: true,
        dbConnected: false,
        dbStates: states
      });
    }
    return res.json({
      ok: true,
      name: 'ptsales-backend',
      dbConfigured: hasConfiguredDb,
      dbConnected: hasHealthyDb,
      dbStates: states
    });
  });
}
