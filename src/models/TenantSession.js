import mongoose from 'mongoose';
import { getMasterConnection } from '../config/tenancy.js';

const TenantSessionSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  userName: { type: String, required: true, index: true },
  jti: { type: String, required: true, unique: true, index: true },
  role: { type: String, default: '' },
  expiresAt: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

TenantSessionSchema.index({ tenantId: 1, userName: 1 });

export function modelFor(conn) {
  return conn.models.TenantSession || conn.model('TenantSession', TenantSessionSchema);
}

export async function getTenantSessionModel() {
  const conn = await getMasterConnection();
  return modelFor(conn);
}

const TenantSession = new Proxy(function TenantSessionProxy() {}, {
  get(_target, prop) {
    return async (...args) => {
      const model = await getTenantSessionModel();
      const value = model[prop];
      if (typeof value === 'function') return value.apply(model, args);
      return value;
    };
  }
});

export default TenantSession;
