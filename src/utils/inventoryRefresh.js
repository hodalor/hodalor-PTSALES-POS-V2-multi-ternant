import * as productsApi from '../api/products';
import { replaceProducts, setProducts } from '../store/productsSlice';

export async function refreshProductCatalog(dispatch) {
  const rows = await productsApi.list();
  if (Array.isArray(rows)) dispatch(setProducts(rows));
  return rows;
}

export async function refreshAffectedProducts(dispatch, productIds = []) {
  const ids = Array.isArray(productIds) ? Array.from(new Set(productIds.map(String).filter(Boolean))) : [];
  if (ids.length === 0) return [];
  // #region debug-point C:refresh-request
  fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"variant-stock-sync",runId:"pre-fix",hypothesisId:"C",location:"frontend/src/utils/inventoryRefresh.js:refreshAffectedProducts:request",msg:"[DEBUG] refreshAffectedProducts request",data:{productIds:ids},ts:Date.now()})}).catch(()=>{});
  // #endregion
  const rows = await productsApi.listByIds(ids);
  // #region debug-point C:refresh-response
  fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"variant-stock-sync",runId:"pre-fix",hypothesisId:"C",location:"frontend/src/utils/inventoryRefresh.js:refreshAffectedProducts:response",msg:"[DEBUG] refreshAffectedProducts response",data:{productIds:ids,rowCount:Array.isArray(rows)?rows.length:0,products:(Array.isArray(rows)?rows:[]).map((row)=>({id:String(row?._id||row?.id||""),trackType:String(row?.trackType||""),stockByBranch:row?.stockByBranch||{},wholesaleStockByBranch:row?.wholesaleStockByBranch||{},warehouseStockByBranch:row?.warehouseStockByBranch||{},variants:Array.isArray(row?.variants)?row.variants.map((variant)=>({id:String(variant?.id||""),stockByBranch:variant?.stockByBranch||{},wholesaleStockByBranch:variant?.wholesaleStockByBranch||{},warehouseStockByBranch:variant?.warehouseStockByBranch||{}})):[]}))},ts:Date.now()})}).catch(()=>{});
  // #endregion
  if (Array.isArray(rows) && rows.length > 0) dispatch(replaceProducts(rows));
  return rows;
}
