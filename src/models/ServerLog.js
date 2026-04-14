import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const ServerLogSchema = new mongoose.Schema({
  level: { type: String, default: 'info' },
  ts: { type: Date, default: Date.now },
  actor: String,
  route: String,
  method: String,
  status: Number,
  message: String,
  errorCode: String,
  errorMeaning: String,
  details: mongoose.Schema.Types.Mixed,
  stack: String
}, { timestamps: true });

ServerLogSchema.index({ ts: -1 });

const { model, modelFor } = createTenantAwareModel('ServerLog', ServerLogSchema);
export { modelFor };
export default model;