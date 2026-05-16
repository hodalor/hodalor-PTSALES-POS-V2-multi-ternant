import { productSpec } from './productSpec';

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
    const meta = getProductDisplayMeta(products, item?.productId, item?.variantId, item);
    return [
      item?.productId,
      meta.productName,
      meta.variantLabel,
      meta.attributeText,
      item?.remark,
      item?.reason,
      item?.supplier,
      item?.sku
    ];
  });
}

export function getProductDisplayMeta(products = [], productId, variantId = '', fallback = {}) {
  const product = (Array.isArray(products) ? products : []).find((entry) => String(entry.id) === String(productId)) || null;
  const variant = variantId
    ? ((product?.variants || []).find((entry) => String(entry.id) === String(variantId)) || null)
    : null;
  const productName = String(fallback?.productName || fallback?.name || product?.name || productId || '').trim();
  const variantLabel = String(fallback?.variantLabel || fallback?.variant || variant?.label || variantId || '').trim();
  const attributeText = String(
    fallback?.attributeText
    || fallback?.spec
    || productSpec(variant ? { ...product, ...variant } : product)
    || ''
  ).trim();
  const sku = String(fallback?.sku || variant?.sku || product?.sku || '').trim();
  const secondaryLabel = variantLabel || attributeText || sku;
  return {
    product,
    variant,
    productName,
    variantLabel,
    attributeText,
    sku,
    secondaryLabel
  };
}

export function getOperationSearchValues(row = {}, products = [], branchNameById = new Map()) {
  const meta = getProductDisplayMeta(products, row?.productId, row?.variantId, row);
  const fromLabel = branchNameById.get(row?.fromBranchId || row?.from || row?.branchId) || row?.fromBranchId || row?.from || row?.branchId || '';
  const toLabel = branchNameById.get(row?.toBranchId || row?.to) || row?.toBranchId || row?.to || '';
  return [
    row?.transactionTitle,
    row?.productId,
    meta.productName,
    meta.variantLabel,
    meta.attributeText,
    meta.sku,
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
