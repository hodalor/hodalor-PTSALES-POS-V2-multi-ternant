import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

function ensureJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim() !== '') {
    console.log('JWT_SECRET present');
    return;
  }
  const secret = crypto.randomBytes(48).toString('hex');
  let content = '';
  try {
    content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  } catch {}
  if (!/^\s*$/.test(content) && !content.endsWith('\n')) content += '\n';
  content += `JWT_SECRET=${secret}\n`;
  fs.writeFileSync(envPath, content, 'utf8');
  console.log('JWT_SECRET created');
}

ensureJwtSecret();
