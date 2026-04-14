import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  requests: []
};

const refundsSlice = createSlice({
  name: 'refunds',
  initialState,
  reducers: {
    setRequests(state, action) {
      const list = Array.isArray(action.payload) ? action.payload : [];
      const server = list.map(r => {
        const id = r?.id || r?._id || nanoid();
        return { ...r, id: String(id) };
      });
      const serverIds = new Set(server.map(r => r.id).filter(Boolean));
      const serverClientIds = new Set(server.map(r => r?.clientId).filter(Boolean).map(String));
      const offline = state.requests.filter(r => r && r.offline && !serverIds.has(String(r.id)) && (!r.clientId || !serverClientIds.has(String(r.clientId))));
      state.requests = server.concat(offline);
    },
    createRefundRequest: {
      reducer(state, action) {
        state.requests.push(action.payload);
      },
      prepare(req) {
        const id = req?.id != null ? String(req.id) : nanoid();
        return {
          payload: {
            id,
            status: req?.status || 'pending_approval',
            created_at: req?.created_at || new Date().toISOString(),
            ...req
          }
        };
      }
    },
    approveRefund(state, action) {
      const { id, approverName, approverRole, approvalRemark, restockChoice, restockMode, restockItems } = action.payload || {};
      const r = state.requests.find(x => x.id === id && x.status === 'pending_approval');
      if (r) {
        r.status = 'approved';
        r.approved_at = new Date().toISOString();
        r.approverName = approverName || 'unknown';
        r.approverRole = approverRole || '';
        if (typeof restockMode === 'string') {
          r.restockMode = restockMode; // 'none' | 'full' | 'partial'
          r.usedRestock = restockMode !== 'none';
        } else {
          r.usedRestock = typeof restockChoice === 'boolean' ? restockChoice : !!r.restock;
          r.restockMode = r.usedRestock ? 'full' : 'none';
        }
        if (Array.isArray(restockItems)) {
          r.restockItems = restockItems.map(x => ({ sku: x.sku, productId: x.productId || '', variantId: x.variantId || '', qty: Number(x.qty) || 0, unitIds: Array.isArray(x.unitIds) ? x.unitIds.map(String) : [] }));
        }
        if (typeof approvalRemark === 'string') r.approvalRemark = approvalRemark;
      }
    },
    rejectRefund(state, action) {
      const { id, approverName, approverRole, remark } = action.payload || {};
      const r = state.requests.find(x => x.id === id && x.status === 'pending_approval');
      if (r) {
        r.status = 'rejected';
        r.rejected_at = new Date().toISOString();
        r.approverName = approverName || 'unknown';
        r.approverRole = approverRole || '';
        r.rejectionRemark = remark || '';
      }
    }
  }
});

export const { setRequests, createRefundRequest, approveRefund, rejectRefund } = refundsSlice.actions;
export default refundsSlice.reducer;
