const inFlight = new Set();
const completed = new Set();

export function claimRenewalVerify(key) {
  const lockKey = String(key || '').trim();
  if (!lockKey || completed.has(lockKey) || inFlight.has(lockKey)) return false;
  inFlight.add(lockKey);
  return true;
}

export function finishRenewalVerify(key) {
  const lockKey = String(key || '').trim();
  inFlight.delete(lockKey);
  if (lockKey) completed.add(lockKey);
}

export function releaseRenewalVerify(key) {
  inFlight.delete(String(key || '').trim());
}
