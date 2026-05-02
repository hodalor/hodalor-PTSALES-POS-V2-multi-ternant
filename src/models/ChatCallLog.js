import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const ChatCallLogSchema = new mongoose.Schema({
  callId: { type: String, required: true, unique: true, index: true },
  callerName: { type: String, required: true, index: true },
  calleeName: { type: String, required: true, index: true },
  status: { type: String, default: 'ringing', index: true },
  startedAt: { type: Date, default: Date.now },
  answeredAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  durationSec: { type: Number, default: 0 },
  endedBy: { type: String, default: '' },
  endReason: { type: String, default: '' }
}, { timestamps: true });

ChatCallLogSchema.index({ callerName: 1, calleeName: 1, startedAt: -1 });

const { model, modelFor } = createTenantAwareModel('ChatCallLog', ChatCallLogSchema);
export { modelFor };
export default model;
