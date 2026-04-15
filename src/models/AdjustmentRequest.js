import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const AdjustmentRequestItemSchema = new mongoose.Schema({
  lineId: { type: String, default: '' },
  productId: String,
  variantId: String,
  delta: Number,
  unitIds: { type: [String], default: [] },
  selectedUnits: { type: [{ unitId: String, imei: String, serialNumber: String }], default: [] },
  serializedEntries: { type: [{ imei: String, serialNumber: String }], default: [] },
  remark: String,
  status: { type: String, enum: ['pending', 'accepted', 'cancelled'], default: 'pending' }
}, { _id: false });

const AdjustmentRequestSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  productId: String,
  variantId: String,
  branchId: String,
  delta: Number,
  remark: String,
  items: { type: [AdjustmentRequestItemSchema], default: [] },
  initiatorName: String,
  initiatorRole: String,
  status: { type: String, default: 'pending_approval' },
  directorApproverName: String,
  directorApproverRole: String,
  directorApprovalRemark: String,
  directorApproved_at: Date,
  managerApproverName: String,
  managerApproverRole: String,
  managerApprovalRemark: String,
  managerApproved_at: Date,
  approverName: String,
  approverRole: String,
  approvalRemark: String,
  rejectionRemark: String,
  approved_at: Date,
  rejected_at: Date
}, { timestamps: true });

AdjustmentRequestSchema.index({ branchId: 1, status: 1, createdAt: -1 });

const { model, modelFor } = createTenantAwareModel('AdjustmentRequest', AdjustmentRequestSchema);
export { modelFor };
export default model;
