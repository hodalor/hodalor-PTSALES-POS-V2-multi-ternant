import { TENANT_FEATURE_CATALOG } from './tenantAccess';

export const FEATURE_CATALOG = TENANT_FEATURE_CATALOG;

export function isFeatureEnabled(settings, key) {
  if (!key) return true;
  const flags = settings && settings.featureFlags ? settings.featureFlags : {};
  return flags?.[key] !== false;
}

export function setFeatureFlag(flags, key, enabled) {
  const next = { ...(flags || {}) };
  if (enabled) {
    if (key in next) delete next[key];
  } else {
    next[key] = false;
  }
  return next;
}
