import mongoose from 'mongoose';

const PurchaseRequestItemSchema = new mongoose.Schema({
  lineId: { type: String, default: '' },
  productId: String,
  variantId: String,
  baseUnits: Number,
  serializedEntries: { type: [{ imei: String, serialNumber: String }], default: [] },
  pack: String,
  supplier: String,
  cost: Number,
  costPerUnit: Number,
  expiryDate: Date,
  remark: String,
  status: { type: String, enum: ['pending', 'accepted', 'cancelled'], default: 'pending' }
}, { _id: false });

const PurchaseRequestSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  productId: String,
  variantId: String,
  branchId: String,
  baseUnits: Number,
  pack: String,
  supplier: String,
  cost: Number,
  costPerUnit: Number,
  expiryDate: Date,
  remark: String,
  items: { type: [PurchaseRequestItemSchema], default: [] },
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

PurchaseRequestSchema.index({ branchId: 1, status: 1, createdAt: -1 });
PurchaseRequestSchema.index({ clientId: 1 }, { unique: true, sparse: true });

export default mongoose.model('PurchaseRequest', PurchaseRequestSchema);
