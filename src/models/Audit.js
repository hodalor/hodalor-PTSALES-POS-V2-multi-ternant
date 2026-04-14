import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const AuditSchema = new mongoose.Schema({
  actor: String,
  actionType: String,
  details: mongoose.Schema.Types.Mixed,
  remark: String,
  branchId: String,
  ts: { type: Date, default: Date.now },
  source: String
}, { timestamps: true });

AuditSchema.index({ ts: -1 });

const { model, modelFor } = createTenantAwareModel('Audit', AuditSchema);
export { modelFor };
export default model;