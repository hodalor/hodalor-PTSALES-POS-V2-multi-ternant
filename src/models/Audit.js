import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const AuditSchema = new mongoose.Schema({
  actor: String,
  actionType: String,
  details: mongoose.Schema.Types.Mixed,
  remark: String,
  branchId: String,
  tenantId: String,
  tenantName: String,
  severity: { type: String, default: 'info' },
  ts: { type: Date, default: Date.now },
  source: String
}, { timestamps: true });

AuditSchema.index({ ts: -1 });
AuditSchema.index({ severity: 1, ts: -1 });

const { model, modelFor } = createTenantAwareModel('Audit', AuditSchema);
export { modelFor };
export default model;
