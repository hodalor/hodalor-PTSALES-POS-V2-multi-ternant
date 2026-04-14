import { createSlice } from '@reduxjs/toolkit';

const adjustmentRequestsSlice = createSlice({
  name: 'adjustmentRequests',
  initialState: {
    requests: []
  },
  reducers: {
    setAdjustmentRequests(state, action) {
      state.requests = Array.isArray(action.payload) ? action.payload : [];
    },
    approveAdjustmentRequest(state, action) {
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
    rejectAdjustmentRequest(state, action) {
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

export const { setAdjustmentRequests, approveAdjustmentRequest, rejectAdjustmentRequest } = adjustmentRequestsSlice.actions;
export default adjustmentRequestsSlice.reducer;
