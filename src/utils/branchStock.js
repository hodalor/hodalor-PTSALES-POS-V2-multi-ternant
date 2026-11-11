export function normalizeBranchId(value) {
  return String(value || '').trim();
}

export function getInventoryStockMap(entity, inventoryType = 'retail') {
  if (!entity || typeof entity !== 'object') return {};
  const kind = String(inventoryType || 'retail').toLowerCase();
  if (kind === 'warehouse') return entity.warehouseStockByBranch || {};
  if (kind === 'wholesale') return entity.wholesaleStockByBranch || entity.stockByBranch || {};
  return entity.stockByBranch || {};
}

export function getBranchStock(entity, branchId, inventoryType = 'retail') {
  const source = getInventoryStockMap(entity, inventoryType);
  const normalizedBranchId = normalizeBranchId(branchId);
  if (!normalizedBranchId) return 0;
  if (Object.prototype.hasOwnProperty.call(source, normalizedBranchId)) {
    return Number(source[normalizedBranchId] || 0);
  }
  const matchedKey = Object.keys(source).find((key) => normalizeBranchId(key) === normalizedBranchId);
  return Number(matchedKey ? (source[matchedKey] || 0) : 0);
}

export function getTotalStock(entity, inventoryType = 'retail') {
  return Object.values(getInventoryStockMap(entity, inventoryType)).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}

export function getProductStockAtBranch(product, {
  variantId = '',
  branchId = '',
  inventoryType = 'retail'
} = {}) {
  if (!product || !branchId) return 0;
  const variant = String(variantId || '') && Array.isArray(product.variants)
    ? product.variants.find((row) => String(row?.id || '') === String(variantId))
    : null;
  return Math.max(0, Number(getBranchStock(variant || product, branchId, inventoryType) || 0));
}

export function getReservedLineQuantity(items = [], productId = '', variantId = '') {
  const pid = String(productId || '');
  const vid = String(variantId || '');
  if (!pid) return 0;
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    if (String(item?.productId || '') !== pid) return sum;
    if (String(item?.variantId || '') !== vid) return sum;
    const qty = Math.abs(Number(item?.qty ?? item?.quantity ?? item?.delta ?? 0));
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
}

export function clampAvailableQuantity(value, available) {
  const max = Math.max(0, Number(available) || 0);
  const next = Math.floor(Number(value));
  if (!Number.isFinite(next)) return 0;
  return Math.min(max, Math.max(0, next));
}
