import mongoose from 'mongoose';

const BranchSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  code: { type: String },
  branchType: { type: String, enum: ['retail', 'wholesale', 'warehouse'], default: 'retail', index: true }
}, { timestamps: true });

export default mongoose.model('Branch', BranchSchema);
