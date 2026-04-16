import mongoose from 'mongoose';
import { getMasterConnection } from '../config/tenancy.js';

const TenantSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  dbName: { type: String, required: true },
  subscriptionPlan: { type: String, enum: ['basic', 'pro', 'enterprise'], default: 'basic' },
  features: { type: [String], default: [] },
  disabled: { type: Boolean, default: false },
  clientAppName: { type: String, default: '' },
  logo: { type: String, default: '' },
  themeColor: { type: String, default: '' },
  subscriptionExpiresAt: { type: Date, default: null },
  maxUserAccountsOverride: { type: Number, default: null },
  maxActiveUsersOverride: { type: Number, default: null }
}, { timestamps: true });

export function modelFor(conn) {
  const db = conn;
  return db.models.Tenant || db.model('Tenant', TenantSchema);
}

export async function getTenantModel() {
  const conn = await getMasterConnection();
  return modelFor(conn);
}

const Tenant = new Proxy(function TenantProxy() {}, {
  get(_target, prop) {
    return async (...args) => {
      const model = await getTenantModel();
      const value = model[prop];
      if (typeof value === 'function') return value.apply(model, args);
      return value;
    };
  }
});

export default Tenant;
