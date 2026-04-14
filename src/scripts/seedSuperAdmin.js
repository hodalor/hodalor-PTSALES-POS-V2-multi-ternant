import dotenv from 'dotenv';
import connectDb from '../config/db.js';
import User from '../models/User.js';
import { hashPin } from '../utils/pin.js';

dotenv.config();

async function run() {
  await connectDb();
  const name = 'superadmin';
  const role = 'SuperAdmin';
  const pin = '1234';
  let u = await User.findOne({ name });
  const pinHash = await hashPin(pin);
  if (!u) {
    u = await User.create({
      name,
      role,
      pinHash,
      assignedBranches: 'all',
      branchId: 'main',
      active: true
    });
    console.log('SuperAdmin created');
  } else {
    u.role = role;
    u.pinHash = pinHash;
    u.assignedBranches = 'all';
    u.branchId = u.branchId || 'main';
    u.active = true;
    await u.save();
    console.log('SuperAdmin updated');
  }
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
