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
  'sections.primary', 'sections.retail', 'sections.distribution', 'sections.warehouse',
  'sections.credit', 'sections.expense', 'sections.partners', 'sections.admin', 'sections.tabsRuntime',
  'pages.retail.pos', 'pages.retail.purchases', 'pages.retail.transfers', 'pages.retail.adjustments', 'pages.retail.refunds',
  'pages.distribution.goods', 'pages.distribution.pos', 'pages.distribution.invoices', 'pages.distribution.purchase',
  'pages.distribution.transfer', 'pages.distribution.adjustment', 'pages.distribution.refund', 'pages.distribution.approvals',
  'pages.warehouse.goods', 'pages.warehouse.invoices', 'pages.warehouse.purchase', 'pages.warehouse.transfer',
  'pages.warehouse.adjustment', 'pages.warehouse.approvals',
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
    'sections.primary', 'sections.retail', 'sections.partners', 'sections.admin', 'sections.tabsRuntime',
    'pages.retail.pos', 'pages.retail.purchases', 'pages.retail.transfers', 'pages.retail.adjustments', 'pages.retail.refunds',
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
    'sections.primary', 'sections.retail', 'sections.distribution', 'sections.warehouse',
    'sections.credit', 'sections.expense', 'sections.partners', 'sections.admin', 'sections.tabsRuntime',
    'pages.retail.pos', 'pages.retail.purchases', 'pages.retail.transfers', 'pages.retail.adjustments', 'pages.retail.refunds',
    'pages.distribution.goods', 'pages.distribution.pos', 'pages.distribution.invoices', 'pages.distribution.purchase',
    'pages.distribution.transfer', 'pages.distribution.adjustment', 'pages.distribution.refund', 'pages.distribution.approvals',
    'pages.warehouse.goods', 'pages.warehouse.invoices', 'pages.warehouse.purchase', 'pages.warehouse.transfer',
    'pages.warehouse.adjustment', 'pages.warehouse.approvals',
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

const SECTION_FALLBACKS = {
  'sections.primary': ['modules.dashboard', 'modules.sales', 'modules.invoices', 'modules.products', 'modules.inventory', 'modules.labels', 'modules.reports', 'modules.backup'],
  'sections.retail': ['modules.pos', 'modules.purchases', 'modules.transfers', 'modules.adjustments', 'modules.refunds'],
  'sections.distribution': ['modules.wholesalePos', 'grants.view_wholesale_invoices'],
  'sections.warehouse': ['grants.view_warehouse_invoices', 'grants.view_warehouse_approvals'],
  'sections.credit': ['modules.creditControl', 'grants.view_credit_control', 'grants.view_credit_repayment_approvals'],
  'sections.expense': ['modules.expenses', 'modules.expenseApprovals'],
  'sections.partners': ['modules.suppliers', 'modules.customers'],
  'sections.admin': ['admin.users', 'admin.config', 'admin.audit', 'admin.serverLogs', 'admin.stockRecords', 'admin.cashDrawer', 'admin.manual', 'admin.docs', 'admin.godhand'],
  'sections.tabsRuntime': ['features.offlineBackup', 'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords']
};

const PAGE_FALLBACKS = {
  'pages.retail.pos': ['sections.retail', 'modules.pos'],
  'pages.retail.purchases': ['sections.retail', 'modules.purchases'],
  'pages.retail.transfers': ['sections.retail', 'modules.transfers'],
  'pages.retail.adjustments': ['sections.retail', 'modules.adjustments'],
  'pages.retail.refunds': ['sections.retail', 'modules.refunds'],
  'pages.distribution.goods': ['sections.distribution', 'modules.wholesalePos'],
  'pages.distribution.pos': ['sections.distribution', 'modules.wholesalePos'],
  'pages.distribution.invoices': ['sections.distribution', 'modules.invoices'],
  'pages.distribution.purchase': ['sections.distribution', 'modules.purchases'],
  'pages.distribution.transfer': ['sections.distribution', 'modules.transfers'],
  'pages.distribution.adjustment': ['sections.distribution', 'modules.adjustments'],
  'pages.distribution.refund': ['sections.distribution', 'modules.refunds'],
  'pages.distribution.approvals': ['sections.distribution', 'grants.approve_wholesale_manager'],
  'pages.warehouse.goods': ['sections.warehouse', 'modules.wholesalePos'],
  'pages.warehouse.invoices': ['sections.warehouse', 'grants.view_warehouse_invoices'],
  'pages.warehouse.purchase': ['sections.warehouse', 'modules.purchases'],
  'pages.warehouse.transfer': ['sections.warehouse', 'modules.transfers'],
  'pages.warehouse.adjustment': ['sections.warehouse', 'modules.adjustments'],
  'pages.warehouse.approvals': ['sections.warehouse', 'grants.view_warehouse_approvals']
};

export function normalizePlan(plan) {
  const value = String(plan || 'basic').trim().toLowerCase();
  return ['basic', 'pro', 'enterprise'].includes(value) ? value : 'basic';
}

export function normalizeFeatureList(plan, features) {
  if (Array.isArray(features)) {
    const explicit = new Set(features.map((key) => String(key || '').trim()).filter((key) => ALL_FEATURES.includes(key)));
    return ALL_FEATURES.filter((key) => explicit.has(key));
  }
  const base = new Set(PLAN_FEATURES[normalizePlan(plan)] || PLAN_FEATURES.basic);
  const extras = [];
  extras.forEach((key) => {
    const value = String(key || '').trim();
    if (ALL_FEATURES.includes(value)) base.add(value);
  });
  return ALL_FEATURES.filter((key) => base.has(key));
}

export function featureFlagsFromEnabled(enabledList) {
  const enabled = new Set((enabledList || []).map((x) => String(x)));
  Object.entries(SECTION_FALLBACKS).forEach(([sectionKey, fallbackKeys]) => {
    if (!enabled.has(sectionKey) && fallbackKeys.some((key) => enabled.has(key))) {
      enabled.add(sectionKey);
    }
  });
  Object.entries(PAGE_FALLBACKS).forEach(([pageKey, fallbackKeys]) => {
    if (!enabled.has(pageKey) && fallbackKeys.every((key) => enabled.has(key))) {
      enabled.add(pageKey);
    }
  });
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
