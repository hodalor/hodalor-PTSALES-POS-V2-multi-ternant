import mongoose from 'mongoose';
import { getMasterConnection } from '../config/tenancy.js';

const TenantSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  dbName: { type: String, required: true },
  subscriptionPlan: { type: String, default: 'basic' },
  features: { type: [String], default: [] },
  disabled: { type: Boolean, default: false },
  clientAppName: { type: String, default: '' },
  billingEmail: { type: String, default: '' },
  billingPhone: { type: String, default: '' },
  billingAddress: { type: String, default: '' },
  billingCountry: { type: String, default: 'GH' },
  logo: { type: String, default: '' },
  themeColor: { type: String, default: '' },
  subscriptionExpiresAt: { type: Date, default: null },
  subscriptionPermanent: { type: Boolean, default: false },
  subscriptionAmount: { type: Number, default: null },
  activationCode: { type: String, default: '' },
  activationCodeIssuedAt: { type: Date, default: null },
  activationCodeExpiresAt: { type: Date, default: null },
  activationLastUsedAt: { type: Date, default: null },
  renewalHistory: {
    type: [{
      source: { type: String, default: '' },
      amount: { type: Number, default: null },
      daysAdded: { type: Number, default: null },
      previousExpiry: { type: Date, default: null },
      newExpiry: { type: Date, default: null },
      permanentBefore: { type: Boolean, default: false },
      permanentAfter: { type: Boolean, default: false },
      note: { type: String, default: '' },
      actorName: { type: String, default: '' },
      createdAt: { type: Date, default: Date.now }
    }],
    default: []
  },
  paymentHistory: {
    type: [{
      provider: { type: String, default: '' },
      method: { type: String, default: '' },
      channel: { type: String, default: '' },
      status: { type: String, default: '' },
      transactionRef: { type: String, default: '' },
      providerTransactionId: { type: String, default: '' },
      network: { type: String, default: '' },
      currencyCode: { type: String, default: '' },
      amount: { type: Number, default: null },
      months: { type: Number, default: null },
      createdAt: { type: Date, default: Date.now }
    }],
    default: []
  },
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
