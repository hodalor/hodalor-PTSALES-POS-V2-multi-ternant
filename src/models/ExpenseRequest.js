import mongoose from 'mongoose';

const ExpenseRequestSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  branchId: String,
  date: Date,
  category: String,
  amount: Number,
  note: String,
  initiatorName: String,
  initiatorRole: String,
  status: { type: String, default: 'pending_approval' },
  approverName: String,
  approverRole: String,
  approvalRemark: String,
  rejectionRemark: String,
  approved_at: Date,
  rejected_at: Date
}, { timestamps: true });

ExpenseRequestSchema.index({ branchId: 1, status: 1, createdAt: -1 });
ExpenseRequestSchema.index({ clientId: 1 }, { unique: true, sparse: true });

export default mongoose.model('ExpenseRequest', ExpenseRequestSchema);
