import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const CustomerSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  customerCode: { type: String, unique: true, index: true },
  name: { type: String, required: true },
  phone: { type: String, index: true },
  email: { type: String, index: true },
  dob: { type: Date },
  idCardNumber: { type: String, index: true },
  address: { type: String },
  photo: { type: String },
  vip: { type: Boolean, default: false },
  anniversaryDate: { type: Date },
  loyaltyPoints: { type: Number, default: 0 },
  maxCreditLimit: { type: Number, default: 0 },
  totalCreditPurchases: { type: Number, default: 0 },
  totalCreditPaid: { type: Number, default: 0 },
  outstandingBalance: { type: Number, default: 0 },
  overdueDays: { type: Number, default: 0 },
  onTimePayments: { type: Number, default: 0 },
  latePayments: { type: Number, default: 0 },
  creditScore: { type: Number, default: 100 },
  creditRank: { type: String, default: 'Bronze' }
}, { timestamps: true });

const { model, modelFor } = createTenantAwareModel('Customer', CustomerSchema);
export { modelFor };
export default model;