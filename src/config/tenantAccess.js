export const TENANT_GRANT_KEYS = [
  'view_dashboard', 'view_pos', 'view_wholesale_pos', 'view_retail_price', 'view_wholesale_price',
  'view_agent_price', 'view_sales', 'add_sales', 'view_products', 'add_products', 'edit_products',
  'view_inventory', 'edit_inventory', 'view_serialized_inventory', 'view_labels', 'view_purchases',
  'add_purchases', 'edit_purchases', 'approve_purchases', 'view_transfers', 'add_transfers',
  'edit_transfers', 'approve_transfers', 'view_adjustments', 'add_adjustments', 'edit_adjustments',
  'approve_adjustments', 'view_suppliers', 'add_suppliers', 'edit_suppliers', 'view_customers',
  'add_customers', 'edit_customers', 'view_credit_control', 'approve_credit_director',
  'approve_credit_manager', 'view_credit_repayment_approvals', 'view_approvals',
  'approve_wholesale_director', 'approve_wholesale_manager', 'view_refunds', 'add_refunds',
  'approve_refunds', 'view_expenses', 'add_expenses', 'approve_expenses', 'view_reports',
  'view_stock_records', 'view_wholesale_invoices', 'view_warehouse_invoices',
  'view_warehouse_approvals', 'view_imei_conflicts', 'view_cashdrawer', 'view_users',
  'view_config', 'view_audit'
];

export const GRANT_FEATURE_KEYS = TENANT_GRANT_KEYS.map((key) => `grants.${key}`);

export const ALL_FEATURES = [
  'modules.dashboard', 'modules.pos', 'modules.wholesalePos', 'modules.invoices', 'modules.sales',
  'modules.products', 'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.expenses',
  'modules.transfers', 'modules.adjustments', 'modules.suppliers', 'modules.customers',
  'modules.creditControl', 'modules.approvalsCenter', 'modules.refunds', 'modules.refundApprovals',
  'modules.expenseApprovals', 'modules.reports', 'modules.backup',
  'admin.users', 'admin.manual', 'admin.audit', 'admin.serverLogs', 'admin.stockRecords',
  'admin.cashDrawer', 'admin.config', 'admin.godhand', 'admin.docs',
  'features.offlineBackup',
  'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords',
  ...GRANT_FEATURE_KEYS
];

export const PLAN_FEATURES = {
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
    ...GRANT_FEATURE_KEYS.filter((key) => !['grants.approve_credit_director', 'grants.approve_wholesale_director'].includes(key))
  ],
  enterprise: ALL_FEATURES.slice()
};

export function normalizePlan(plan) {
  const value = String(plan || 'basic').trim().toLowerCase();
  return ['basic', 'pro', 'enterprise'].includes(value) ? value : 'basic';
}

export function normalizeFeatureList(plan, features) {
  const base = new Set(PLAN_FEATURES[normalizePlan(plan)] || PLAN_FEATURES.basic);
  const extras = Array.isArray(features) ? features : [];
  extras.forEach((key) => {
    const value = String(key || '').trim();
    if (ALL_FEATURES.includes(value)) base.add(value);
  });
  return ALL_FEATURES.filter((key) => base.has(key));
}

export function featureFlagsFromEnabled(enabledList) {
  const enabled = new Set((enabledList || []).map((x) => String(x)));
  const flags = {};
  ALL_FEATURES.forEach((key) => {
    if (!enabled.has(key)) flags[key] = false;
  });
  return flags;
}

export function filterGrantsByFeatureFlags(grants, flags) {
  const featureFlags = flags || {};
  return (Array.isArray(grants) ? grants : []).filter((grant) => featureFlags[`grants.${String(grant)}`] !== false);
}
