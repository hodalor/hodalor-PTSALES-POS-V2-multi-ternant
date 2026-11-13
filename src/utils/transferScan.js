export function normalizeScanCode(value) {
  return String(value || '').trim();
}

export function findProductByScanCode(products = [], code = '') {
  const q = normalizeScanCode(code);
  if (!q) return { product: null, variantId: '' };
  const lower = q.toLowerCase();
  for (const product of (Array.isArray(products) ? products : [])) {
    if (String(product?.barcode || '').trim() === q || String(product?.sku || '').trim().toLowerCase() === lower) {
      return { product, variantId: '' };
    }
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const variant = variants.find((row) => (
      String(row?.barcode || '').trim() === q || String(row?.sku || '').trim().toLowerCase() === lower
    ));
    if (variant) return { product, variantId: String(variant.id || '') };
  }
  return { product: null, variantId: '' };
}

export function productTrackType(product) {
  return String(product?.trackType || 'quantity').trim().toLowerCase() === 'serialized'
    ? 'serialized'
    : 'quantity';
}

export function findLoadedSerializedUnit(units = [], code = '') {
  const q = normalizeScanCode(code).toLowerCase();
  if (!q) return null;
  const matches = (Array.isArray(units) ? units : []).filter((unit) => (
    String(unit?.imei || '').trim().toLowerCase() === q
    || String(unit?.serialNumber || '').trim().toLowerCase() === q
    || String(unit?._id || '').trim().toLowerCase() === q
  ));
  return matches[0] || null;
}

export function unitAlreadyInBasket(items = [], unitId = '', code = '') {
  const id = String(unitId || '').trim();
  const q = normalizeScanCode(code).toLowerCase();
  return (Array.isArray(items) ? items : []).some((line) => {
    if (id && (Array.isArray(line?.unitIds) ? line.unitIds : []).map(String).includes(id)) return true;
    return (Array.isArray(line?.selectedUnits) ? line.selectedUnits : []).some((unit) => (
      (id && String(unit?.unitId || '') === id)
      || (q && (
        String(unit?.imei || '').trim().toLowerCase() === q
        || String(unit?.serialNumber || '').trim().toLowerCase() === q
      ))
    ));
  });
}

export function mergeSerializedUnitLine(prevItems = [], {
  productId,
  variantId = '',
  unit = {},
  names = {},
  extra = {}
} = {}) {
  const unitId = String(unit._id || unit.unitId || '').trim();
  const selectedUnit = {
    unitId,
    imei: String(unit.imei || '').trim(),
    serialNumber: String(unit.serialNumber || '').trim()
  };
  if (!unitId || !productId) {
    return { items: Array.isArray(prevItems) ? prevItems : [], added: false, duplicate: false };
  }
  const current = Array.isArray(prevItems) ? prevItems : [];
  if (unitAlreadyInBasket(current, unitId, selectedUnit.imei || selectedUnit.serialNumber)) {
    return { items: current, added: false, duplicate: true };
  }
  const idx = current.findIndex((line) => (
    String(line?.productId) === String(productId) && String(line?.variantId || '') === String(variantId || '')
  ));
  if (idx >= 0) {
    const next = [...current];
    const line = next[idx];
    next[idx] = {
      ...line,
      qty: Number(line.qty || 0) + 1,
      unitIds: [...(Array.isArray(line.unitIds) ? line.unitIds : []), unitId],
      selectedUnits: [...(Array.isArray(line.selectedUnits) ? line.selectedUnits : []), selectedUnit]
    };
    return { items: next, added: true, duplicate: false };
  }
  return {
    items: [...current, {
      lineId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId,
      variantId: variantId || '',
      name: names.name || names.productName || '',
      productName: names.productName || names.name || '',
      sku: names.sku || '',
      qty: 1,
      unitIds: [unitId],
      selectedUnits: [selectedUnit],
      serializedEntries: [],
      remark: '',
      status: 'accepted',
      ...extra
    }],
    added: true,
    duplicate: false
  };
}
