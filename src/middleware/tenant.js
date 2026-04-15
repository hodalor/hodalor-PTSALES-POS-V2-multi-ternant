import { getTenantConnection, normalizeTenantId, resolveStoredTenantId } from '../config/tenancy.js';

function readTenantId(req) {
  const bodyTenantId = req.body && typeof req.body === 'object' ? req.body.tenantId : '';
  const headerTenantId = req.header('x-tenant-id') || req.header('X-Tenant-Id') || '';
  const queryTenantId = req.query?.tenantId || '';
  return normalizeTenantId(req.user?.tenantId || bodyTenantId || headerTenantId || queryTenantId || 'master');
}

export async function tenantContext(req, res, next) {
  try {
    const requestedTenantId = readTenantId(req);
    const tenantId = await resolveStoredTenantId(requestedTenantId);
    req.tenantId = tenantId;
    req.db = await getTenantConnection(tenantId);
    next();
  } catch (err) {
    res.status(400).json({ error: err?.message || 'Tenant could not be resolved' });
  }
}
