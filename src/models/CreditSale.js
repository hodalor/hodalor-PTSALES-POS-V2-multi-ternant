import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const CreditSaleItemSchema = new mongoose.Schema({
  productId: { type: String, default: '' },
  variantId: { type: String, default: '' },
  sku: { type: String, default: '' },
  name: { type: String, default: '' },
  qty: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  priceTier: { type: String, default: 'retail' }
}, { _id: false });

const PaymentHistorySchema = new mongoose.Schema({
  amount: { type: Number, default: 0 },
  paid_at: { type: Date, default: Date.now },
  approved_by: { type: String, default: '' },
  note: { type: String, default: '' }
}, { _id: false });

const CreditSaleSchema = new mongoose.Schema({
  customer_id: { type: String, required: true, index: true },
  saleId: { type: String, default: '', index: true },
  branchId: { type: String, default: '' },
  posType: { type: String, enum: ['retail', 'wholesale'], default: 'retail' },
  inventoryType: { type: String, enum: ['retail', 'wholesale'], default: 'retail' },
  items: { type: [CreditSaleItemSchema], default: [] },
  total_amount: { type: Number, default: 0 },
  amount_paid: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  due_date: { type: Date, required: true },
  overdue_days: { type: Number, default: 0 },
  penalty_per_day: { type: Number, default: 0 },
  accumulated_penalty: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'completed', 'overdue'], default: 'active', index: true },
  payment_history: { type: [PaymentHistorySchema], default: [] }
}, { timestamps: true });

CreditSaleSchema.index({ customer_id: 1, status: 1, due_date: 1 });

const { model, modelFor } = createTenantAwareModel('CreditSale', CreditSaleSchema);
export { modelFor };
export default model;