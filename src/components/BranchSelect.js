import { useSelector } from 'react-redux';
import { useEffect, useMemo } from 'react';
import { formatBranchInventoryLabel, groupBranchesByInventoryType, normalizeBranchType } from '../utils/branchTypes';

function BranchSelect({
  value,
  onChange,
  enforceRole = true,
  rolesAllowed = ['Admin', 'Manager', 'Branch Manager'],
  includeSuperAdmin = true,
  className = 'select',
  style,
  includeAll = false,
  allLabel = 'All',
  overrideBranches = null,
  groupByType = null,
  showTypeLabel = null
}) {
  const auth = useSelector(s => s.auth);
  const branches = useSelector(s => s.branches.branches);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const roleLower = String(auth.role || '').toLowerCase();
  const assigned = auth.user?.assignedBranches || 'all';
  const allowedBranches = useMemo(() => {
    if (Array.isArray(overrideBranches)) return overrideBranches;
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return branches;
    const ids = new Set(Array.isArray(assigned) ? assigned : [assigned]);
    return branches.filter(b => ids.has(b.id));
  }, [overrideBranches, roleLower, assigned, branches]);
  const mixedTypes = useMemo(() => {
    const types = new Set(allowedBranches.map((branch) => normalizeBranchType(branch?.branchType)));
    return types.size > 1;
  }, [allowedBranches]);
  const shouldGroup = groupByType ?? mixedTypes;
  const shouldShowType = showTypeLabel ?? mixedTypes;
  const groupedBranches = useMemo(
    () => (shouldGroup ? groupBranchesByInventoryType(allowedBranches) : [{ key: 'all', label: '', items: allowedBranches }]),
    [allowedBranches, shouldGroup]
  );
  const canChange = !enforceRole || rolesAllowed.includes(auth.role) || (includeSuperAdmin && roleLower === 'superadmin');
  const requestedValue = value ?? currentBranchId;
  const normalizedRequestedValue = includeAll && String(requestedValue || '').toLowerCase() === 'all' ? '' : requestedValue;
  const allowedIds = new Set(allowedBranches.map(b => String(b.id)));
  const fallbackValue = includeAll ? '' : (allowedBranches[0]?.id || '');
  const fixedValue = allowedIds.has(String(currentBranchId || '')) ? currentBranchId : (allowedBranches[0]?.id || '');
  const effValue = (enforceRole && !canChange)
    ? fixedValue
    : ((includeAll && String(normalizedRequestedValue || '') === '') || allowedIds.has(String(normalizedRequestedValue || ''))
      ? normalizedRequestedValue
      : fallbackValue);
  useEffect(() => {
    const nextAllowedIds = new Set(allowedBranches.map(b => String(b.id)));
    if (includeAll) {
      nextAllowedIds.add('');
      nextAllowedIds.add('all');
    }
    if (!nextAllowedIds.has(String(effValue || '')) && onChange) {
      onChange(includeAll ? '' : (allowedBranches[0]?.id || ''));
    }
  }, [effValue, allowedBranches, onChange, includeAll]);
  return (
    <select className={className} value={effValue} onChange={e => onChange && onChange(e.target.value)} disabled={!canChange} style={style}>
      {includeAll && <option value="">{allLabel}</option>}
      {groupedBranches.map((group) => {
        const options = group.items.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {shouldShowType ? formatBranchInventoryLabel(branch) : (branch.name || branch.code || branch.id)}
          </option>
        ));
        if (!shouldGroup || groupedBranches.length === 1) return options;
        return (
          <optgroup key={group.key} label={group.label}>
            {options}
          </optgroup>
        );
      })}
    </select>
  );
}

export default BranchSelect;
