import ServerLog from '../models/ServerLog.js';
import { connectMaster } from './tenancy.js';

export default async function connectDb() {
  if (!process.env.MONGODB_URI) {
    console.log('No MONGODB_URI set, starting without database');
    try { await ServerLog.create({ level: 'warn', actor: 'server', message: 'No MONGODB_URI set; starting without database' }); } catch {}
    return;
  }
  console.log('Mongo connecting...');
  await connectMaster();
  console.log('Mongo connected');
  try { await ServerLog.create({ level: 'info', actor: 'server', message: 'Mongo connected' }); } catch {}
}
