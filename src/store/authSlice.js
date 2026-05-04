import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  user: null,
  role: null,
  isAuthenticated: false,
  grants: [],
  initialized: false
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginSuccess(state, action) {
      state.user = action.payload.user;
      state.role = action.payload.role;
      state.isAuthenticated = true;
      state.grants = Array.isArray(action.payload.grants) ? action.payload.grants : [];
      state.initialized = true;
    },
    setGrants(state, action) {
      state.grants = Array.isArray(action.payload) ? action.payload : [];
    },
    setInitialized(state, action) {
      state.initialized = !!action.payload;
    },
    setUserPreferredLanguage(state, action) {
      if (!state.user) return;
      state.user.preferredLanguage = String(action.payload || '').trim().toLowerCase();
    },
    logout(state) {
      state.user = null;
      state.role = null;
      state.isAuthenticated = false;
      state.grants = [];
      state.initialized = true;
    }
  }
});

export const { loginSuccess, setGrants, setInitialized, setUserPreferredLanguage, logout } = authSlice.actions;
export default authSlice.reducer;
