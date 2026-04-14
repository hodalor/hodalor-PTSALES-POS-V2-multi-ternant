import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const ProductUnitSchema = new mongoose.Schema({
  productId: { type: String, required: true, index: true },
  variantId: { type: String, default: '', index: true },
  imei: { type: String, default: undefined, index: true, sparse: true, unique: true },
  serialNumber: { type: String, default: undefined, index: true, sparse: true, unique: true },
  inventoryType: { type: String, enum: ['retail', 'wholesale', 'warehouse'], default: 'retail', index: true },
  branchId: { type: String, required: true, index: true },
  status: { type: String, enum: ['in_stock', 'reserved', 'sold', 'returned', 'adjusted_out'], default: 'in_stock', index: true },
  reservationToken: { type: String, default: '', index: true },
  reservedAt: { type: Date, default: null },
  soldAt: { type: Date, default: null },
  soldSaleId: { type: String, default: '', index: true },
  lastReturnAt: { type: Date, default: null }
}, { timestamps: true });

ProductUnitSchema.index({ productId: 1, variantId: 1, branchId: 1, inventoryType: 1, status: 1 });
ProductUnitSchema.index({ reservationToken: 1, status: 1 });
ProductUnitSchema.index({ imei: 1, status: 1 });
ProductUnitSchema.index({ serialNumber: 1, status: 1 });
ProductUnitSchema.index({ branchId: 1, status: 1 });

const { model, modelFor } = createTenantAwareModel('ProductUnit', ProductUnitSchema);
export { modelFor };
export default model;