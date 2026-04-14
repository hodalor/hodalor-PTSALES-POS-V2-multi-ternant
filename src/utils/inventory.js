export function inventoryField(inventoryType = 'retail') {
  const kind = String(inventoryType || '').toLowerCase();
  if (kind === 'warehouse') return 'warehouseStockByBranch';
  if (kind === 'wholesale') return 'wholesaleStockByBranch';
  return 'stockByBranch';
}

export function getMapQty(mapLike, branchId) {
  if (!mapLike || !branchId) return 0;
  if (typeof mapLike.get === 'function') return Number(mapLike.get(branchId) || 0);
  return Number(mapLike[branchId] || 0);
}

export function setMapQty(mapLike, branchId, qty) {
  if (!mapLike || !branchId) return;
  if (typeof mapLike.set === 'function') {
    mapLike.set(branchId, qty);
    return;
  }
  mapLike[branchId] = qty;
}

export function resolveTierPrice(source, priceTier = 'retail', fallback = 0) {
  const tier = String(priceTier || 'retail').toLowerCase();
  if (tier === 'agent') {
    const v = Number(source?.agentPrice);
    if (Number.isFinite(v) && v > 0) return v;
  }
  if (tier === 'wholesale') {
    const v = Number(source?.wholesalePrice);
    if (Number.isFinite(v) && v > 0) return v;
  }
  const retail = Number(source?.retailPrice);
  if (Number.isFinite(retail) && retail > 0) return retail;
  const price = Number(source?.price);
  if (Number.isFinite(price) && price > 0) return price;
  return Number(fallback || 0);
}

export function ensureProductPricing(product) {
  if (!product) return;
  const base = Number(product.price || 0);
  if (!Number(product.retailPrice)) product.retailPrice = base;
  if (!Number(product.wholesalePrice)) product.wholesalePrice = base;
  if (!Number(product.agentPrice)) product.agentPrice = base;
  if (Array.isArray(product.variants)) {
    product.variants = product.variants.map(v => {
      const next = v;
      const vBase = Number(next.price != null ? next.price : base);
      if (!Number(next.retailPrice)) next.retailPrice = vBase;
      if (!Number(next.wholesalePrice)) next.wholesalePrice = vBase;
      if (!Number(next.agentPrice)) next.agentPrice = vBase;
      return next;
    });
  }
}

export function getStockTarget(product, variantId, inventoryType = 'retail') {
  const field = inventoryField(inventoryType);
  if (variantId) {
    const idx = Array.isArray(product?.variants) ? product.variants.findIndex(v => String(v.id) === String(variantId)) : -1;
    if (idx < 0) return null;
    const variant = product.variants[idx];
    if (!variant[field]) variant[field] = new Map();
    return {
      product,
      kind: 'variant',
      field,
      idx,
      container: variant[field]
    };
  }
  if (!product[field]) product[field] = new Map();
  return {
    product,
    kind: 'base',
    field,
    container: product[field]
  };
}

export function markInventoryModified(target) {
  if (!target?.product) return;
  if (target.kind === 'variant') {
    target.product.markModified('variants');
    return;
  }
  target.product.markModified(target.field);
}
