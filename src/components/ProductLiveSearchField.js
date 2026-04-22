import { useMemo } from 'react';

function buildProductLabel(product) {
  return [product?.name, product?.sku ? `SKU: ${product.sku}` : '', product?.barcode ? `Barcode: ${product.barcode}` : '']
    .filter(Boolean)
    .join(' • ');
}

function ProductLiveSearchField({
  label = 'Product',
  query,
  onQueryChange,
  products = [],
  allProducts,
  selectedProductId,
  onSelect,
  emptyText = 'No matching products',
  limit = 10
}) {
  const hasSearch = String(query || '').trim().length > 0;
  const selectedProduct = useMemo(
    () => (Array.isArray(allProducts) ? allProducts : products).find((product) => String(product?.id) === String(selectedProductId)) || null,
    [allProducts, products, selectedProductId]
  );
  const visibleProducts = Array.isArray(products) ? products.slice(0, limit) : [];

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label>
        <div style={{ marginBottom: 6, color: '#64748b' }}>{label}</div>
        <input
          className="input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Type name, SKU, barcode"
        />
      </label>
      {selectedProduct && !hasSearch ? (
        <div className="product-live-selected">
          Selected: {buildProductLabel(selectedProduct)}
        </div>
      ) : null}
      {hasSearch ? (
        <div className="product-live-results">
          {visibleProducts.length === 0 ? (
            <div className="product-live-empty">{emptyText}</div>
          ) : (
            visibleProducts.map((product) => {
              const selected = String(product?.id) === String(selectedProductId);
              return (
                <button
                  key={product.id}
                  type="button"
                  className={`product-live-option ${selected ? 'selected' : ''}`}
                  onClick={() => onSelect(product)}
                >
                  {buildProductLabel(product)}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export default ProductLiveSearchField;
