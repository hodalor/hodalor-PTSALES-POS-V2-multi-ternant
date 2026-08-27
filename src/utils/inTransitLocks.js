import WholesaleOperation from '../models/WholesaleOperation.js';
import TransferRequest from '../models/TransferRequest.js';
import ProductUnit from '../models/ProductUnit.js';
import { getMapQty, getStockTarget } from './inventory.js';
import { normalizeTrackType } from './productUnits.js';

function normalizedLockStatuses() {
  return ['pending_manager'];
}

function asStringArray(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || '').trim()).filter(Boolean)));
}

export async function getOutgoingInTransitLocks({
  productId = '',
  variantId = '',
  branchId = '',
  inventoryType = 'retail',
  excludeWholesaleOperationId = '',
  excludeTransferRequestId = ''
} = {}) {
  const statuses = normalizedLockStatuses();
  const wholesaleRows = await WholesaleOperation.find({
    status: { $in: statuses },
    $or: [
      {
        operationType: 'transfer',
        fromBranchId: String(branchId || ''),
        fromInventoryType: String(inventoryType || 'retail'),
        items: { $elemMatch: { productId: String(productId || ''), variantId: String(variantId || ''), status: { $ne: 'cancelled' } } }
      },
      {
        operationType: 'adjustment',
        branchId: String(branchId || ''),
        fromInventoryType: String(inventoryType || 'retail'),
        items: { $elemMatch: { productId: String(productId || ''), variantId: String(variantId || ''), adjustmentType: 'decrease', status: { $ne: 'cancelled' } } }
      }
    ],
    ...(excludeWholesaleOperationId ? { _id: { $ne: excludeWholesaleOperationId } } : {})
  }).select('operationType status fromBranchId toBranchId branchId fromInventoryType toInventoryType items').lean();

  const retailRows = String(inventoryType || 'retail') === 'retail'
    ? await TransferRequest.find({
        status: { $in: statuses },
        from: String(branchId || ''),
        items: { $elemMatch: { productId: String(productId || ''), variantId: String(variantId || ''), status: { $ne: 'cancelled' } } },
        ...(excludeTransferRequestId ? { _id: { $ne: excludeTransferRequestId } } : {})
      }).select('status from to items').lean()
    : [];

  const quantityLocked = wholesaleRows.reduce((sum, row) => sum + (Array.isArray(row?.items) ? row.items : []).reduce((itemSum, item) => {
    const sameProduct = String(item?.productId || '') === String(productId || '');
    const sameVariant = String(item?.variantId || '') === String(variantId || '');
    const accepted = String(item?.status || 'accepted').toLowerCase() !== 'cancelled';
    const decreasing = String(row?.operationType || '') !== 'adjustment' || String(item?.adjustmentType || '').toLowerCase() === 'decrease';
    return itemSum + (sameProduct && sameVariant && accepted && decreasing ? Math.max(0, Number(item?.qty || 0)) : 0);
  }, 0), 0)
    + retailRows.reduce((sum, row) => sum + (Array.isArray(row?.items) ? row.items : []).reduce((itemSum, item) => {
      const sameProduct = String(item?.productId || '') === String(productId || '');
      const sameVariant = String(item?.variantId || '') === String(variantId || '');
      const accepted = String(item?.status || 'accepted').toLowerCase() !== 'cancelled';
      return itemSum + (sameProduct && sameVariant && accepted ? Math.max(0, Number(item?.qty || 0)) : 0);
    }, 0), 0);

  const unitIdsLocked = asStringArray([
    ...wholesaleRows.flatMap((row) => (Array.isArray(row?.items) ? row.items : []).flatMap((item) => {
      const sameProduct = String(item?.productId || '') === String(productId || '');
      const sameVariant = String(item?.variantId || '') === String(variantId || '');
      const accepted = String(item?.status || 'accepted').toLowerCase() !== 'cancelled';
      const decreasing = String(row?.operationType || '') !== 'adjustment' || String(item?.adjustmentType || '').toLowerCase() === 'decrease';
      return sameProduct && sameVariant && accepted && decreasing ? asStringArray(item?.unitIds) : [];
    })),
    ...retailRows.flatMap((row) => (Array.isArray(row?.items) ? row.items : []).flatMap((item) => {
      const sameProduct = String(item?.productId || '') === String(productId || '');
      const sameVariant = String(item?.variantId || '') === String(variantId || '');
      const accepted = String(item?.status || 'accepted').toLowerCase() !== 'cancelled';
      return sameProduct && sameVariant && accepted ? asStringArray(item?.unitIds) : [];
    }))
  ]);

  return {
    quantityLocked,
    unitIdsLocked,
    sources: {
      wholesale: wholesaleRows.map((row) => ({ id: String(row?._id || ''), status: String(row?.status || ''), operationType: String(row?.operationType || '') })),
      retail: retailRows.map((row) => ({ id: String(row?._id || ''), status: String(row?.status || '') }))
    }
  };
}

