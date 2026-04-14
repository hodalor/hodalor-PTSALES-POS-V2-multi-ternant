import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const SupplierSchema = new mongoose.Schema({
  clientId: { type: String, unique: true, sparse: true, index: true },
  name: { type: String, required: true },
  contact: String,
  phone: String,
  email: String
}, { timestamps: true });

const { model, modelFor } = createTenantAwareModel('Supplier', SupplierSchema);
export { modelFor };
export default model;