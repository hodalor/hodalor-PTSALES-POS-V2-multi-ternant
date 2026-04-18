export const PRICE_GRANTS = {
  retail: 'view_retail_price',
  wholesale: 'view_wholesale_price',
  warehouse: 'view_warehouse_price',
  agent: 'view_agent_price'
};

const ORDER = ['retail', 'wholesale', 'warehouse', 'agent'];

export function getAllowedPriceTiers(auth = {}) {
  const role = String(auth?.role || '').toLowerCase();
  if (role === 'superadmin') return ORDER.slice();
  const grants = Array.isArray(auth?.grants) ? auth.grants : [];
  const explicit = ORDER.filter(tier => grants.includes(PRICE_GRANTS[tier]));
  return explicit.length > 0 ? explicit : ORDER.slice();
}

export function getPreferredPriceTier(allowed = [], preferred = 'retail') {
  const normalized = Array.isArray(allowed) && allowed.length > 0 ? allowed : ORDER.slice();
  if (normalized.includes(preferred)) return preferred;
  return normalized[0] || 'retail';
}

export function canViewPriceTier(auth, tier) {
  return getAllowedPriceTiers(auth).includes(String(tier || 'retail'));
}

export function getDisplayPrice(p, tier = 'retail') {
  if (!p) return 0;
  if (tier === 'agent') return Number(p.agentPrice != null ? p.agentPrice : (p.wholesalePrice != null ? p.wholesalePrice : (p.retailPrice != null ? p.retailPrice : p.price || 0)));
  if (tier === 'warehouse') return Number(p.warehousePrice != null ? p.warehousePrice : 0);
  if (tier === 'wholesale') return Number(p.wholesalePrice != null ? p.wholesalePrice : (p.retailPrice != null ? p.retailPrice : p.price || 0));
  return Number(p.retailPrice != null ? p.retailPrice : p.price || 0);
}

export function getPriceTierLabel(tier) {
  if (tier === 'wholesale') return 'Wholesale Price';
  if (tier === 'warehouse') return 'Warehouse Price';
  if (tier === 'agent') return 'Agent Price';
  return 'Retail Price';
}
