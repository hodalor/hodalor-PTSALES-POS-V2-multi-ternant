function normalizeInventoryType(value = 'retail') {
  const kind = String(value || 'retail').toLowerCase();
  if (kind === 'warehouse') return 'warehouse';
  if (kind === 'wholesale') return 'wholesale';
  return 'retail';
}

function stockFieldForInventoryType(inventoryType = 'retail') {
  const kind = normalizeInventoryType(inventoryType);
  if (kind === 'warehouse') return 'warehouseStockByBranch';
  if (kind === 'wholesale') return 'wholesaleStockByBranch';
  return 'stockByBranch';
}

function mapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return value;
}

function keyFor({ productId = '', variantId = '', branchId = '', inventoryType = 'retail' }) {
  return [String(productId || ''), String(variantId || ''), String(branchId || ''), normalizeInventoryType(inventoryType)].join('::');
}

function branchInventoryType(branchTypeById, branchId, fallback = 'retail') {
  return normalizeInventoryType(branchTypeById.get(String(branchId || '')) || fallback);
}

function buildProductNameIndex(products = []) {
  const map = new Map();
  products.forEach((product) => {
    const name = String(product?.name || '').trim().toLowerCase();
    if (!name) return;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(String(product.id || product._id || ''));
  });
  return map;
}

function resolveProductId(rawProductId, rawProductName, productNameIndex) {
  const productId = String(rawProductId || '').trim();
  if (productId) return { productId, confidence: 'high' };
  const name = String(rawProductName || '').trim().toLowerCase();
  if (!name) return { productId: '', confidence: 'low' };
  const matches = productNameIndex.get(name) || [];
  if (matches.length === 1) return { productId: matches[0], confidence: 'medium' };
  return { productId: '', confidence: 'low' };
}

function makeDeltaLine({ productId = '', variantId = '', branchId = '', inventoryType = 'retail', delta = 0, confidence = 'high', source = '', ts = null } = {}) {
  const numericDelta = Number(delta || 0);
  if (!productId || !branchId || !Number.isFinite(numericDelta) || numericDelta === 0) return null;
  return {
    productId: String(productId),
    variantId: String(variantId || ''),
    branchId: String(branchId),
    inventoryType: normalizeInventoryType(inventoryType),
    mode: 'delta',
    value: numericDelta,
    confidence,
    source,
    ts
  };
}

function makeSetLine({ productId = '', variantId = '', branchId = '', inventoryType = 'retail', quantity = 0, confidence = 'high', source = '', ts = null } = {}) {
  const numericQty = Number(quantity || 0);
  if (!productId || !branchId || !Number.isFinite(numericQty) || numericQty < 0) return null;
  return {
    productId: String(productId),
    variantId: String(variantId || ''),
    branchId: String(branchId),
    inventoryType: normalizeInventoryType(inventoryType),
    mode: 'set',
    value: numericQty,
    confidence,
    source,
    ts
  };
}

function extractInventoryLinesFromAudit(audit, productNameIndex, branchTypeById) {
  const details = audit?.details || {};
  const ts = audit?.ts || audit?.createdAt || null;
  if (Array.isArray(details.inventoryLines) && details.inventoryLines.length > 0) {
    return details.inventoryLines
      .map((line) => makeDeltaLine({
        productId: line.productId,
        variantId: line.variantId,
        branchId: line.branchId,
        inventoryType: line.inventoryType,
        delta: line.delta,
        confidence: 'high',
        source: audit.actionType,
        ts
      }))
      .filter(Boolean);
  }

  const fallbackProduct = resolveProductId(details.productId, details.product, productNameIndex);
  if (audit.actionType === 'product_create' && details.initialStock > 0 && details.initialBranchId) {
    return [makeSetLine({
      productId: fallbackProduct.productId || String(details.productId || ''),
      branchId: details.initialBranchId,
      inventoryType: details.initialInventoryType || branchInventoryType(branchTypeById, details.initialBranchId, 'retail'),
      quantity: details.initialStock,
      confidence: fallbackProduct.confidence,
      source: audit.actionType,
      ts
    })].filter(Boolean);
  }
  if (audit.actionType === 'stock_set_manual') {
    return [makeSetLine({
      productId: fallbackProduct.productId,
      variantId: details.variantId || '',
      branchId: details.branchId || audit.branchId,
      inventoryType: details.inventoryType || branchInventoryType(branchTypeById, details.branchId || audit.branchId, 'retail'),
      quantity: details.quantity,
      confidence: fallbackProduct.confidence,
      source: audit.actionType,
      ts
    })].filter(Boolean);
  }
  return [];
}

