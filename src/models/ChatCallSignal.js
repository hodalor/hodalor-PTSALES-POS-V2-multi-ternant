import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const ChatCallSignalSchema = new mongoose.Schema({
  callId: { type: String, required: true, index: true },
  senderName: { type: String, required: true, index: true },
  recipientName: { type: String, required: true, index: true },
  signalType: { type: String, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  deliveredAt: { type: Date, default: null, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });

ChatCallSignalSchema.index({ recipientName: 1, deliveredAt: 1, createdAt: 1 });
ChatCallSignalSchema.index({ callId: 1, recipientName: 1, createdAt: 1 });

const { model, modelFor } = createTenantAwareModel('ChatCallSignal', ChatCallSignalSchema);
export { modelFor };
export default model;
