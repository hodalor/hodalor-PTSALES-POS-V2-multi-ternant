export function canCompleteManagerStageAsActor(user = {}, directorApproverName = '') {
  const role = String(user?.role || '').toLowerCase();
  if (['admin', 'superadmin'].includes(role)) return true;
  const director = String(directorApproverName || '').trim().toLowerCase();
  const actor = String(user?.name || '').trim().toLowerCase();
  if (!director || !actor) return true;
  return director !== actor;
}

export function directorApproverNameFromRow(row = {}) {
  return row.directorApproverName || row.directorApprovedByName || '';
}