function extractCurrentEntries(product) {
  const entries = [];
  const baseId = String(product.id || product._id || '');
  ['retail', 'wholesale', 'warehouse'].forEach((inventoryType) => {
    const field = stockFieldForInventoryType(inventoryType);
    const rows = mapToObject(product[field]);
    Object.entries(rows || {}).forEach(([branchId, qty]) => {
      entries.push({
        productId: baseId,
        variantId: '',
        branchId: String(branchId),
        inventoryType,
        currentQty: Number(qty || 0)
      });
    });
  });
  (Array.isArray(product.variants) ? product.variants : []).forEach((variant) => {
    ['retail', 'wholesale', 'warehouse'].forEach((inventoryType) => {
      const field = stockFieldForInventoryType(inventoryType);
      const rows = mapToObject(variant[field]);
      Object.entries(rows || {}).forEach(([branchId, qty]) => {
        entries.push({
          productId: baseId,
          variantId: String(variant.id || ''),
          branchId: String(branchId),
          inventoryType,
          currentQty: Number(qty || 0)
        });
      });
    });
  });
  return entries;
}

function pushLine(linesByKey, line) {
  if (!line) return;
  const key = keyFor(line);
  if (!linesByKey.has(key)) linesByKey.set(key, []);
  linesByKey.get(key).push(line);
}

