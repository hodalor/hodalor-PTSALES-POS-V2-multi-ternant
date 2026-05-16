function normalizeInventoryType(value = 'retail') {
  const kind = String(value || 'retail').toLowerCase();
  if (kind === 'warehouse') return 'warehouse';
  if (kind === 'wholesale') return 'wholesale';
  return 'retail';
}

function cleanLine(line = {}) {
  const delta = Number(line.delta || 0);
  return {
    productId: String(line.productId || ''),
    productName: String(line.productName || line.productId || ''),
    variantId: String(line.variantId || ''),
    variantLabel: String(line.variantLabel || ''),
    branchId: String(line.branchId || ''),
    inventoryType: normalizeInventoryType(line.inventoryType),
    delta,
    qty: Math.abs(delta),
    direction: delta >= 0 ? 'in' : 'out',
    reason: String(line.reason || ''),
    remark: String(line.remark || '')
  };
}

export function makeInventoryLine(input = {}) {
  return cleanLine(input);
}

export function summarizeInventoryLines(lines = []) {
  const normalized = lines
    .map(cleanLine)
    .filter((line) => line.productId && line.branchId && Number.isFinite(line.delta) && line.delta !== 0);
  const signedDeltaTotal = normalized.reduce((sum, line) => sum + Number(line.delta || 0), 0);
  const absoluteQtyTotal = normalized.reduce((sum, line) => sum + Math.abs(Number(line.delta || 0)), 0);
  return {
    inventoryLines: normalized,
    inventorySummary: {
      movementCount: normalized.length,
      absoluteQtyTotal,
      signedDeltaTotal
    }
  };
}

export function withInventoryAudit(details = {}, lines = []) {
  const summary = summarizeInventoryLines(lines);
  return {
    ...details,
    ...summary
  };
}
