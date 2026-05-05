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
