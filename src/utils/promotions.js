import { getProductStockAtBranch } from './branchStock';

export function roundPromoMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

export function isComboLine(item) {
  return String(item?.lineType || '') === 'combo' || !!String(item?.comboId || '').trim();
}

export function promotionAppliesToBranch(promotion, branchId) {
  if (!promotion || promotion.active === false) return false;
  if (promotion.allBranches !== false) return true;
  return (Array.isArray(promotion.branchIds) ? promotion.branchIds : []).map(String).includes(String(branchId || ''));
}

export function findCatalogProduct(products, productId) {
  const key = String(productId || '');
  return (Array.isArray(products) ? products : []).find((product) => String(product?.id || product?._id || '') === key) || null;
}

export function componentUnitPrice(product, variantId = '') {
  if (!product) return 0;
  const variant = String(variantId || '')
    ? (Array.isArray(product.variants) ? product.variants : []).find((row) => String(row?.id || '') === String(variantId))
    : null;
  const source = variant || product;
  return Number(source.retailPrice ?? source.price ?? 0) || 0;
}

export function comboRegularTotal(combo, products) {
  return roundPromoMoney((Array.isArray(combo?.items) ? combo.items : []).reduce((sum, item) => {
    const product = findCatalogProduct(products, item.productId);
    return sum + (componentUnitPrice(product, item.variantId) * Math.max(0, Number(item.qty || 0)));
  }, 0));
}

export function reservedComponentQty(cartItems = [], productId = '', variantId = '', exceptLineId = '') {
  const pid = String(productId || '');
  const vid = String(variantId || '');
  return (Array.isArray(cartItems) ? cartItems : []).reduce((sum, item) => {
    if (exceptLineId && String(item?.id || '') === String(exceptLineId)) return sum;
    if (isComboLine(item)) {
      const sets = Math.max(0, Number(item.quantity || item.qty || 0));
      return sum + (Array.isArray(item.components) ? item.components : []).reduce((inner, component) => {
        if (String(component?.productId || '') !== pid) return inner;
        if (String(component?.variantId || '') !== vid) return inner;
        return inner + (sets * Math.max(0, Number(component.qty || 0)));
      }, 0);
    }
    if (String(item?.productId || '') !== pid) return sum;
    if (String(item?.variantId || '') !== vid) return sum;
    return sum + Math.max(0, Number(item.quantity || item.qty || 0));
  }, 0);
}

export function comboSetsAvailable(combo, products, branchId, cartItems = [], exceptLineId = '') {
  const items = Array.isArray(combo?.items) ? combo.items : (Array.isArray(combo?.components) ? combo.components : []);
  if (!branchId || items.length === 0) return 0;
  let sets = Infinity;
  items.forEach((item) => {
    const product = findCatalogProduct(products, item.productId);
    const each = Math.max(1, Number(item.qty || 0));
    const selectedUnits = Array.isArray(item.units) ? item.units : [];
    const serialized = selectedUnits.length > 0 || String(product?.trackType || '') === 'serialized';
    if (serialized) {
      const atBranch = selectedUnits.filter((unit) => String(unit?.branchId || '') === String(branchId));
      const reserved = reservedComponentQty(cartItems, item.productId, item.variantId, exceptLineId);
      const free = Math.max(0, atBranch.length - reserved);
      sets = Math.min(sets, Math.floor(free / each));
      return;
    }
    const stock = getProductStockAtBranch(product, {
      variantId: item.variantId,
      branchId,
      inventoryType: 'retail'
    });
    const reserved = reservedComponentQty(cartItems, item.productId, item.variantId, exceptLineId);
    const free = Math.max(0, stock - reserved);
    sets = Math.min(sets, Math.floor(free / each));
  });
  return Number.isFinite(sets) ? sets : 0;
}

export function syncPromoProfit({ promoPrice, profitAmount, profitPercent, edited }) {
  const price = Math.max(0, roundPromoMoney(promoPrice));
  if (edited === 'percent') {
    const percent = Math.max(0, roundPromoMoney(profitPercent));
    const amount = roundPromoMoney(price * percent / 100);
    return {
      promoPrice: price,
      profitPercent: price > 0 ? percent : 0,
      profitAmount: Math.min(price, amount)
    };
  }
  if (edited === 'price') {
    const percent = Math.max(0, roundPromoMoney(profitPercent));
    const amount = roundPromoMoney(price * percent / 100);
    return {
      promoPrice: price,
      profitPercent: price > 0 ? percent : 0,
      profitAmount: Math.min(price, amount)
    };
  }
  const amount = Math.min(price, Math.max(0, roundPromoMoney(profitAmount)));
  const percent = price > 0 ? roundPromoMoney((amount / price) * 100) : 0;
  return { promoPrice: price, profitAmount: amount, profitPercent: percent };
}
