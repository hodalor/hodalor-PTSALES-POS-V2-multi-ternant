import { createSlice } from '@reduxjs/toolkit';

const expenseRequestsSlice = createSlice({
  name: 'expenseRequests',
  initialState: {
    requests: []
  },
  reducers: {
    setExpenseRequests(state, action) {
      state.requests = Array.isArray(action.payload) ? action.payload : [];
    },
    approveExpenseRequest(state, action) {
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
    rejectExpenseRequest(state, action) {
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

export const { setExpenseRequests, approveExpenseRequest, rejectExpenseRequest } = expenseRequestsSlice.actions;
export default expenseRequestsSlice.reducer;
