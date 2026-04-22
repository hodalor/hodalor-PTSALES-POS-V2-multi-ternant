import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const SupplierSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  name: { type: String, required: true },
  normalizedName: { type: String, index: true, default: '' },
  contact: String,
  phone: String,
  email: String,
  address: String,
  notes: String
}, { timestamps: true });

const { model, modelFor } = createTenantAwareModel('Supplier', SupplierSchema);
export { modelFor };
export default model;
