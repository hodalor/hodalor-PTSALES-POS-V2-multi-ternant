import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  appName: 'ptSales POS',
  footerText: '© ptSales',
  currentBranchId: 'main',
  receiptLogoUrl: '',
  receiptHeader: 'Thank you for shopping with us!',
  receiptFooter: 'No refunds without receipt',
  businessPhone: '0243984046',
  businessWebsite: '',
  businessTpin: '',
  sdcId: '',
  clientAppName: '',
  clientLogoUrl: '',
  themeColor: '',
  preferredLanguage: 'en',
  chatNotificationSound: 'bright',
  callNotificationSound: 'bright',
  webRtcIceServers: 'stun:stun.l.google.com:19302',
  subscriptionPaymentUnavailableMessage: 'Online payment is currently unavailable contact Prynovatechnologies@gmail.com for activation code.',
  subscriptionPlan: 'basic',
  subscriptionExpiresAt: null,
  receiptBrandName: '',
  receiptQrBaseUrl: '',
  invoicePrefix: 'INV',
  nextInvoiceNumber: 1,
  wholesaleInvoicePrefix: 'WINV',
  nextWholesaleInvoiceNumber: 1,
  warehouseInvoicePrefix: 'WHINV',
  nextWarehouseInvoiceNumber: 1,
  invoiceNumberDigits: 6,
  invoiceTitle: 'Invoice',
  invoiceWordsLabel: 'Amount Chargeable (in words)',
  invoiceGeneratedNote: 'This is a Computer Generated Invoice',
  invoiceCompanyAddress: '',
  invoiceFooter: '© ptSales',
  invoiceDeclaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  invoiceSignatoryLabel: 'Authorised Signatory',
  invoicePaidStampEnabled: true,
  invoicePaidStampLabel: 'PAID',
  invoicePaidStampThankYou: 'THANK YOU!',
  invoicePaidStampShowDate: true,
  invoicePaidStampColor: '#cc0000',
  receiptPrefix: 'RCPT',
  nextReceiptNumber: 1,
  drawerOpenOnCash: false,
  taxRate: 0,
  currencyCode: 'GHS',
  currencySymbol: '₵',
  currencyPosition: 'prefix',
  currencies: [
    { code: 'GHS', symbol: '₵', position: 'prefix' },
    { code: 'USD', symbol: '$', position: 'prefix' }
  ],
  activeCurrencyCode: 'GHS',
  refreshIntervalSec: 60,
  userGrants: {},
  featureFlags: {},
  hydrated: false,
  categories: [],
  loyaltyEnabled: false,
  loyaltyEarnAmount: 0,
  loyaltyEarnPoints: 0,
  loyaltyRedeemValue: 0,
  loyaltyMinRedeemPoints: 0,
  loyaltyMaxRedeemPercent: 50
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setAllSettings(state, action) {
      const data = action.payload || {};
      Object.keys(data).forEach(k => {
        state[k] = data[k];
      });
      state.hydrated = true;
      const backfill = {
        chatNotificationSound: initialState.chatNotificationSound,
        callNotificationSound: initialState.callNotificationSound,
        webRtcIceServers: initialState.webRtcIceServers,
        preferredLanguage: initialState.preferredLanguage,
        invoiceFooter: initialState.invoiceFooter,
        invoiceDeclaration: initialState.invoiceDeclaration,
        invoiceSignatoryLabel: initialState.invoiceSignatoryLabel,
        invoiceTitle: initialState.invoiceTitle,
        invoiceWordsLabel: initialState.invoiceWordsLabel,
        invoiceGeneratedNote: initialState.invoiceGeneratedNote,
        invoicePaidStampEnabled: initialState.invoicePaidStampEnabled,
        invoicePaidStampLabel: initialState.invoicePaidStampLabel,
        invoicePaidStampThankYou: initialState.invoicePaidStampThankYou,
        invoicePaidStampShowDate: initialState.invoicePaidStampShowDate,
        invoicePaidStampColor: initialState.invoicePaidStampColor,
        wholesaleInvoicePrefix: initialState.wholesaleInvoicePrefix,
        nextWholesaleInvoiceNumber: initialState.nextWholesaleInvoiceNumber,
        warehouseInvoicePrefix: initialState.warehouseInvoicePrefix,
        nextWarehouseInvoiceNumber: initialState.nextWarehouseInvoiceNumber
      };
      Object.keys(backfill).forEach(k => {
        const v = state[k];
        if (typeof v === 'undefined' || v === null || (typeof v === 'string' && v.trim() === '')) {
          state[k] = backfill[k];
        }
      });
    },
    setReceiptBrandName(state, action) {
      state.receiptBrandName = String(action.payload || '');
    },
    setInvoicePaidStampEnabled(state, action) {
      state.invoicePaidStampEnabled = !!action.payload;
    },
    setInvoicePaidStampLabel(state, action) {
      state.invoicePaidStampLabel = String(action.payload || 'PAID');
    },
    setInvoicePaidStampThankYou(state, action) {
      state.invoicePaidStampThankYou = String(action.payload || 'THANK YOU!');
    },
    setInvoicePaidStampShowDate(state, action) {
      state.invoicePaidStampShowDate = !!action.payload;
    },
    setInvoicePaidStampColor(state, action) {
      state.invoicePaidStampColor = String(action.payload || '#cc0000');
    },
    setUserGrants(state, action) {
      const m = action.payload || {};
      state.userGrants = m;
    },
    setSettingsHydrated(state, action) {
      state.hydrated = !!action.payload;
    },
    setUserGrant(state, action) {
      const { username, grants } = action.payload || {};
      const name = String(username || '');
      if (!name) return;
      if (!Array.isArray(grants)) return;
      if (!state.userGrants) state.userGrants = {};
      state.userGrants[name] = grants.slice();
    },
    setAppName(state, action) {
      state.appName = action.payload;
    },
    setFooterText(state, action) {
      state.footerText = action.payload;
    },
    setCurrentBranch(state, action) {
      state.currentBranchId = action.payload;
    },
    setReceiptLogoUrl(state, action) {
      state.receiptLogoUrl = action.payload;
    },
    setReceiptHeader(state, action) {
      state.receiptHeader = action.payload;
    },
    setReceiptFooter(state, action) {
      state.receiptFooter = action.payload;
    },
    setClientAppName(state, action) {
      state.clientAppName = String(action.payload || '');
    },
    setClientLogoUrl(state, action) {
      state.clientLogoUrl = String(action.payload || '');
    },
    setPreferredLanguage(state, action) {
      state.preferredLanguage = String(action.payload || 'en').trim().toLowerCase() || 'en';
    },
    setCategories(state, action) {
      state.categories = Array.isArray(action.payload) ? action.payload.map(x => String(x || '').trim()).filter(Boolean) : [];
    },
    addSettingsCategory(state, action) {
      const value = String(action.payload || '').trim();
      if (!value) return;
      const existing = Array.isArray(state.categories) ? state.categories : [];
      if (!existing.some(item => String(item).toLowerCase() === value.toLowerCase())) {
        state.categories = [...existing, value];
      }
    },
    removeSettingsCategory(state, action) {
      const value = String(action.payload || '').trim().toLowerCase();
      state.categories = (Array.isArray(state.categories) ? state.categories : []).filter(item => String(item || '').trim().toLowerCase() !== value);
    },
    setBusinessPhone(state, action) {
      state.businessPhone = String(action.payload || '');
    },
    setBusinessWebsite(state, action) {
      state.businessWebsite = String(action.payload || '');
    },
    setBusinessTpin(state, action) {
      state.businessTpin = String(action.payload || '');
    },
    setReceiptQrBaseUrl(state, action) {
      state.receiptQrBaseUrl = String(action.payload || '');
    },
    setInvoiceCompanyAddress(state, action) {
      state.invoiceCompanyAddress = String(action.payload || '');
    },
    setInvoiceFooter(state, action) {
      state.invoiceFooter = String(action.payload || '');
    },
    setInvoiceDeclaration(state, action) {
      state.invoiceDeclaration = String(action.payload || '');
    },
    setInvoiceSignatoryLabel(state, action) {
      state.invoiceSignatoryLabel = String(action.payload || '');
    },
    setInvoiceTitle(state, action) {
      state.invoiceTitle = String(action.payload || 'Invoice');
    },
    setInvoiceWordsLabel(state, action) {
      state.invoiceWordsLabel = String(action.payload || 'Amount Chargeable (in words)');
    },
    setInvoiceGeneratedNote(state, action) {
      state.invoiceGeneratedNote = String(action.payload || 'This is a Computer Generated Invoice');
    },
    setInvoicePrefix(state, action) {
      state.invoicePrefix = String(action.payload || 'INV');
    },
    setNextInvoiceNumber(state, action) {
      state.nextInvoiceNumber = action.payload;
    },
    setWholesaleInvoicePrefix(state, action) {
      state.wholesaleInvoicePrefix = String(action.payload || 'WINV');
    },
    setNextWholesaleInvoiceNumber(state, action) {
      let v = Number(action.payload);
      if (!Number.isFinite(v) || v < 1) v = 1;
      state.nextWholesaleInvoiceNumber = Math.floor(v);
    },
    setWarehouseInvoicePrefix(state, action) {
      state.warehouseInvoicePrefix = String(action.payload || 'WHINV');
    },
    setNextWarehouseInvoiceNumber(state, action) {
      let v = Number(action.payload);
      if (!Number.isFinite(v) || v < 1) v = 1;
      state.nextWarehouseInvoiceNumber = Math.floor(v);
    },
    setInvoiceNumberDigits(state, action) {
      let v = Number(action.payload);
      if (!Number.isFinite(v) || v < 1) v = 1;
      if (v > 12) v = 12;
      state.invoiceNumberDigits = Math.floor(v);
    },
    setReceiptPrefix(state, action) {
      state.receiptPrefix = String(action.payload || 'RCPT');
    },
    setNextReceiptNumber(state, action) {
      let v = Number(action.payload);
      if (!Number.isFinite(v) || v < 1) v = 1;
      state.nextReceiptNumber = Math.floor(v);
    },
    setDrawerOpenOnCash(state, action) {
      state.drawerOpenOnCash = !!action.payload;
    },
    setTaxRate(state, action) {
      let v = Number(action.payload);
      if (Number.isNaN(v)) v = 0;
      if (v < 0) v = 0;
      if (v > 1) v = 1;
      state.taxRate = v;
    },
    setCurrencyCode(state, action) {
      state.currencyCode = String(action.payload || '').toUpperCase() || 'GHS';
    },
    setCurrencySymbol(state, action) {
      state.currencySymbol = String(action.payload || '₵');
    },
    setCurrencyPosition(state, action) {
      const v = String(action.payload || 'prefix');
      state.currencyPosition = (v === 'suffix') ? 'suffix' : 'prefix';
    },
    addCurrency(state, action) {
      const { code, symbol, position } = action.payload || {};
      const c = String(code || '').toUpperCase();
      if (!c) return;
      const pos = position === 'suffix' ? 'suffix' : 'prefix';
      const idx = Array.isArray(state.currencies) ? state.currencies.findIndex(x => x.code === c) : -1;
      const entry = { code: c, symbol: String(symbol || ''), position: pos };
      if (idx >= 0) state.currencies[idx] = entry;
      else state.currencies.push(entry);
    },
    removeCurrency(state, action) {
      const c = String(action.payload || '').toUpperCase();
      state.currencies = (state.currencies || []).filter(x => x.code !== c);
      if (state.activeCurrencyCode === c) {
        const fallback = state.currencies[0] || { code: 'GHS', symbol: '₵', position: 'prefix' };
        state.activeCurrencyCode = fallback.code;
        state.currencyCode = fallback.code;
        state.currencySymbol = fallback.symbol;
        state.currencyPosition = fallback.position;
      }
    },
    setActiveCurrency(state, action) {
      const c = String(action.payload || '').toUpperCase();
      const found = (state.currencies || []).find(x => x.code === c);
      if (!found) return;
      state.activeCurrencyCode = found.code;
      state.currencyCode = found.code;
      state.currencySymbol = found.symbol;
      state.currencyPosition = found.position;
    },
    setRefreshIntervalSec(state, action) {
      let v = Number(action.payload);
      if (!Number.isFinite(v) || v < 10) v = 10;
      if (v > 3600) v = 3600;
      state.refreshIntervalSec = Math.floor(v);
    },
    setLoyaltyEnabled(state, action) {
      state.loyaltyEnabled = !!action.payload;
    },
    setLoyaltyEarnAmount(state, action) {
      const v = Number(action.payload);
      state.loyaltyEarnAmount = Number.isFinite(v) && v >= 0 ? v : 0;
    },
    setLoyaltyEarnPoints(state, action) {
      const v = Number(action.payload);
      state.loyaltyEarnPoints = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    },
    setLoyaltyRedeemValue(state, action) {
      const v = Number(action.payload);
      state.loyaltyRedeemValue = Number.isFinite(v) && v >= 0 ? v : 0;
    },
    setLoyaltyMinRedeemPoints(state, action) {
      const v = Number(action.payload);
      state.loyaltyMinRedeemPoints = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    },
    setLoyaltyMaxRedeemPercent(state, action) {
      const v = Number(action.payload);
      if (!Number.isFinite(v)) return;
      state.loyaltyMaxRedeemPercent = Math.max(0, Math.min(100, v));
    }
  }
});

