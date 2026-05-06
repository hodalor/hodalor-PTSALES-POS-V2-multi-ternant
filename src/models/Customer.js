import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const CustomerSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  customerCode: { type: String, unique: true, index: true },
  name: { type: String, required: true },
  phone: { type: String, index: true },
  email: { type: String, index: true },
  customerType: { type: String, enum: ['retail', 'distribution'], default: 'retail', index: true },
  dob: { type: Date },
  idType: { type: String, default: '' },
  idCardNumber: { type: String, index: true },
  idFront: { type: String },
  idBack: { type: String },
  businessCertificate: { type: String },
  address: { type: String },
  registrationBranchId: { type: String, index: true, default: '' },
  registrationBranchName: { type: String, default: '' },
  businessName: { type: String },
  businessAddress: { type: String },
  registrationNumber: { type: String, index: true },
  taxId: { type: String, index: true },
  businessPhone: { type: String },
  businessEmail: { type: String },
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
