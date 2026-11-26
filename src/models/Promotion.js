import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const PromotionComboItemSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  variantId: { type: String, default: '' },
  name: { type: String, default: '' },
  qty: { type: Number, required: true },
  units: {
    type: [{
      unitId: String,
      imei: String,
      serialNumber: String,
      branchId: String
    }],
    default: []
  }
}, { _id: false });

const PromotionComboSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  image: { type: String, default: '' },
  promoPrice: { type: Number, required: true },
  profitAmount: { type: Number, required: true },
  profitPercent: { type: Number, required: true },
  items: { type: [PromotionComboItemSchema], default: [] }
}, { _id: false });

const PromotionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true },
  allBranches: { type: Boolean, default: true },
  branchIds: { type: [String], default: [] },
  combos: { type: [PromotionComboSchema], default: [] }
}, { timestamps: true });

PromotionSchema.index({ createdAt: -1 });
PromotionSchema.index({ active: 1, createdAt: -1 });

const { model, modelFor } = createTenantAwareModel('Promotion', PromotionSchema);
export { modelFor };
export default model;
