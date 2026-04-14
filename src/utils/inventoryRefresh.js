import * as productsApi from '../api/products';
import { mergeProducts, setProducts } from '../store/productsSlice';

export async function refreshProductCatalog(dispatch) {
  const rows = await productsApi.list();
  if (Array.isArray(rows)) dispatch(setProducts(rows));
  return rows;
}

export async function refreshAffectedProducts(dispatch, productIds = []) {
  const ids = Array.isArray(productIds) ? Array.from(new Set(productIds.map(String).filter(Boolean))) : [];
  if (ids.length === 0) return [];
  const rows = await productsApi.listByIds(ids);
  if (Array.isArray(rows) && rows.length > 0) dispatch(mergeProducts(rows));
  return rows;
}
