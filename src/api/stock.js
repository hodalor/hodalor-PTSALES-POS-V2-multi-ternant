import { fetchJson } from './client';

export function receive(payload) {
  return fetchJson('/api/stock/receive', { method: 'POST', body: JSON.stringify(payload) });
}
export function adjust(payload) {
  return fetchJson('/api/stock/adjust', { method: 'POST', body: JSON.stringify(payload) });
}
export function damageRemove(payload) {
  return fetchJson('/api/stock/damage-remove', { method: 'POST', body: JSON.stringify(payload) }); 
}
export function transfer(payload) {
  return fetchJson('/api/stock/transfer', { method: 'POST', body: JSON.stringify(payload) });
}
export function setStock(payload) {
  // #region debug-point C:stock-set-request
  fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"variant-stock-sync",runId:"pre-fix",hypothesisId:"C",location:"frontend/src/api/stock.js:setStock",msg:"[DEBUG] stock.setStock request",data:{productId:String(payload?.productId||""),variantId:String(payload?.variantId||""),branchId:String(payload?.branchId||""),inventoryType:String(payload?.inventoryType||"retail"),quantity:Number(payload?.quantity||0)},ts:Date.now()})}).catch(()=>{});
  // #endregion
  return fetchJson('/api/stock/set', { method: 'POST', body: JSON.stringify(payload) });
}

export function getConsistencyReport(params = {}) {
  const query = new URLSearchParams();
  if (params.limit != null && params.limit !== '') query.set('limit', String(params.limit));
  if (params.mismatchOnly != null) query.set('mismatchOnly', String(params.mismatchOnly));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return fetchJson(`/api/stock/consistency-report${suffix}`);
}
