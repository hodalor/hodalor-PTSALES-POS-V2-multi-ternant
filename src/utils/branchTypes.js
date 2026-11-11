export function normalizeBranchType(value = 'retail') {
  const kind = String(value || 'retail').trim().toLowerCase();
  if (kind === 'warehouse') return 'warehouse';
  if (kind === 'wholesale' || kind === 'distribution') return 'wholesale';
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

export function getInventoryAreaLabel(branchType = 'retail') {
  const area = getInventoryAreaName(branchType);
  if (area === 'warehouse') return 'Warehouse';
  if (area === 'distribution') return 'Distribution';
  return 'Retail';
}

export function formatBranchInventoryLabel(branch = {}) {
  const name = String(branch?.name || branch?.code || branch?.id || 'Branch').trim() || 'Branch';
  return `${name} (${getInventoryAreaLabel(branch?.branchType)})`;
}

export function groupBranchesByInventoryType(branches = []) {
  const groups = [
    { key: 'wholesale', label: 'Distribution', items: [] },
    { key: 'warehouse', label: 'Warehouse', items: [] },
    { key: 'retail', label: 'Retail', items: [] }
  ];
  const byKey = Object.fromEntries(groups.map((group) => [group.key, group]));
  (Array.isArray(branches) ? branches : []).forEach((branch) => {
    const kind = normalizeBranchType(branch?.branchType);
    byKey[kind].items.push(branch);
  });
  return groups.filter((group) => group.items.length > 0);
}