function addRequestLines(linesByKey, rows, branchTypeById, mode) {
  (rows || []).forEach((row) => {
    const ts = row.approved_at || row.executedAt || row.updatedAt || row.createdAt || null;
    if (mode === 'purchase') {
      const items = Array.isArray(row.items) && row.items.length > 0 ? row.items : [{ productId: row.productId, variantId: row.variantId || '', baseUnits: row.baseUnits, status: 'accepted' }];
      const inventoryType = branchInventoryType(branchTypeById, row.branchId, 'retail');
      items.forEach((item) => {
        if (String(item.status || 'accepted').toLowerCase() === 'cancelled') return;
        pushLine(linesByKey, makeDeltaLine({
          productId: item.productId,
          variantId: item.variantId || '',
          branchId: row.branchId,
          inventoryType,
          delta: Number(item.baseUnits || 0),
          confidence: 'high',
          source: 'purchase_request',
          ts
        }));
      });
      return;
    }
    if (mode === 'transfer') {
      const items = Array.isArray(row.items) && row.items.length > 0 ? row.items : [{ productId: row.productId, variantId: row.variantId || '', qty: row.qty, status: 'accepted' }];
      const fromInventoryType = branchInventoryType(branchTypeById, row.from, 'retail');
      const toInventoryType = branchInventoryType(branchTypeById, row.to, 'retail');
      items.forEach((item) => {
        if (String(item.status || 'accepted').toLowerCase() === 'cancelled') return;
        const qty = Math.abs(Number(item.qty || 0));
        pushLine(linesByKey, makeDeltaLine({
          productId: item.productId,
          variantId: item.variantId || '',
          branchId: row.from,
          inventoryType: fromInventoryType,
          delta: -qty,
          confidence: 'high',
          source: 'transfer_request',
          ts
        }));
        pushLine(linesByKey, makeDeltaLine({
          productId: item.productId,
          variantId: item.variantId || '',
          branchId: row.to,
          inventoryType: toInventoryType,
          delta: qty,
          confidence: 'high',
          source: 'transfer_request',
          ts
        }));
      });
      return;
    }
    if (mode === 'adjustment') {
      const items = Array.isArray(row.items) && row.items.length > 0 ? row.items : [{ productId: row.productId, variantId: row.variantId || '', delta: row.delta, status: 'accepted' }];
      const inventoryType = branchInventoryType(branchTypeById, row.branchId, 'retail');
      items.forEach((item) => {
        if (String(item.status || 'accepted').toLowerCase() === 'cancelled') return;
        pushLine(linesByKey, makeDeltaLine({
          productId: item.productId,
          variantId: item.variantId || '',
          branchId: row.branchId,
          inventoryType,
          delta: Number(item.delta || 0),
          confidence: 'high',
          source: 'adjustment_request',
          ts
        }));
      });
      return;
    }
    if (mode === 'wholesale') {
      const items = Array.isArray(row.items) && row.items.length > 0 ? row.items : [{ productId: row.productId, variantId: row.variantId || '', qty: row.qty, adjustmentType: row.adjustmentType || 'increase', status: 'accepted' }];
      items.forEach((item) => {
        if (String(item.status || 'accepted').toLowerCase() === 'cancelled') return;
        const qty = Math.abs(Number(item.qty || 0));
        if (row.operationType === 'transfer') {
          pushLine(linesByKey, makeDeltaLine({
            productId: item.productId,
            variantId: item.variantId || '',
            branchId: row.fromBranchId,
            inventoryType: row.fromInventoryType || row.operationArea || 'wholesale',
            delta: -qty,
            confidence: 'high',
            source: 'wholesale_operation',
            ts
          }));
          pushLine(linesByKey, makeDeltaLine({
            productId: item.productId,
            variantId: item.variantId || '',
            branchId: row.toBranchId,
            inventoryType: row.toInventoryType || row.operationArea || 'wholesale',
            delta: qty,
            confidence: 'high',
            source: 'wholesale_operation',
            ts
          }));
          return;
        }
        if (row.operationType === 'adjustment') {
          const delta = String(item.adjustmentType || row.adjustmentType || 'increase').toLowerCase() === 'decrease' ? -qty : qty;
          pushLine(linesByKey, makeDeltaLine({
            productId: item.productId,
            variantId: item.variantId || '',
            branchId: row.branchId || row.fromBranchId,
            inventoryType: row.fromInventoryType || row.operationArea || 'wholesale',
            delta,
            confidence: 'high',
            source: 'wholesale_operation',
            ts
          }));
          return;
        }
        pushLine(linesByKey, makeDeltaLine({
          productId: item.productId,
          variantId: item.variantId || '',
          branchId: row.branchId || row.toBranchId,
          inventoryType: row.toInventoryType || row.fromInventoryType || row.operationArea || 'wholesale',
          delta: qty,
          confidence: 'high',
          source: 'wholesale_operation',
          ts
        }));
      });
    }
  });
}

function addSaleLines(linesByKey, sales) {
  (sales || []).forEach((sale) => {
    const ts = sale.createdAt || sale.created_at || null;
    (Array.isArray(sale.items) ? sale.items : []).forEach((item) => {
      pushLine(linesByKey, makeDeltaLine({
        productId: item.productId,
        variantId: item.variantId || '',
        branchId: sale.branchId,
        inventoryType: sale.inventoryType || 'retail',
        delta: -Math.abs(Number(item.qty || 0)),
        confidence: item.productId ? 'high' : 'low',
        source: 'sale',
        ts
      }));
    });
  });
}

function addRefundLines(linesByKey, refunds, branchTypeById) {
  (refunds || []).forEach((refund) => {
    if (!refund || !refund.approved_at || String(refund.restockMode || 'none') === 'none') return;
    const inventoryType = branchInventoryType(branchTypeById, refund.branchId, 'retail');
    const ts = refund.approved_at || refund.updatedAt || refund.createdAt || null;
    (Array.isArray(refund.restockItems) ? refund.restockItems : []).forEach((item) => {
      pushLine(linesByKey, makeDeltaLine({
        productId: item.productId,
        variantId: item.variantId || '',
        branchId: refund.branchId,
        inventoryType,
        delta: Math.abs(Number(item.qty || 0)),
        confidence: item.productId ? 'high' : 'low',
        source: 'refund_request',
        ts
      }));
    });
  });
}

