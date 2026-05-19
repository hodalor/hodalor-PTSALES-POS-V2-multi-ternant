import { createSlice, nanoid } from '@reduxjs/toolkit';

function pad12Digits(n) {
  const s = String(n).replace(/\D/g, '');
  if (s.length >= 12) return s.slice(-12);
  return (s + '000000000000').slice(0, 12);
}

function ean13CheckDigit(d12) {
  // d12 is a 12-digit numeric string
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(d12[i]);
    sum += (i % 2 === 0) ? d : d * 3;
  }
  const mod = sum % 10;
  return String((10 - mod) % 10);
}

function generateEAN13() {
  const base = pad12Digits(String(Date.now()).slice(-10) + String(Math.floor(Math.random() * 100)).padStart(2, '0'));
  return base + ean13CheckDigit(base);
}

const initialState = {
  products: [],
  categories: []
};

function normalizeVariant(v, parent, idx) {
  return {
    id: v.id || v.label || String(idx),
    label: v.label,
    sku: v.sku || '',
    price: v.price,
    retailPrice: v.retailPrice != null ? Number(v.retailPrice) : (v.price != null ? Number(v.price) : Number(parent.retailPrice != null ? parent.retailPrice : parent.price || 0)),
    wholesalePrice: v.wholesalePrice != null ? Number(v.wholesalePrice) : (v.retailPrice != null ? Number(v.retailPrice) : Number(parent.wholesalePrice != null ? parent.wholesalePrice : parent.price || 0)),
    warehousePrice: v.warehousePrice != null ? Number(v.warehousePrice) : 0,
    agentPrice: v.agentPrice != null ? Number(v.agentPrice) : (v.wholesalePrice != null ? Number(v.wholesalePrice) : Number(parent.agentPrice != null ? parent.agentPrice : parent.price || 0)),
    costPrice: v.costPrice != null ? Number(v.costPrice) : Number(parent.costPrice || 0),
    stockByBranch: v.stockByBranch || {},
    wholesaleStockByBranch: v.wholesaleStockByBranch || {},
    warehouseStockByBranch: v.warehouseStockByBranch || {}
  };
}

function normalizeProduct(p) {
  const rawId = p.id || p._id || null;
  const id = rawId != null ? String(rawId) : null;
  const variants = Array.isArray(p.variants) ? p.variants.map((v, idx) => normalizeVariant(v, p, idx)) : [];
  return {
    ...p,
    id,
    brand: String(p.brand || '').trim(),
    trackType: p.trackType || 'quantity',
    retailPrice: p.retailPrice != null ? Number(p.retailPrice) : Number(p.price || 0),
    wholesalePrice: p.wholesalePrice != null ? Number(p.wholesalePrice) : Number(p.retailPrice != null ? p.retailPrice : p.price || 0),
    warehousePrice: p.warehousePrice != null ? Number(p.warehousePrice) : 0,
    agentPrice: p.agentPrice != null ? Number(p.agentPrice) : Number(p.wholesalePrice != null ? p.wholesalePrice : (p.retailPrice != null ? p.retailPrice : p.price || 0)),
    stockByBranch: p.stockByBranch || {},
    wholesaleStockByBranch: p.wholesaleStockByBranch || {},
    warehouseStockByBranch: p.warehouseStockByBranch || {},
    variants
  };
}

function withPreservedLocalStock(serverProduct, localProduct) {
  const next = {
    ...serverProduct,
    stockByBranch: localProduct?.stockByBranch || serverProduct.stockByBranch || {},
    wholesaleStockByBranch: localProduct?.wholesaleStockByBranch || serverProduct.wholesaleStockByBranch || {},
    warehouseStockByBranch: localProduct?.warehouseStockByBranch || serverProduct.warehouseStockByBranch || {},
    syncPending: true
  };
  if (Array.isArray(next.variants) && Array.isArray(localProduct?.variants)) {
    next.variants = next.variants.map((variant) => {
      const localVariant = localProduct.variants.find((item) => String(item.id) === String(variant.id));
      if (!localVariant) return variant;
      return {
        ...variant,
        stockByBranch: localVariant.stockByBranch || variant.stockByBranch || {},
        wholesaleStockByBranch: localVariant.wholesaleStockByBranch || variant.wholesaleStockByBranch || {},
        warehouseStockByBranch: localVariant.warehouseStockByBranch || variant.warehouseStockByBranch || {}
      };
    });
  }
  return next;
}

