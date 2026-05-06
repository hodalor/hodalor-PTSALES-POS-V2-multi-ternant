import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const VariantSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  sku: { type: String, default: '' },
  price: { type: Number, default: 0 },
  retailPrice: { type: Number, default: 0 },
  wholesalePrice: { type: Number, default: 0 },
  warehousePrice: { type: Number, default: 0 },
  agentPrice: { type: Number, default: 0 },
  stockByBranch: { type: Map, of: Number, default: {} },
  wholesaleStockByBranch: { type: Map, of: Number, default: {} },
  warehouseStockByBranch: { type: Map, of: Number, default: {} }
}, { _id: false });

const PackSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, required: true }
}, { _id: false });

const AttrSchema = new mongoose.Schema({
  key: String,
  value: String
}, { _id: false });

const ProductSchema = new mongoose.Schema({
  id: { type: String, index: true },
  name: { type: String, required: true },
  brand: { type: String, default: '', index: true },
  sku: { type: String, required: true, unique: true },
  trackType: { type: String, enum: ['quantity', 'serialized'], default: 'quantity', index: true },
  price: { type: Number, required: true, default: 0 },
  retailPrice: { type: Number, default: 0 },
  wholesalePrice: { type: Number, default: 0 },
  warehousePrice: { type: Number, default: 0 },
  agentPrice: { type: Number, default: 0 },
  costPrice: { type: Number, default: 0 },
  category: { type: String },
  barcode: { type: String },
  image: { type: String },
  lowStock: { type: Number, default: 0 },
  wholesaleLowStock: { type: Number, default: 0 },
  warehouseLowStock: { type: Number, default: 0 },
  expiryDate: { type: Date },
  unitKind: { type: String, default: 'none' },
  unitValue: { type: Number },
  unitSymbol: { type: String },
  sizeLabel: { type: String },
  shoeSize: { type: String },
  attributes: { type: [AttrSchema], default: [] },
  packs: { type: [PackSchema], default: [] },
  variants: { type: [VariantSchema], default: [] },
  stockByBranch: { type: Map, of: Number, default: {} },
  wholesaleStockByBranch: { type: Map, of: Number, default: {} },
  warehouseStockByBranch: { type: Map, of: Number, default: {} },
  allowCredit: { type: Boolean, default: true },
  minimumCreditPercentage: { type: Number, default: 0 }
}, { timestamps: true, toJSON: { flattenMaps: true }, toObject: { flattenMaps: true } });

const { model, modelFor } = createTenantAwareModel('Product', ProductSchema);
export { modelFor };
export default model;
