import mongoose from 'mongoose';

const CreditRepaymentSchema = new mongoose.Schema({
  creditSaleId: { type: String, required: true, index: true },
  customerId: { type: String, required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  remark: { type: String, default: '' },
  initiatedByName: { type: String, default: '' },
  initiatedByRole: { type: String, default: '' },
  approvedByName: { type: String, default: '' },
  approvedByRole: { type: String, default: '' },
  approvalId: { type: String, default: '', index: true },
  approvedAt: { type: Date },
  rejectedAt: { type: Date },
  status: {
    type: String,
    enum: ['pending_director', 'pending_manager', 'approved', 'rejected'],
    default: 'pending_director',
    index: true
  }
}, { timestamps: true });

CreditRepaymentSchema.index({ customerId: 1, status: 1, createdAt: -1 });

export default mongoose.model('CreditRepayment', CreditRepaymentSchema);