const productsSlice = createSlice({
  name: 'products',
  initialState,
  reducers: {
    setProducts(state, action) {
      const list = Array.isArray(action.payload) ? action.payload : [];
      const mapped = list.map(normalizeProduct).map((serverProduct) => {
        const local = state.products.find((item) => item.id === serverProduct.id);
        return local?.syncPending ? withPreservedLocalStock(serverProduct, local) : serverProduct;
      });
      const seen = new Set(mapped.map(p => p.id).filter(Boolean));
      const localPending = state.products.filter(p => p && (p.offline || p.syncPending) && !seen.has(p.id));
      state.products = mapped.concat(localPending);
      const cats = Array.from(new Set(mapped.map(p => p.category).filter(Boolean)));
      state.categories = cats.length > 0 ? cats : state.categories;
    },
    mergeProducts(state, action) {
      const list = Array.isArray(action.payload) ? action.payload : [];
      const mapped = list.map(normalizeProduct).map((serverProduct) => {
        const local = state.products.find((item) => item.id === serverProduct.id);
        return local?.syncPending ? withPreservedLocalStock(serverProduct, local) : serverProduct;
      });
      mapped.forEach(next => {
        const index = state.products.findIndex(p => p.id === next.id);
        if (index >= 0) state.products[index] = { ...state.products[index], ...next };
        else state.products.push(next);
      });
      const cats = Array.from(new Set(state.products.map(p => p.category).filter(Boolean)));
      state.categories = cats.length > 0 ? cats : state.categories;
    },
    replaceProducts(state, action) {
      const list = Array.isArray(action.payload) ? action.payload : [];
      const mapped = list.map(normalizeProduct);
      mapped.forEach((next) => {
        const index = state.products.findIndex((p) => p.id === next.id);
        const committed = { ...next, syncPending: false, offline: false };
        if (index >= 0) state.products[index] = { ...state.products[index], ...committed };
        else state.products.push(committed);
      });
      const cats = Array.from(new Set(state.products.map(p => p.category).filter(Boolean)));
      state.categories = cats.length > 0 ? cats : state.categories;
    },
    addProduct: {
      reducer(state, action) {
        state.products.push(action.payload);
      },
      prepare(product) {
        const id = product?.id != null ? String(product.id) : nanoid();
        const payload = {
          id,
          trackType: 'quantity',
          stockByBranch: {},
          wholesaleStockByBranch: {},
          warehouseStockByBranch: {},
          attributes: [],
          packs: [],
          unitKind: 'none',
          unitValue: null,
          unitSymbol: '',
          sizeLabel: '',
          shoeSize: '',
          brand: '',
          syncPending: true,
          retailPrice: product?.retailPrice != null ? Number(product.retailPrice) : Number(product?.price || 0),
          wholesalePrice: product?.wholesalePrice != null ? Number(product.wholesalePrice) : Number(product?.retailPrice != null ? product.retailPrice : product?.price || 0),
          warehousePrice: product?.warehousePrice != null ? Number(product.warehousePrice) : 0,
          agentPrice: product?.agentPrice != null ? Number(product.agentPrice) : Number(product?.wholesalePrice != null ? product.wholesalePrice : (product?.retailPrice != null ? product.retailPrice : product?.price || 0)),
          ...product
        };
        if (!payload.barcode) {
          payload.barcode = generateEAN13();
        }
        return { payload };
      }
    },
    updateProduct(state, action) {
      const p = state.products.find(x => x.id === action.payload.id);
      if (p) {
        Object.assign(p, action.payload);
      }
    },
    removeProduct(state, action) {
      state.products = state.products.filter(p => p.id !== action.payload);
    },
    setStock(state, action) {
      const { productId, branchId, quantity, variantId, inventoryType = 'retail', syncPending = false } = action.payload;
      const p = state.products.find(x => x.id === productId);
      if (!p) return;
      p.syncPending = !!syncPending;
      const stockField = inventoryType === 'wholesale' ? 'wholesaleStockByBranch' : inventoryType === 'warehouse' ? 'warehouseStockByBranch' : 'stockByBranch';
      if (variantId && Array.isArray(p.variants)) {
        const v = p.variants.find(vv => vv.id === variantId);
        if (!v) return;
        v[stockField] = v[stockField] || {};
        v[stockField][branchId] = quantity;
        return;
      }
      p[stockField] = p[stockField] || {};
      p[stockField][branchId] = quantity;
    },
    adjustStock(state, action) {
      const { productId, branchId, delta, variantId, inventoryType = 'retail', syncPending = true } = action.payload;
      const p = state.products.find(x => x.id === productId);
      if (!p) return;
      p.syncPending = !!syncPending;
      const stockField = inventoryType === 'wholesale' ? 'wholesaleStockByBranch' : inventoryType === 'warehouse' ? 'warehouseStockByBranch' : 'stockByBranch';
      if (variantId && Array.isArray(p.variants)) {
        const v = p.variants.find(vv => vv.id === variantId);
        if (!v) return;
        v[stockField] = v[stockField] || {};
        const cur = v[stockField][branchId] || 0;
        v[stockField][branchId] = Math.max(0, cur + delta);
        return;
      }
      p[stockField] = p[stockField] || {};
      const cur = p[stockField][branchId] || 0;
      p[stockField][branchId] = Math.max(0, cur + delta);
    },
    addCategory(state, action) {
      if (!state.categories.includes(action.payload)) state.categories.push(action.payload);
    }
  }
});

export const { setProducts, mergeProducts, replaceProducts, addProduct, updateProduct, removeProduct, setStock, adjustStock, addCategory } = productsSlice.actions;
export default productsSlice.reducer;
