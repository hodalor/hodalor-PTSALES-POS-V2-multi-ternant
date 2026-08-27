import { createSlice, nanoid } from '@reduxjs/toolkit';

const initialState = {
  sales: []
};

function isTemporaryReference(value) {
  const text = String(value || '').trim().toUpperCase();
  return text.startsWith('TMP-') || text.startsWith('OFF-');
}

function isTemporarySaleRecord(sale) {
  if (!sale || typeof sale !== 'object') return false;
  return !!(
    sale.offline
    || sale.syncPending
    || String(sale?.clientId || '').startsWith('offline-sale-')
    || isTemporaryReference(sale?.invoiceSerial)
    || isTemporaryReference(sale?.receiptNumber)
  );
}

const salesSlice = createSlice({
  name: 'sales',
  initialState,
  reducers: {
    setSales(state, action) {
      const list = Array.isArray(action.payload) ? action.payload : [];
      const server = list.map(s => {
        const id = s?.id || s?._id || nanoid();
        return { ...s, id: String(id) };
      });
      const serverIds = new Set(server.map((sale) => String(sale?.id || sale?._id || '')));
      const serverClientIds = new Set(server.map((sale) => String(sale?.clientId || '')).filter(Boolean));
      const localPending = state.sales.filter((sale) => {
        if (!isTemporarySaleRecord(sale)) return false;
        const saleId = String(sale?.id || sale?._id || '');
        const clientId = String(sale?.clientId || '');
        if (saleId && serverIds.has(saleId)) return false;
        if (clientId && serverClientIds.has(clientId)) return false;
        return true;
      });
      state.sales = server.concat(localPending);
    },
    recordSale: {
      reducer(state, action) {
        state.sales.push(action.payload);
      },
      prepare(sale) {
        const id = sale?.id || sale?._id || nanoid();
        return { payload: { ...sale, id: String(id) } };
      }
    },
    removeSales(state, action) {
      const ids = new Set((Array.isArray(action.payload) ? action.payload : []).map(String));
      state.sales = state.sales.filter(sale => !ids.has(String(sale?.id || sale?._id || sale?.clientId || '')));
    }
  }
});

export const { setSales, recordSale, removeSales } = salesSlice.actions;
export default salesSlice.reducer;
