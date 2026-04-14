import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const BranchSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  code: { type: String },
  branchType: { type: String, enum: ['retail', 'wholesale', 'warehouse'], default: 'retail', index: true }
}, { timestamps: true });

const { model, modelFor } = createTenantAwareModel('Branch', BranchSchema);
export { modelFor };
export default model;