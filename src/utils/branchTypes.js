export function normalizeBranchType(value = 'retail') {
  const kind = String(value || 'retail').trim().toLowerCase();
  if (kind === 'warehouse' || kind === 'wholesale') return kind;
  return 'retail';
}

export function filterBranchesByType(branches = [], branchType = 'retail') {
  const expectedType = normalizeBranchType(branchType);
  return (Array.isArray(branches) ? branches : []).filter(
    (branch) => normalizeBranchType(branch?.branchType) === expectedType
  );
}

export function getInventoryAreaName(branchType = 'retail') {
  const kind = normalizeBranchType(branchType);
  if (kind === 'warehouse') return 'warehouse';
  if (kind === 'wholesale') return 'distribution';
  return 'retail';
}
