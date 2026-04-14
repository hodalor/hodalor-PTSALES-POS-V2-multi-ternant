import mongoose from 'mongoose';

const SaleItemSchema = new mongoose.Schema({
  productId: String,
  sku: String,
  name: String,
  variantId: String,
  spec: String,
  qty: Number,
  price: Number,
  priceTier: { type: String, default: 'retail' },
  soldUnitIds: { type: [String], default: [] },
  soldUnits: { type: [{ unitId: String, imei: String, serialNumber: String }], default: [] }
}, { _id: false });

const PaymentSchema = new mongoose.Schema({
  type: String,
  amount: Number
}, { _id: false });

const SaleSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  branchId: { type: String, required: true },
  sellerName: { type: String },
  customerId: { type: String, index: true },
  customerCode: { type: String, index: true },
  customerName: { type: String },
  customerPhone: { type: String },
  items: { type: [SaleItemSchema], default: [] },
  subtotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  costTotal: { type: Number, default: 0 },
  profitTotal: { type: Number, default: 0 },
  posType: { type: String, enum: ['retail', 'wholesale'], default: 'retail' },
  inventoryType: { type: String, enum: ['retail', 'wholesale'], default: 'retail' },
  defaultPriceTier: { type: String, enum: ['retail', 'wholesale', 'agent'], default: 'retail' },
  loyaltyPointsEarned: { type: Number, default: 0 },
  loyaltyPointsRedeemed: { type: Number, default: 0 },
  loyaltyDiscount: { type: Number, default: 0 },
  invoiceSerial: { type: String },
  receiptNumber: { type: String },
  payment_methods: { type: [PaymentSchema], default: [] },
  creditSaleId: { type: String, index: true },
  creditDueDate: { type: Date },
  creditAmountPaidNow: { type: Number, default: 0 },
  creditBalance: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
}, { timestamps: true });

SaleSchema.index({ created_at: -1 });

export default mongoose.model('Sale', SaleSchema);
