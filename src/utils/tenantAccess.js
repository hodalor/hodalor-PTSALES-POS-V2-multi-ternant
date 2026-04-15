export const TENANT_GRANT_CATALOG = [
  { key: 'view_dashboard', label: 'Dashboard' },
  { key: 'view_pos', label: 'POS' },
  { key: 'view_wholesale_pos', label: 'Wholesale POS' },
  { key: 'view_retail_price', label: 'Retail Price Visibility' },
  { key: 'view_wholesale_price', label: 'Wholesale Price Visibility' },
  { key: 'view_agent_price', label: 'Agent Price Visibility' },
  { key: 'view_sales', label: 'Sales' },
  { key: 'add_sales', label: 'Sales: Add' },
  { key: 'view_products', label: 'Products' },
  { key: 'add_products', label: 'Products: Add' },
  { key: 'edit_products', label: 'Products: Edit' },
  { key: 'view_inventory', label: 'Inventory' },
  { key: 'edit_inventory', label: 'Inventory: Edit' },
  { key: 'view_serialized_inventory', label: 'Serialized Inventory' },
  { key: 'view_labels', label: 'Labels' },
  { key: 'view_purchases', label: 'Purchases' },
  { key: 'add_purchases', label: 'Purchases: Add' },
  { key: 'edit_purchases', label: 'Purchases: Edit' },
  { key: 'approve_purchases', label: 'Purchases: Approve' },
  { key: 'view_transfers', label: 'Transfers' },
  { key: 'add_transfers', label: 'Transfers: Add' },
  { key: 'edit_transfers', label: 'Transfers: Edit' },
  { key: 'approve_transfers', label: 'Transfers: Approve' },
  { key: 'view_adjustments', label: 'Adjustments' },
  { key: 'add_adjustments', label: 'Adjustments: Add' },
  { key: 'edit_adjustments', label: 'Adjustments: Edit' },
  { key: 'approve_adjustments', label: 'Adjustments: Approve' },
  { key: 'view_suppliers', label: 'Suppliers' },
  { key: 'add_suppliers', label: 'Suppliers: Add' },
  { key: 'edit_suppliers', label: 'Suppliers: Edit' },
  { key: 'view_customers', label: 'Customers' },
  { key: 'add_customers', label: 'Customers: Add' },
  { key: 'edit_customers', label: 'Customers: Edit' },
  { key: 'view_credit_control', label: 'Credit Control' },
  { key: 'approve_credit_director', label: 'Credit: Director Approve' },
  { key: 'approve_credit_manager', label: 'Credit: Manager Approve' },
  { key: 'view_credit_repayment_approvals', label: 'Credit Repayment Approvals' },
  { key: 'view_approvals', label: 'Approvals Center' },
  { key: 'approve_wholesale_director', label: 'Wholesale: Director Approve' },
  { key: 'approve_wholesale_manager', label: 'Wholesale: Manager Approve' },
  { key: 'view_refunds', label: 'Refunds' },
  { key: 'add_refunds', label: 'Refunds: Add Request' },
  { key: 'approve_refunds', label: 'Refunds: Approve/Reject' },
  { key: 'view_expenses', label: 'Expenses' },
  { key: 'add_expenses', label: 'Expenses: Add/Delete' },
  { key: 'approve_expenses', label: 'Expenses: Approve/Reject' },
  { key: 'view_reports', label: 'Reports' },
  { key: 'view_stock_records', label: 'Stock Records' },
  { key: 'view_wholesale_invoices', label: 'Wholesale Invoices' },
  { key: 'view_warehouse_invoices', label: 'Warehouse Invoices' },
  { key: 'view_warehouse_approvals', label: 'Warehouse Approvals' },
  { key: 'view_imei_conflicts', label: 'IMEI Conflicts' },
  { key: 'view_cashdrawer', label: 'Cash Drawer' },
  { key: 'view_users', label: 'Users' },
  { key: 'view_config', label: 'Config' },
  { key: 'view_audit', label: 'Audit Log' }
];

export const GRANT_FEATURE_MAP = Object.fromEntries(
  TENANT_GRANT_CATALOG.map((item) => [item.key, `grants.${item.key}`])
);

export const PLAN_DEFAULT_FEATURES = {
  basic: [
    'modules.dashboard', 'modules.pos', 'modules.invoices', 'modules.sales', 'modules.products',
    'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.suppliers',
    'modules.customers', 'modules.backup', 'admin.users', 'admin.audit',
    'admin.cashDrawer', 'admin.config', 'features.offlineBackup',
    'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords',
    'grants.view_dashboard', 'grants.view_pos', 'grants.view_retail_price', 'grants.view_sales',
    'grants.add_sales', 'grants.view_products', 'grants.add_products', 'grants.edit_products',
    'grants.view_inventory', 'grants.edit_inventory', 'grants.view_labels', 'grants.view_purchases',
    'grants.add_purchases', 'grants.view_suppliers', 'grants.add_suppliers', 'grants.view_customers',
    'grants.add_customers', 'grants.view_cashdrawer', 'grants.view_users', 'grants.view_config'
  ],
  pro: [
    'modules.dashboard', 'modules.pos', 'modules.wholesalePos', 'modules.invoices', 'modules.sales',
    'modules.products', 'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.expenses',
    'modules.transfers', 'modules.adjustments', 'modules.suppliers', 'modules.customers',
    'modules.creditControl', 'modules.approvalsCenter', 'modules.refunds', 'modules.refundApprovals',
    'modules.expenseApprovals', 'modules.reports', 'modules.backup',
    'admin.users', 'admin.manual', 'admin.audit', 'admin.serverLogs', 'admin.stockRecords',
    'admin.cashDrawer', 'admin.config', 'features.offlineBackup',
    'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords',
    ...TENANT_GRANT_CATALOG.map((item) => `grants.${item.key}`).filter((key) => !['grants.approve_credit_director', 'grants.approve_wholesale_director'].includes(key))
  ],
  enterprise: null
};

