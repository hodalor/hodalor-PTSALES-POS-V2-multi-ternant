import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const AllocationSchema = new mongoose.Schema({
  accountId: { type: String, required: true },
  accountName: { type: String, default: '' },
  paymentMethod: { type: String, default: 'cash' },
  amount: { type: Number, required: true, min: 0 },
  proofImage: { type: String, default: '' },
  proofName: { type: String, default: '' },
  note: { type: String, default: '' }
}, { _id: false });

const PaymentBreakdownSchema = new mongoose.Schema({
  paymentMethod: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 }
}, { _id: false });

const CashReconciliationSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  reconciliationNumber: { type: String, default: '', index: true },
  branchId: { type: String, required: true, index: true },
  branchName: { type: String, default: '' },
  selectedDates: { type: [String], default: [] },
  expectedAmount: { type: Number, required: true, min: 0 },
  depositedAmount: { type: Number, required: true, min: 0 },
  variance: { type: Number, default: 0 },
  paymentBreakdown: { type: [PaymentBreakdownSchema], default: [] },
  allocations: { type: [AllocationSchema], default: [] },
  note: { type: String, default: '' },
  approvalId: { type: String, default: '', index: true },
  initiatedByName: { type: String, default: '' },
  initiatedByRole: { type: String, default: '' },
  approvedAt: { type: Date },
  rejectedAt: { type: Date },
  status: {
    type: String,
    enum: ['draft', 'pending_director', 'pending_manager', 'approved', 'rejected'],
    default: 'pending_director',
    index: true
  },
  executed: { type: Boolean, default: false }
}, { timestamps: true });

CashReconciliationSchema.index({ branchId: 1, status: 1, createdAt: -1 });
CashReconciliationSchema.index({ branchId: 1, selectedDates: 1 });
CashReconciliationSchema.index({ status: 1, createdAt: -1 });

const { model, modelFor } = createTenantAwareModel('CashReconciliation', CashReconciliationSchema);
export { modelFor };
export default model;
