export function normalizeFilterText(value) {
  return String(value || '').trim().toLowerCase();
}

export function matchesFilterText(values, query) {
  const term = normalizeFilterText(query);
  if (!term) return true;
  const haystack = (Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return haystack.includes(term);
}

export function getFilterDateValue(row = {}, field = 'created') {
  if (!row) return null;
  if (field === 'director') {
    return row.directorApproved_at || row.directorApprovedAt || row.approval?.directorApprovedAt || row.request?.directorApproved_at || row.request?.directorApprovedAt || null;
  }
  if (field === 'manager') {
    return row.managerApproved_at || row.managerApprovedAt || row.approval?.managerApprovedAt || row.request?.managerApproved_at || row.request?.managerApprovedAt || null;
  }
  if (field === 'decision') {
    return row.approved_at || row.approvedAt || row.rejected_at || row.rejectedAt || row.approval?.rejectedAt || row.executedAt || null;
  }
  if (field === 'updated') {
    return row.updatedAt || row.updated_at || null;
  }
  return row.createdAt || row.created_at || row.approval?.createdAt || row.request?.createdAt || row.ts || null;
}

export function isWithinDateRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  const fromTs = from ? new Date(from).getTime() : 0;
  const toDate = to ? new Date(to) : null;
  if (toDate) toDate.setHours(23, 59, 59, 999);
  const toTs = toDate ? toDate.getTime() : Number.MAX_SAFE_INTEGER;
  return timestamp >= fromTs && timestamp <= toTs;
}

export function matchesDateField(row, field, from, to) {
  return isWithinDateRange(getFilterDateValue(row, field), from, to);
}

export function formatDateTime(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

export function getItemSearchValues(row = {}, products = []) {
  const items = Array.isArray(row?.items) ? row.items : [];
  return items.flatMap((item) => {
    const product = products.find((entry) => String(entry.id) === String(item?.productId));
    const variantLabel = item?.variantId
      ? ((product?.variants || []).find((variant) => String(variant.id) === String(item.variantId))?.label || item.variantId)
      : '';
    return [
      item?.productId,
      product?.name,
      variantLabel,
      item?.remark,
      item?.reason,
      item?.supplier,
      item?.sku
    ];
  });
}

export function getOperationSearchValues(row = {}, products = [], branchNameById = new Map()) {
  const product = products.find((entry) => String(entry.id) === String(row?.productId));
  const variantLabel = row?.variantId
    ? ((product?.variants || []).find((variant) => String(variant.id) === String(row.variantId))?.label || row.variantId)
    : '';
  const fromLabel = branchNameById.get(row?.fromBranchId || row?.from || row?.branchId) || row?.fromBranchId || row?.from || row?.branchId || '';
  const toLabel = branchNameById.get(row?.toBranchId || row?.to) || row?.toBranchId || row?.to || '';
  return [
    row?.transactionTitle,
    row?.productId,
    product?.name,
    variantLabel,
    row?.reason,
    row?.remark,
    row?.supplier,
    row?.initiatedByName,
    row?.initiatedByRole,
    row?.initiatorName,
    row?.initiatorRole,
    row?.approvalRemark,
    row?.managerApprovalRemark,
    row?.directorApprovalRemark,
    row?.rejectionRemark,
    fromLabel,
    toLabel,
    ...getItemSearchValues(row, products)
  ];
}
