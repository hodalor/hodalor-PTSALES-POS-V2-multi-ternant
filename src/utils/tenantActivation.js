import { modelFor as TenantModelFor } from '../models/Tenant.js';
import { modelFor as SettingsModelFor } from '../models/Settings.js';

const ACTIVATION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACTIVATION_CODE_LENGTH = 10;
const ACTIVATION_TTL_MS = 30 * 24 * 3600 * 1000;
const ACTIVATION_EXTENSION_DAYS = 30;

function randomActivationCode() {
  let out = '';
  for (let i = 0; i < ACTIVATION_CODE_LENGTH; i += 1) {
    out += ACTIVATION_CODE_CHARS[Math.floor(Math.random() * ACTIVATION_CODE_CHARS.length)];
  }
  return out;
}

export function buildActivationWindow(now = Date.now()) {
  const issuedAt = new Date(now);
  const expiresAt = new Date(now + ACTIVATION_TTL_MS);
  return { issuedAt, expiresAt };
}

export function computeExtendedSubscriptionDate(currentValue, now = Date.now()) {
  const base = currentValue ? new Date(currentValue).getTime() : 0;
  const start = Number.isFinite(base) && base > now ? base : now;
  return new Date(start + (ACTIVATION_EXTENSION_DAYS * 24 * 3600 * 1000));
}

export async function generateUniqueTenantActivationCode(masterConn) {
  const TenantModel = TenantModelFor(masterConn);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomActivationCode();
    const exists = await TenantModel.exists({ activationCode: code, activationCodeExpiresAt: { $gt: new Date() } });
    if (!exists) return code;
  }
  throw new Error('Failed to generate unique activation code');
}

export async function refreshTenantActivationCode(masterConn, tenantId) {
  const TenantModel = TenantModelFor(masterConn);
  const code = await generateUniqueTenantActivationCode(masterConn);
  const { issuedAt, expiresAt } = buildActivationWindow();
  const updated = await TenantModel.findOneAndUpdate(
    { tenantId: String(tenantId || '') },
    {
      $set: {
        activationCode: code,
        activationCodeIssuedAt: issuedAt,
        activationCodeExpiresAt: expiresAt
      }
    },
    { new: true }
  );
  return updated;
}

export async function ensureTenantActivationCode(masterConn, tenantDoc) {
  if (tenantDoc?.activationCode && tenantDoc?.activationCodeExpiresAt && new Date(tenantDoc.activationCodeExpiresAt).getTime() > Date.now()) {
    return tenantDoc;
  }
  return refreshTenantActivationCode(masterConn, tenantDoc?.tenantId);
}

export async function syncTenantSubscriptionSnapshot(conn, payload = {}) {
  const Settings = SettingsModelFor(conn);
  const current = await Settings.findOne({ key: 'default' });
  const nextData = {
    ...(current?.data || {}),
    subscriptionPlan: payload.subscriptionPlan || current?.data?.subscriptionPlan || 'basic',
    subscriptionExpiresAt: payload.subscriptionExpiresAt || null,
    subscriptionPermanent: !!payload.subscriptionPermanent
  };
  await Settings.findOneAndUpdate(
    { key: 'default' },
    { key: 'default', data: nextData },
    { upsert: true, new: true }
  );
}

export async function activateTenantSubscription(masterConn, conn, tenantDoc) {
  const nextExpiry = computeExtendedSubscriptionDate(tenantDoc?.subscriptionExpiresAt);
  const updated = await TenantModelFor(masterConn).findOneAndUpdate(
    { tenantId: String(tenantDoc?.tenantId || '') },
    {
      $set: {
        subscriptionExpiresAt: nextExpiry,
        subscriptionPermanent: false,
        activationLastUsedAt: new Date()
      }
    },
    { new: true }
  );
  await syncTenantSubscriptionSnapshot(conn, {
    subscriptionPlan: updated?.subscriptionPlan || tenantDoc?.subscriptionPlan || 'basic',
    subscriptionExpiresAt: updated?.subscriptionExpiresAt || nextExpiry,
    subscriptionPermanent: false
  });
  await refreshTenantActivationCode(masterConn, tenantDoc?.tenantId);
  return updated;
}

export { ACTIVATION_CODE_LENGTH, ACTIVATION_EXTENSION_DAYS };
