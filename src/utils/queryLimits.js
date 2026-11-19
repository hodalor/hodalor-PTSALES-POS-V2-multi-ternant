/** Shared hard caps for list endpoints — prevents unbounded Mongo scans and egress. */

export const LIST_HARD_MAX = 500;
export const LIST_DEFAULT = 100;
export const SALES_HARD_MAX = 2000;
export const PRODUCT_UNITS_HARD_MAX = 500;
export const AUDIT_HARD_MAX = 1000;

export function clampLimit(value, { defaultLimit = LIST_DEFAULT, hardMax = LIST_HARD_MAX } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultLimit;
  return Math.min(hardMax, Math.max(1, Math.floor(n)));
}

export function wantsAllFlag(query = {}) {
  return ['1', 'true', 'yes'].includes(String(query?.all || '').trim().toLowerCase());
}

/**
 * Resolve a safe list limit. `all=1` no longer means unlimited —
 * it only raises the cap toward hardMaxAll (still bounded).
 */
export function resolveListLimit(query = {}, {
  defaultLimit = LIST_DEFAULT,
  hardMax = LIST_HARD_MAX,
  hardMaxAll = hardMax
} = {}) {
  if (wantsAllFlag(query)) {
    return clampLimit(query.limit || hardMaxAll, { defaultLimit: hardMaxAll, hardMax: hardMaxAll });
  }
  return clampLimit(query.limit || defaultLimit, { defaultLimit, hardMax });
}

export function resolvePage(query = {}) {
  const page = Math.max(1, Math.floor(Number(query.page || 1) || 1));
  return page;
}

export function daysAgoDate(days = 7) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - Math.max(0, Number(days) || 0));
  return d;
}
