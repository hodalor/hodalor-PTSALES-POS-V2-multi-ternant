import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const ExpenseSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  branchId: { type: String, required: true },
  date: { type: Date, required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  note: { type: String, default: '' },
  createdBy: { type: String, default: '' }
}, { timestamps: true });

ExpenseSchema.index({ date: -1 });
ExpenseSchema.index({ branchId: 1, date: -1 });

const { model, modelFor } = createTenantAwareModel('Expense', ExpenseSchema);
export { modelFor };
export default model;