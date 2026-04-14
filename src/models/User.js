import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  role: { type: String, required: true },
  pinHash: { type: String, required: true },
  assignedBranches: { type: mongoose.Schema.Types.Mixed, default: 'all' },
  branchId: { type: String, default: 'main' },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const { model, modelFor } = createTenantAwareModel('User', UserSchema);
export { modelFor };
export default model;