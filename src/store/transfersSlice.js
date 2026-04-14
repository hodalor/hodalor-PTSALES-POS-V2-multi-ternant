import { createSlice } from '@reduxjs/toolkit';

const transfersSlice = createSlice({
  name: 'transfers',
  initialState: {
    requests: []
  },
  reducers: {
    setTransferRequests(state, action) {
      state.requests = Array.isArray(action.payload) ? action.payload : [];
    },
    createTransferRequest(state, action) {
      const r = action.payload;
      state.requests.unshift(r);
    },
    approveTransfer(state, action) {
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
    rejectTransfer(state, action) {
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

export const { setTransferRequests, createTransferRequest, approveTransfer, rejectTransfer } = transfersSlice.actions;
export default transfersSlice.reducer;

