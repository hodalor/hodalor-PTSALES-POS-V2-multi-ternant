import mongoose from 'mongoose';
import { createMasterModel } from './_tenantModel.js';

const SuperBinSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  tenantName: { type: String, default: '' },
  entityType: { type: String, required: true, index: true },
  collectionName: { type: String, required: true },
  sourceId: { type: String, required: true },
  displayName: { type: String, default: '' },
  secondaryText: { type: String, default: '' },
  summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  remark: { type: String, default: '' },
  deletedByName: { type: String, default: '' },
  deletedByRole: { type: String, default: '' },
  deletedByTenantId: { type: String, default: '' },
  deletedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

SuperBinSchema.index({ tenantId: 1, deletedAt: -1 });
SuperBinSchema.index({ entityType: 1, deletedAt: -1 });
SuperBinSchema.index({ tenantId: 1, entityType: 1, sourceId: 1, deletedAt: -1 });

const { model, modelFor } = createMasterModel('SuperBin', SuperBinSchema);

export { modelFor };
export default model;
