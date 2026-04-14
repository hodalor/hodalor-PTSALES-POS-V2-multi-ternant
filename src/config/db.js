import mongoose from 'mongoose';
import ServerLog from '../models/ServerLog.js';

export default async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('No MONGODB_URI set, starting without database');
    try { await ServerLog.create({ level: 'warn', actor: 'server', message: 'No MONGODB_URI set; starting without database' }); } catch {}
    return;
  }
  if (mongoose.connection.readyState === 1) return;
  console.log('Mongo connecting...');
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000
  });
  console.log('Mongo connected');
  try { await ServerLog.create({ level: 'info', actor: 'server', message: 'Mongo connected' }); } catch {}
}