export function buildInventoryConsistencyReport({
  products = [],
  audits = [],
  branches = [],
  purchases = [],
  transfers = [],
  adjustments = [],
  wholesaleOperations = [],
  sales = [],
  refunds = [],
  mismatchOnly = true,
  limit = 200
} = {}) {
  const branchTypeById = new Map((branches || []).map((branch) => [String(branch.id), String(branch.branchType || 'retail')]));
  const branchNameById = new Map((branches || []).map((branch) => [String(branch.id), String(branch.name || branch.id)]));
  const productNameIndex = buildProductNameIndex(products);

  const productById = new Map((products || []).map((product) => [String(product.id || product._id || ''), product]));
  const linesByKey = new Map();

  (audits || [])
    .slice()
    .sort((a, b) => new Date(a.ts || a.createdAt || 0).getTime() - new Date(b.ts || b.createdAt || 0).getTime())
    .forEach((audit) => {
      const lines = extractInventoryLinesFromAudit(audit, productNameIndex, branchTypeById);
      lines.forEach((line) => {
        const key = keyFor(line);
        if (!linesByKey.has(key)) linesByKey.set(key, []);
        linesByKey.get(key).push(line);
      });
    });
  addRequestLines(linesByKey, purchases, branchTypeById, 'purchase');
  addRequestLines(linesByKey, transfers, branchTypeById, 'transfer');
  addRequestLines(linesByKey, adjustments, branchTypeById, 'adjustment');
  addRequestLines(linesByKey, wholesaleOperations, branchTypeById, 'wholesale');
  addSaleLines(linesByKey, sales);
  addRefundLines(linesByKey, refunds, branchTypeById);

  const currentByKey = new Map();
  (products || []).forEach((product) => {
    extractCurrentEntries(product).forEach((entry) => {
      currentByKey.set(keyFor(entry), entry);
    });
  });

  const allKeys = new Set([...linesByKey.keys(), ...currentByKey.keys()]);
  const rows = [];
  allKeys.forEach((key) => {
    const movementLines = linesByKey.get(key) || [];
    const current = currentByKey.get(key) || {};
    const [productId, variantId, branchId, inventoryType] = key.split('::');
    const product = productById.get(productId);
    let expectedQty = 0;
    let baselineSeen = false;
    let confidence = 'high';
    movementLines.forEach((line) => {
      if (line.confidence === 'medium' && confidence === 'high') confidence = 'medium';
      if (line.confidence === 'low') confidence = 'low';
      if (line.mode === 'set') {
        expectedQty = Number(line.value || 0);
        baselineSeen = true;
      } else {
        expectedQty += Number(line.value || 0);
      }
    });
    if (movementLines.length === 0) confidence = 'low';
    else if (!baselineSeen && confidence === 'high') confidence = 'medium';
    const currentQty = Number(current.currentQty || 0);
    const difference = currentQty - expectedQty;
    const mismatch = difference !== 0;
    if (mismatchOnly && !mismatch) return;
    rows.push({
      productId,
      productName: product?.name || productId,
      sku: product?.sku || '',
      variantId: variantId || '',
      branchId: branchId || '',
      branchName: branchNameById.get(branchId || '') || branchId || '',
      inventoryType,
      currentQty,
      expectedQty,
      difference,
      mismatch,
      confidence,
      baselineSeen,
      movementCount: movementLines.length,
      lastMovementAt: movementLines[movementLines.length - 1]?.ts || null,
      sources: Array.from(new Set(movementLines.map((line) => line.source).filter(Boolean))).slice(0, 12)
    });
  });

  const sorted = rows
    .sort((a, b) => {
      const weight = { high: 0, medium: 1, low: 2 };
      const diff = Math.abs(b.difference) - Math.abs(a.difference);
      if (diff !== 0) return diff;
      return (weight[a.confidence] ?? 3) - (weight[b.confidence] ?? 3);
    })
    .slice(0, Math.max(1, Number(limit || 200)));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      productsScanned: products.length,
      auditsScanned: audits.length,
      mismatches: sorted.filter((row) => row.mismatch).length,
      highConfidenceMismatches: sorted.filter((row) => row.mismatch && row.confidence === 'high').length
    },
    rows: sorted
  };
}
