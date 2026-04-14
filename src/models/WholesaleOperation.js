import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const WholesaleOperationItemSchema = new mongoose.Schema({
  lineId: { type: String, default: '' },
  productId: { type: String, required: true },
  variantId: { type: String, default: '' },
  qty: { type: Number, default: 0 },
  unitIds: { type: [String], default: [] },
  selectedUnits: { type: [{ unitId: String, imei: String, serialNumber: String }], default: [] },
  serializedEntries: { type: [{ imei: String, serialNumber: String }], default: [] },
  cost: { type: Number, default: 0 },
  requestedAmount: { type: Number, default: 0 },
  adjustmentType: { type: String, enum: ['increase', 'decrease'], default: 'increase' },
  supplier: { type: String, default: '' },
  reason: { type: String, default: '' },
  remark: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'accepted', 'cancelled'], default: 'pending' }
}, { _id: false });

const WholesaleOperationSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  operationArea: {
    type: String,
    enum: ['wholesale', 'warehouse'],
    default: 'wholesale',
    index: true
  },
  operationType: {
    type: String,
    enum: ['purchase', 'transfer', 'adjustment', 'refund'],
    required: true,
    index: true
  },
  productId: { type: String, required: true },
  variantId: { type: String, default: '' },
  branchId: { type: String, default: '' },
  fromBranchId: { type: String, default: '' },
  toBranchId: { type: String, default: '' },
  fromInventoryType: { type: String, enum: ['retail', 'wholesale', 'warehouse'], default: 'wholesale' },
  toInventoryType: { type: String, enum: ['retail', 'wholesale', 'warehouse'], default: 'wholesale' },
  qty: { type: Number, required: true, min: 0 },
  cost: { type: Number, default: 0 },
  requestedAmount: { type: Number, default: 0 },
  adjustmentType: { type: String, enum: ['increase', 'decrease'], default: 'increase' },
  supplier: { type: String, default: '' },
  reason: { type: String, default: '' },
  remark: { type: String, default: '' },
  items: { type: [WholesaleOperationItemSchema], default: [] },
  status: {
    type: String,
    enum: ['pending_director', 'pending_manager', 'approved', 'rejected'],
    default: 'pending_director',
    index: true
  },
  approvalId: { type: String, index: true },
  initiatedByName: { type: String, default: '' },
  initiatedByRole: { type: String, default: '' },
  executedAt: { type: Date }
}, { timestamps: true });

WholesaleOperationSchema.index({ operationArea: 1, operationType: 1, status: 1, createdAt: -1 });
WholesaleOperationSchema.index({ operationArea: 1, status: 1, createdAt: -1 });
WholesaleOperationSchema.index({ branchId: 1, status: 1, createdAt: -1 });
WholesaleOperationSchema.index({ fromBranchId: 1, status: 1, createdAt: -1 });
WholesaleOperationSchema.index({ toBranchId: 1, status: 1, createdAt: -1 });

const { model, modelFor } = createTenantAwareModel('WholesaleOperation', WholesaleOperationSchema);
export { modelFor };
export default model;