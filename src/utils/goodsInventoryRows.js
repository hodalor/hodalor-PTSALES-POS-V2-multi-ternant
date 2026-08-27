import { getBranchStock } from './branchStock';
import { getProductBrand } from './productSearch';

function getInventoryLowStock(product, inventoryType = 'retail') {
  if (inventoryType === 'warehouse') {
    return Number(product?.warehouseLowStock != null ? product.warehouseLowStock : (product?.lowStock || 0));
  }
  if (inventoryType === 'wholesale') {
    return Number(product?.wholesaleLowStock != null ? product.wholesaleLowStock : (product?.lowStock || 0));
  }
  return Number(product?.lowStock || 0);
}

export function buildGoodsInventoryRows(products = [], activeBranchId = '', inventoryType = 'retail') {
  const rows = [];
  (Array.isArray(products) ? products : []).forEach((product) => {
    const base = {
      ...product,
      id: String(product?.id || product?._id || ''),
      productId: String(product?.id || product?._id || ''),
      variantId: '',
      variantLabel: '',
      brand: getProductBrand(product),
      stock: Number(getBranchStock(product, activeBranchId, inventoryType) || 0),
      lowStock: getInventoryLowStock(product, inventoryType)
    };
    if (Array.isArray(product?.variants) && product.variants.length > 0) {
      product.variants.forEach((variant) => {
        rows.push({
          ...product,
          ...variant,
          id: `${String(product?.id || product?._id || '')}:${String(variant?.id || '')}`,
          productId: String(product?.id || product?._id || ''),
          variantId: String(variant?.id || ''),
          variantLabel: String(variant?.label || '').trim(),
          name: String(product?.name || ''),
          brand: getProductBrand(product),
          image: variant?.image || product?.image || '',
          sku: variant?.sku || product?.sku || '',
          barcode: variant?.barcode || product?.barcode || '',
          stock: Number(getBranchStock(variant, activeBranchId, inventoryType) || 0),
          lowStock: getInventoryLowStock(product, inventoryType)
        });
      });
      return;
    }
    rows.push(base);
  });
  return rows;
}
