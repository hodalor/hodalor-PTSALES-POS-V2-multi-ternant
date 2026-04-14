import mongoose from 'mongoose';

const ApprovalSchema = new mongoose.Schema({
  actionType: { type: String, required: true, index: true },
  referenceModel: { type: String, required: true, index: true },
  referenceId: { type: String, required: true, index: true },
  initiatedByName: { type: String, default: '' },
  initiatedByRole: { type: String, default: '' },
  directorApprovedByName: { type: String, default: '' },
  directorApprovedByRole: { type: String, default: '' },
  directorRemark: { type: String, default: '' },
  directorApprovedAt: { type: Date },
  managerApprovedByName: { type: String, default: '' },
  managerApprovedByRole: { type: String, default: '' },
  managerRemark: { type: String, default: '' },
  managerApprovedAt: { type: Date },
  rejectedByName: { type: String, default: '' },
  rejectedByRole: { type: String, default: '' },
  rejectionReason: { type: String, default: '' },
  rejectedAt: { type: Date },
  executedAt: { type: Date },
  status: {
    type: String,
    enum: ['pending_director', 'pending_manager', 'approved', 'rejected'],
    default: 'pending_director',
    index: true
  }
}, { timestamps: true });

ApprovalSchema.index({ status: 1, actionType: 1, createdAt: -1 });
ApprovalSchema.index({ actionType: 1, createdAt: -1 });
ApprovalSchema.index({ referenceModel: 1, referenceId: 1 }, { unique: true });

export default mongoose.model('Approval', ApprovalSchema);
