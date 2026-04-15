import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const SettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'default' },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const { model, modelFor } = createTenantAwareModel('Settings', SettingsSchema);
export { modelFor };
export default model;
