import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const DiscountApprovalItemSchema = new mongoose.Schema({
  productId: { type: String, default: '' },
  variantId: { type: String, default: '' },
  sku: { type: String, default: '' },
  name: { type: String, default: '' },
  brand: { type: String, default: '' },
  spec: { type: String, default: '' },
  qty: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  priceTier: { type: String, default: 'retail' }
}, { _id: false });

const DiscountApprovalSchema = new mongoose.Schema({
  requestKey: { type: String, index: true },
  branchId: { type: String, required: true, index: true },
  branchName: { type: String, default: '' },
  posType: { type: String, enum: ['retail', 'wholesale', 'warehouse'], default: 'retail', index: true },
  inventoryType: { type: String, enum: ['retail', 'wholesale', 'warehouse'], default: 'retail', index: true },
  submittedByName: { type: String, required: true, index: true },
  submittedByRole: { type: String, default: '' },
  approvedByName: { type: String, default: '' },
  approvedByRole: { type: String, default: '' },
  approvedAt: { type: Date },
  reviewedDiscount: { type: Number, default: 0 },
  approvalRemark: { type: String, default: '' },
  rejectedByName: { type: String, default: '' },
  rejectedByRole: { type: String, default: '' },
  rejectedAt: { type: Date },
  rejectionRemark: { type: String, default: '' },
  completedByName: { type: String, default: '' },
  completedByRole: { type: String, default: '' },
  completedAt: { type: Date },
  completedSaleId: { type: String, default: '', index: true },
  completedInvoiceSerial: { type: String, default: '' },
  completedReceiptNumber: { type: String, default: '' },
  customerId: { type: String, default: '' },
  customerCode: { type: String, default: '' },
  customerName: { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  subtotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  itemCount: { type: Number, default: 0 },
  items: { type: [DiscountApprovalItemSchema], default: [] },
  salePayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: {
    type: String,
    enum: ['under_review', 'approved', 'rejected', 'completed', 'cancelled'],
    default: 'under_review',
    index: true
  }
}, { timestamps: true });

DiscountApprovalSchema.index({ status: 1, createdAt: -1 });
DiscountApprovalSchema.index({ submittedByName: 1, status: 1, createdAt: -1 });

const { model, modelFor } = createTenantAwareModel('DiscountApproval', DiscountApprovalSchema);
export { modelFor };
export default model;
