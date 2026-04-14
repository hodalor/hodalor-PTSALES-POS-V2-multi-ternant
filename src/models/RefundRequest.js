import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const RefundRequestSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  saleId: String,
  invoiceSerial: String,
  receiptNumber: String,
  branchId: String,
  initiatorName: String,
  initiatorRole: String,
  type: { type: String, enum: ['full','partial'], default: 'full' },
  requestedAmount: Number,
  images: { type: [String], default: [] },
  remark: String,
  status: { type: String, default: 'pending_approval' },
  approverName: String,
  approverRole: String,
  approvalRemark: String,
  rejectionRemark: String,
  usedRestock: Boolean,
  restockMode: String,
  restockItems: [{ sku: String, productId: String, variantId: String, qty: Number, unitIds: [String] }],
  created_at: { type: Date, default: Date.now },
  approved_at: Date,
  rejected_at: Date
}, { timestamps: true });

const { model, modelFor } = createTenantAwareModel('RefundRequest', RefundRequestSchema);
export { modelFor };
export default model;