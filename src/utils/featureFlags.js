export const FEATURE_CATALOG = [
  { key: 'modules.dashboard', label: 'Dashboard', group: 'Main Menus' },
  { key: 'modules.pos', label: 'POS', group: 'Main Menus' },
  { key: 'modules.wholesalePos', label: 'Wholesale POS', group: 'Main Menus' },
  { key: 'modules.invoices', label: 'Invoices', group: 'Main Menus' },
  { key: 'modules.sales', label: 'Sales', group: 'Main Menus' },
  { key: 'modules.products', label: 'Products', group: 'Main Menus' },
  { key: 'modules.inventory', label: 'Inventory', group: 'Main Menus' },
  { key: 'modules.labels', label: 'Labels', group: 'Main Menus' },
  { key: 'modules.purchases', label: 'Purchases', group: 'Main Menus' },
  { key: 'modules.expenses', label: 'Expenses', group: 'Main Menus' },
  { key: 'modules.transfers', label: 'Transfers', group: 'Main Menus' },
  { key: 'modules.adjustments', label: 'Adjustments', group: 'Main Menus' },
  { key: 'modules.suppliers', label: 'Suppliers', group: 'Main Menus' },
  { key: 'modules.customers', label: 'Customers', group: 'Main Menus' },
  { key: 'modules.creditControl', label: 'Credit Control', group: 'Main Menus' },
  { key: 'modules.approvalsCenter', label: 'Approvals Center', group: 'Main Menus' },
  { key: 'modules.refunds', label: 'Refunds', group: 'Main Menus' },
  { key: 'modules.refundApprovals', label: 'Refund Approvals', group: 'Main Menus' },
  { key: 'modules.expenseApprovals', label: 'Expense Approvals', group: 'Main Menus' },
  { key: 'modules.reports', label: 'Reports', group: 'Main Menus' },
  { key: 'modules.backup', label: 'Backup', group: 'Main Menus' },

  { key: 'admin.users', label: 'Users', group: 'Admin Menus' },
  { key: 'admin.manual', label: 'Manual', group: 'Admin Menus' },
  { key: 'admin.audit', label: 'Audit Log', group: 'Admin Menus' },
  { key: 'admin.serverLogs', label: 'Server Logs', group: 'Admin Menus' },
  { key: 'admin.stockRecords', label: 'Stock Records', group: 'Admin Menus' },
  { key: 'admin.cashDrawer', label: 'Cash Drawer', group: 'Admin Menus' },
  { key: 'admin.config', label: 'Config', group: 'Admin Menus' },
  { key: 'admin.godhand', label: 'GodHand', group: 'Admin Menus' },
  { key: 'admin.docs', label: 'Docs', group: 'Admin Menus' },

  { key: 'features.offlineBackup', label: 'Offline usage (queue + backup)', group: 'Features' },

  { key: 'tabs.customerPurchaseHistory', label: 'Customer Purchase History', group: 'Tabs' },
  { key: 'tabs.posHeldSales', label: 'POS – Held Sales panel', group: 'Tabs' },
  { key: 'tabs.invoiceNew', label: 'Invoices – New Invoice tab', group: 'Tabs' },
  { key: 'tabs.invoiceRecords', label: 'Invoices – Records tab', group: 'Tabs' }
];

export function isFeatureEnabled(settings, key) {
  if (!key) return true;
  const flags = settings && settings.featureFlags ? settings.featureFlags : {};
  return flags?.[key] !== false;
}

export function setFeatureFlag(flags, key, enabled) {
  const next = { ...(flags || {}) };
  if (enabled) {
    if (key in next) delete next[key];
  } else {
    next[key] = false;
  }
  return next;
}