export const { setAllSettings, setUserGrants, setUserGrant, setAppName, setFooterText, setCurrentBranch, setReceiptLogoUrl, setReceiptHeader, setReceiptFooter, setClientAppName, setClientLogoUrl, setPreferredLanguage, setCategories, addSettingsCategory, removeSettingsCategory, setBusinessPhone, setBusinessWebsite, setBusinessTpin, setReceiptQrBaseUrl, setInvoicePrefix, setNextInvoiceNumber, setWholesaleInvoicePrefix, setNextWholesaleInvoiceNumber, setWarehouseInvoicePrefix, setNextWarehouseInvoiceNumber, setReceiptPrefix, setNextReceiptNumber, setDrawerOpenOnCash, setTaxRate, setCurrencyCode, setCurrencySymbol, setCurrencyPosition, addCurrency, removeCurrency, setActiveCurrency, setRefreshIntervalSec, setLoyaltyEnabled, setLoyaltyEarnAmount, setLoyaltyEarnPoints, setLoyaltyRedeemValue, setLoyaltyMinRedeemPoints, setLoyaltyMaxRedeemPercent, setInvoiceCompanyAddress, setInvoiceFooter, setInvoiceDeclaration, setInvoiceSignatoryLabel, setInvoiceTitle, setInvoiceWordsLabel, setInvoiceGeneratedNote, setInvoiceNumberDigits, setInvoicePaidStampEnabled, setInvoicePaidStampLabel, setInvoicePaidStampThankYou, setInvoicePaidStampShowDate, setInvoicePaidStampColor, setReceiptBrandName, setSettingsHydrated } = settingsSlice.actions;
export default settingsSlice.reducer;
