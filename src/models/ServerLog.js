import mongoose from 'mongoose';

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

export default mongoose.model('ServerLog', ServerLogSchema);

