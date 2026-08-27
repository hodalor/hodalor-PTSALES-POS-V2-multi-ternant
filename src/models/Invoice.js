import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const InvoiceItemSchema = new mongoose.Schema({
  productId: String,
  variantId: String,
  sku: String,
  name: String,
  brand: String,
  spec: String,
  qty: Number,
  rate: Number,
  per: String,
  priceTier: { type: String, default: 'retail' }
}, { _id: false });

const InvoiceCustomerSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  address: String,
  customerCode: String,
  customerId: String,
  clientId: String,
  businessName: String,
  businessAddress: String,
  businessPhone: String,
  taxId: String
}, { _id: false });

const InvoiceSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  number: { type: String, index: true },
  date: { type: Date, default: Date.now },
  saleId: { type: String, index: true },
  source: { type: String, enum: ['manual','pos','wholesale-pos','warehouse-pos','wholesale-manual','warehouse-manual'], default: 'manual' },
  paymentStatus: { type: String, enum: ['paid','unpaid','active'], default: 'unpaid' },
  customer: { type: InvoiceCustomerSchema, default: {} },
  items: { type: [InvoiceItemSchema], default: [] },
  subtotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  deliveryNote: { type: String, default: '' },
  paymentTerms: { type: String, default: '' },
  otherRef: { type: String, default: '' },
  supplierRef: { type: String, default: '' },
  buyerOrderNo: { type: String, default: '' },
  despatchDocNo: { type: String, default: '' },
  deliveryDate: { type: String, default: '' },
  despatchedThrough: { type: String, default: '' },
  destination: { type: String, default: '' },
  termsOfDelivery: { type: String, default: '' }
}, { timestamps: true });

InvoiceSchema.index({ createdAt: -1 });

const { model, modelFor } = createTenantAwareModel('Invoice', InvoiceSchema);
export { modelFor };
export default model;
