import { createSlice } from '@reduxjs/toolkit';

const purchasesSlice = createSlice({
  name: 'purchases',
  initialState: {
    requests: []
  },
  reducers: {
    setPurchaseRequests(state, action) {
      state.requests = Array.isArray(action.payload) ? action.payload : [];
    },
    createPurchaseRequest(state, action) {
      const r = action.payload;
      state.requests.unshift(r);
    },
    approvePurchase(state, action) {
      const { id, approverName, approverRole, remark } = action.payload || {};
      const r = state.requests.find(x => String(x._id || x.clientId) === String(id));
      if (r) {
        r.status = 'approved';
        r.approverName = approverName || 'unknown';
        r.approverRole = approverRole || '';
        r.approvalRemark = remark || '';
        r.approved_at = new Date().toISOString();
      }
    },
    rejectPurchase(state, action) {
      const { id, approverName, approverRole, remark } = action.payload || {};
      const r = state.requests.find(x => String(x._id || x.clientId) === String(id));
      if (r) {
        r.status = 'rejected';
        r.approverName = approverName || 'unknown';
        r.approverRole = approverRole || '';
        r.rejectionRemark = remark || '';
        r.rejected_at = new Date().toISOString();
      }
    }
  }
});

export const { setPurchaseRequests, createPurchaseRequest, approvePurchase, rejectPurchase } = purchasesSlice.actions;
export default purchasesSlice.reducer;
