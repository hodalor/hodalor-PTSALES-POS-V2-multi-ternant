import mongoose from 'mongoose';
import { createTenantAwareModel } from './_tenantModel.js';

const ChatMessageSchema = new mongoose.Schema({
  senderName: { type: String, required: true, index: true },
  senderRole: { type: String, default: '' },
  recipientName: { type: String, required: true, index: true },
  text: { type: String, required: true, trim: true },
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    senderName: { type: String, default: '' },
    text: { type: String, default: '' }
  },
  reactions: [{
    emoji: { type: String, required: true },
    users: [{ type: String }]
  }],
  readAt: { type: Date, default: null }
}, { timestamps: true });

ChatMessageSchema.index({ senderName: 1, recipientName: 1, createdAt: -1 });

const { model, modelFor } = createTenantAwareModel('ChatMessage', ChatMessageSchema);
export { modelFor };
export default model;