export const TENANT_FEATURE_CATALOG = [
  { key: 'modules.dashboard', label: 'Dashboard', group: 'Retail / General' },
  { key: 'modules.pos', label: 'POS', group: 'Retail / General' },
  { key: 'modules.sales', label: 'Sales', group: 'Retail / General' },
  { key: 'modules.products', label: 'Products', group: 'Retail / General' },
  { key: 'modules.inventory', label: 'Inventory', group: 'Retail / General' },
  { key: 'modules.labels', label: 'Labels', group: 'Retail / General' },
  { key: 'modules.customers', label: 'Customers', group: 'Retail / General' },
  { key: 'modules.suppliers', label: 'Suppliers', group: 'Retail / General' },
  { key: 'modules.expenses', label: 'Expenses', group: 'Retail / General' },
  { key: 'modules.reports', label: 'Reports', group: 'Retail / General' },
  { key: 'modules.backup', label: 'Backup', group: 'Retail / General' },

  { key: 'modules.wholesalePos', label: 'Wholesale POS', group: 'Distribution / Wholesale' },
  { key: 'modules.invoices', label: 'Invoices', group: 'Distribution / Wholesale' },
  { key: 'modules.purchases', label: 'Purchases', group: 'Distribution / Wholesale' },
  { key: 'modules.transfers', label: 'Transfers', group: 'Distribution / Wholesale' },
  { key: 'modules.adjustments', label: 'Adjustments', group: 'Distribution / Wholesale' },
  { key: 'modules.creditControl', label: 'Credit Control', group: 'Distribution / Wholesale' },
  { key: 'modules.approvalsCenter', label: 'Approvals Center', group: 'Distribution / Wholesale' },
  { key: 'modules.refunds', label: 'Refunds', group: 'Distribution / Wholesale' },
  { key: 'modules.refundApprovals', label: 'Refund Approvals', group: 'Distribution / Wholesale' },
  { key: 'modules.expenseApprovals', label: 'Expense Approvals', group: 'Distribution / Wholesale' },

  { key: 'admin.users', label: 'Users', group: 'Admin / Control' },
  { key: 'admin.manual', label: 'Manual', group: 'Admin / Control' },
  { key: 'admin.audit', label: 'Audit Log', group: 'Admin / Control' },
  { key: 'admin.serverLogs', label: 'Server Logs', group: 'Admin / Control' },
  { key: 'admin.stockRecords', label: 'Stock Records', group: 'Admin / Control' },
  { key: 'admin.cashDrawer', label: 'Cash Drawer', group: 'Admin / Control' },
  { key: 'admin.config', label: 'Config', group: 'Admin / Control' },
  { key: 'admin.godhand', label: 'GodHand', group: 'Admin / Control' },
  { key: 'admin.docs', label: 'Docs', group: 'Admin / Control' },

  { key: 'features.offlineBackup', label: 'Offline usage (queue + backup)', group: 'Platform Features' },
  { key: 'tabs.customerPurchaseHistory', label: 'Customer Purchase History', group: 'Platform Features' },
  { key: 'tabs.posHeldSales', label: 'POS - Held Sales panel', group: 'Platform Features' },
  { key: 'tabs.invoiceNew', label: 'Invoices - New Invoice tab', group: 'Platform Features' },
  { key: 'tabs.invoiceRecords', label: 'Invoices - Records tab', group: 'Platform Features' },

  ...TENANT_GRANT_CATALOG.map((item) => {
    let group = 'Grant Access / Retail';
    if (['view_wholesale_pos', 'view_purchases', 'add_purchases', 'edit_purchases', 'approve_purchases', 'view_transfers', 'add_transfers', 'edit_transfers', 'approve_transfers', 'view_adjustments', 'add_adjustments', 'edit_adjustments', 'approve_adjustments', 'view_credit_control', 'approve_credit_director', 'approve_credit_manager', 'view_credit_repayment_approvals', 'view_approvals', 'approve_wholesale_director', 'approve_wholesale_manager', 'view_wholesale_invoices', 'view_warehouse_invoices', 'view_warehouse_approvals'].includes(item.key)) {
      group = 'Grant Access / Distribution';
    } else if (['view_users', 'view_config', 'view_audit', 'view_stock_records', 'view_cashdrawer', 'view_imei_conflicts'].includes(item.key)) {
      group = 'Grant Access / Admin';
    }
    return { key: `grants.${item.key}`, label: item.label, group };
  })
];

export function filterGrantsByTenantFlags(grants, settings) {
  const flags = settings?.featureFlags || {};
  return (Array.isArray(grants) ? grants : []).filter((grant) => flags[GRANT_FEATURE_MAP[String(grant)] || ''] !== false);
}

export function getPlanDefaultFeatures(plan) {
  const value = String(plan || 'basic').trim().toLowerCase();
  if (value === 'enterprise') return TENANT_FEATURE_CATALOG.map((item) => item.key);
  return (PLAN_DEFAULT_FEATURES[value] || PLAN_DEFAULT_FEATURES.basic).slice();
}
