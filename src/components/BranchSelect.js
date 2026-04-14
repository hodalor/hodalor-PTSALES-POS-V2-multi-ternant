import { useSelector } from 'react-redux';
import { useEffect, useMemo } from 'react';

function BranchSelect({ value, onChange, enforceRole = true, rolesAllowed = ['Admin', 'Manager', 'Branch Manager'], includeSuperAdmin = true, className = 'select', style, includeAll = false, allLabel = 'All' }) {
  const auth = useSelector(s => s.auth);
  const branches = useSelector(s => s.branches.branches);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const roleLower = String(auth.role || '').toLowerCase();
  const assigned = auth.user?.assignedBranches || 'all';
  const allowedBranches = useMemo(() => {
    if (roleLower === 'superadmin' || roleLower === 'admin' || assigned === 'all') return branches;
    const ids = new Set(Array.isArray(assigned) ? assigned : [assigned]);
    return branches.filter(b => ids.has(b.id));
  }, [roleLower, assigned, branches]);
  const canChange = !enforceRole || rolesAllowed.includes(auth.role) || (includeSuperAdmin && roleLower === 'superadmin');
  const effValue = (enforceRole && !canChange) ? currentBranchId : (value ?? currentBranchId);
  useEffect(() => {
    const allowedIds = new Set(allowedBranches.map(b => b.id));
    if (includeAll) allowedIds.add('');
    if (!allowedIds.has(effValue) && allowedBranches[0] && onChange) {
      onChange(allowedBranches[0].id);
    }
  }, [effValue, allowedBranches, onChange, includeAll]);
  return (
    <select className={className} value={effValue} onChange={e => onChange && onChange(e.target.value)} disabled={!canChange} style={style}>
      {includeAll && <option value="">{allLabel}</option>}
      {allowedBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

export default BranchSelect;
