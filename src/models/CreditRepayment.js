import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const CreditRepaymentSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  creditSaleId: { type: String, required: true, index: true },
  customerId: { type: String, required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  paymentMethod: { type: String, default: 'cash' },
  remark: { type: String, default: '' },
  initiatedByName: { type: String, default: '' },
  initiatedByRole: { type: String, default: '' },
  approvedByName: { type: String, default: '' },
  approvedByRole: { type: String, default: '' },
  approvalId: { type: String, default: '', index: true },
  appliedAt: { type: Date },
  appliedAmount: { type: Number, default: 0 },
  daysAdded: { type: Number, default: 0 },
  approvedAt: { type: Date },
  rejectedAt: { type: Date },
  status: {
    type: String,
    enum: ['pending_director', 'pending_manager', 'approved', 'rejected'],
    default: 'pending_director',
    index: true
  }
}, { timestamps: true });

CreditRepaymentSchema.index({ customerId: 1, status: 1, createdAt: -1 });

const { model, modelFor } = createTenantAwareModel('CreditRepayment', CreditRepaymentSchema);
export { modelFor };
export default model;
