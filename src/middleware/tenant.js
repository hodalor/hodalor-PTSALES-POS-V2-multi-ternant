import { getMasterConnection, getTenantConnection, normalizeTenantId, resolveStoredTenantId } from '../config/tenancy.js';
import { safeErrorMessage } from '../utils/safeError.js';

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
    if (tenantId.toLowerCase() !== 'master') {
      const master = await getMasterConnection();
      const row = await master.db.collection('tenants').findOne({
        tenantId: { $regex: `^${tenantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
      }, { projection: { tenantId: 1 } });
      if (!row?.tenantId) return res.status(404).json({ error: 'Tenant not found' });
    }
    req.tenantId = tenantId;
    req.db = await getTenantConnection(tenantId);
    next();
  } catch (err) {
    res.status(400).json({ error: safeErrorMessage(err, 'Tenant could not be resolved') });
  }
}
