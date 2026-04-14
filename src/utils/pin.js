import crypto from 'crypto';

function scryptAsync(password, salt, keylen = 64) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scryptAsync(String(pin), salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPin(pin, hash) {
  try {
    const parts = String(hash || '').split(':');
    if (parts[0] !== 'scrypt') return false;
    const salt = parts[1];
    const keyHex = parts[2];
    const keyBuf = Buffer.from(keyHex, 'hex');
    const derived = await scryptAsync(String(pin), salt, keyBuf.length);
    return crypto.timingSafeEqual(derived, keyBuf);
  } catch {
    return false;
  }
}
