import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }
}, { timestamps: true });

const { model, modelFor } = createTenantAwareModel('Category', CategorySchema);
export { modelFor };
export default model;