function buildUnavailableUnitError(message, unavailableRows = [], unavailableIds = []) {
  const error = new Error(message);
  error.status = 409;
  error.unavailableUnitIds = asStringArray([
    ...unavailableIds,
    ...unavailableRows.map((row) => String(row?._id || ''))
  ]);
  error.unavailableUnitCodes = asStringArray(unavailableRows.map((row) => String(row?.imei || row?.serialNumber || '')).filter(Boolean));
  return error;
}

export async function assertOutgoingSerializedAvailability({
  productId = '',
  variantId = '',
  branchId = '',
  inventoryType = 'retail',
  unitIds = [],
  reservationToken = '',
  excludeWholesaleOperationId = '',
  excludeTransferRequestId = '',
  purpose = 'transfer'
} = {}) {
  const requestedIds = asStringArray(unitIds);
  if (requestedIds.length === 0) return { lockedUnitIds: [] };
  const locks = await getOutgoingInTransitLocks({
    productId,
    variantId,
    branchId,
    inventoryType,
    excludeWholesaleOperationId,
    excludeTransferRequestId
  });
  const lockedSet = new Set(locks.unitIdsLocked.map(String));
  const rows = await ProductUnit.find({ _id: { $in: requestedIds } }, { _id: 1, imei: 1, serialNumber: 1, branchId: 1, inventoryType: 1, status: 1, reservationToken: 1 }).lean();
  const rowById = new Map(rows.map((row) => [String(row?._id || ''), row]));
  const unavailableIds = [];
  const unavailableRows = [];
  requestedIds.forEach((id) => {
    const row = rowById.get(String(id));
    const sameReservation =
      purpose === 'sale'
      && String(row?.status || '') === 'reserved'
      && String(row?.reservationToken || '') !== ''
      && String(row?.reservationToken || '') === String(reservationToken || '');
    const invalid = !row
      || String(row?.branchId || '') !== String(branchId || '')
      || String(row?.inventoryType || '') !== String(inventoryType || 'retail')
      || (!sameReservation && String(row?.status || '') !== 'in_stock')
      || lockedSet.has(String(id));
    if (!invalid) return;
    unavailableIds.push(String(id));
    if (row) unavailableRows.push(row);
  });
  if (unavailableIds.length > 0) {
    throw buildUnavailableUnitError(
      purpose === 'sale'
        ? 'Some serialized units are unavailable for sale because they are already in transit or no longer in stock'
        : 'Some serialized units are unavailable for transfer',
      unavailableRows,
      unavailableIds
    );
  }
  return {
    lockedUnitIds: locks.unitIdsLocked
  };
}

export async function assertOutgoingQuantityAvailability({
  product,
  productId = '',
  variantId = '',
  branchId = '',
  inventoryType = 'retail',
  qty = 0,
  excludeWholesaleOperationId = '',
  excludeTransferRequestId = '',
  purpose = 'transfer'
} = {}) {
  const target = getStockTarget(product, variantId, inventoryType);
  if (!target) {
    const error = new Error('Variant not found');
    error.status = 400;
    throw error;
  }
  const currentStock = getMapQty(target.container, branchId);
  const locks = await getOutgoingInTransitLocks({
    productId,
    variantId,
    branchId,
    inventoryType,
    excludeWholesaleOperationId,
    excludeTransferRequestId
  });
  const availableStock = Math.max(0, Number(currentStock || 0) - Number(locks.quantityLocked || 0));
  if (availableStock < Math.max(0, Number(qty || 0))) {
    const error = new Error(
      purpose === 'sale'
        ? 'Some quantity is already in transit or awaiting stock decrease approval and cannot be sold'
        : 'Insufficient available stock after accounting for in-transit items'
    );
    error.status = 409;
    error.currentStock = Number(currentStock || 0);
    error.lockedQty = Number(locks.quantityLocked || 0);
    error.availableQty = availableStock;
    throw error;
  }
  return {
    target,
    currentStock: Number(currentStock || 0),
    lockedQty: Number(locks.quantityLocked || 0),
    availableQty: availableStock
  };
}

export async function assertOutgoingAvailability({
  product,
  productId = '',
  variantId = '',
  branchId = '',
  inventoryType = 'retail',
  qty = 0,
  unitIds = [],
  reservationToken = '',
  excludeWholesaleOperationId = '',
  excludeTransferRequestId = '',
  purpose = 'transfer'
} = {}) {
  if (normalizeTrackType(product?.trackType) === 'serialized') {
    return assertOutgoingSerializedAvailability({
      productId,
      variantId,
      branchId,
      inventoryType,
      unitIds,
      reservationToken,
      excludeWholesaleOperationId,
      excludeTransferRequestId,
      purpose
    });
  }
  return assertOutgoingQuantityAvailability({
    product,
    productId,
    variantId,
    branchId,
    inventoryType,
    qty,
    excludeWholesaleOperationId,
    excludeTransferRequestId,
    purpose
  });
}
