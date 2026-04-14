import mongoose from 'mongoose';

const MovementSchema = new mongoose.Schema({
  time: { type: Date, default: Date.now },
  type: { type: String, enum: ['in','out'], required: true },
  amount: { type: Number, required: true },
  note: String
}, { _id: false });

const CashSessionSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  branchId: String,
  cashierName: String,
  cashierRole: String,
  openingFloat: Number,
  isOpen: { type: Boolean, default: true },
  openedAt: { type: Date, default: Date.now },
  closedAt: Date,
  movements: { type: [MovementSchema], default: [] }
}, { timestamps: true });

CashSessionSchema.index({ openedAt: -1 });
CashSessionSchema.index({ cashierName: 1, isOpen: 1 });

export default mongoose.model('CashSession', CashSessionSchema);
