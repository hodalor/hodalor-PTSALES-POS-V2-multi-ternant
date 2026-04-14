import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  users: [
    { id: 'u1', name: 'superadmin', role: 'SuperAdmin', branchId: 'main', assignedBranches: 'all', active: true }
  ],
  roles: ['SuperAdmin', 'Admin', 'Branch Manager', 'Manager', 'Cashier', 'Inventory Staff', 'Auditor', 'Other']
};

const usersSlice = createSlice({
  name: 'users',
  initialState,
  reducers: {
    addUser: {
      reducer(state, action) {
        state.users.push(action.payload);
      },
      prepare(data) {
        const { id, name, role, branchId, assignedBranches } = data || {};
        let assigned = assignedBranches;
        if (assigned === undefined) assigned = branchId ? [branchId] : [];
        if (assigned !== 'all' && !Array.isArray(assigned)) assigned = [assigned];
        const payload = { id: id != null ? String(id) : nanoid(), name, role, branchId, assignedBranches: assigned, active: true, ...data };
        return { payload };
      }
    },
    updateUser(state, action) {
      const u = state.users.find(x => x.id === action.payload.id);
      if (u) Object.assign(u, action.payload);
    },
    removeUser(state, action) {
      state.users = state.users.filter(u => u.id !== action.payload);
    },
    setUsers(state, action) {
      const server = Array.isArray(action.payload) ? action.payload : [];
      const seenNames = new Set(server.map(u => String(u?.name || '')).filter(Boolean));
      const offline = state.users.filter(u => u && u.offline && !seenNames.has(String(u.name || '')));
      state.users = server.concat(offline);
    }
  }
});

export const { addUser, updateUser, removeUser, setUsers } = usersSlice.actions;
export default usersSlice.reducer;
