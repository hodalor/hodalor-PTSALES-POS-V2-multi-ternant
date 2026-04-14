import mongoose from 'mongoose';

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

export default mongoose.model('Audit', AuditSchema);
