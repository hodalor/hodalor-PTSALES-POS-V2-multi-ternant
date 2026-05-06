function normalizeText(value) {
  return String(value || '').trim();
}

export function getProductBrand(product) {
  if (!product || typeof product !== 'object') return '';
  const direct = normalizeText(product.brand);
  if (direct) return direct;
  const attrs = Array.isArray(product.attributes) ? product.attributes : [];
  const match = attrs.find((attr) => String(attr?.key || '').trim().toLowerCase() === 'brand' && normalizeText(attr?.value));
  return match ? normalizeText(match.value) : '';
}

export function getProductSearchText(product) {
  if (!product || typeof product !== 'object') return '';
  const attrs = Array.isArray(product.attributes) ? product.attributes : [];
  const attrText = attrs
    .map((attr) => `${normalizeText(attr?.key)} ${normalizeText(attr?.value)}`.trim())
    .filter(Boolean)
    .join(' ');
  const variantLabel = normalizeText(product.label);
  return [
    normalizeText(product.name),
    normalizeText(product.sku),
    normalizeText(product.barcode),
    normalizeText(product.category),
    normalizeText(getProductBrand(product)),
    variantLabel,
    attrText
  ].filter(Boolean).join(' ').toLowerCase();
}
