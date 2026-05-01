import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const ReconciliationAccountSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  name: { type: String, required: true, trim: true },
  bankName: { type: String, default: '', trim: true },
  accountName: { type: String, default: '', trim: true },
  accountNumber: { type: String, default: '', trim: true },
  branchIds: { type: [String], default: [] },
  sharedAcrossBranches: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  balance: { type: Number, default: 0 },
  createdByName: { type: String, default: '' },
  updatedByName: { type: String, default: '' }
}, { timestamps: true });

ReconciliationAccountSchema.index({ active: 1, createdAt: -1 });
ReconciliationAccountSchema.index({ sharedAcrossBranches: 1, active: 1 });
ReconciliationAccountSchema.index({ branchIds: 1 });

const { model, modelFor } = createTenantAwareModel('ReconciliationAccount', ReconciliationAccountSchema);
export { modelFor };
export default model;
