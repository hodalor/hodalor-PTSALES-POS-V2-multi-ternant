import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const ProductUnitSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  variantId: { type: String, default: '' },
  imei: { type: String, default: undefined, sparse: true, unique: true },
  serialNumber: { type: String, default: undefined, sparse: true, unique: true },
  inventoryType: { type: String, enum: ['retail', 'wholesale', 'warehouse'], default: 'retail' },
  branchId: { type: String, required: true },
  status: { type: String, enum: ['in_stock', 'reserved', 'sold', 'returned', 'adjusted_out'], default: 'in_stock', index: true },
  reservationToken: { type: String, default: '' },
  reservedAt: { type: Date, default: null },
  soldAt: { type: Date, default: null },
  soldSaleId: { type: String, default: '', index: true },
  lastReturnAt: { type: Date, default: null }
}, { timestamps: true, autoIndex: false });

ProductUnitSchema.index({ productId: 1, variantId: 1, branchId: 1, inventoryType: 1, status: 1 });
ProductUnitSchema.index({ reservationToken: 1, status: 1 });
ProductUnitSchema.index({ branchId: 1, status: 1 });
// Unique singles already cover exact IMEI/serial lookups; compound status variants were redundant.

const { model, modelFor } = createTenantAwareModel('ProductUnit', ProductUnitSchema);
export { modelFor };
export default model;
