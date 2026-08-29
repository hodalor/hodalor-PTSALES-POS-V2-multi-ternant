export const TENANT_GRANT_KEYS = [
  'view_dashboard', 'view_dashboard_cashier_assigned', 'view_dashboard_cashier_all', 'view_dashboard_branch_comparison_assigned', 'view_dashboard_branch_comparison_all', 'view_pos', 'view_wholesale_pos', 'view_warehouse_pos', 'view_retail_price', 'view_wholesale_price',
  'view_warehouse_price', 'view_agent_price', 'view_sales', 'add_sales', 'backdate_sales', 'reset_own_password', 'view_products', 'view_distribution_products', 'view_warehouse_products', 'add_products', 'edit_products',
  'view_inventory', 'edit_inventory', 'view_serialized_inventory', 'view_labels', 'view_purchases',
  'add_purchases', 'add_wholesale_purchases', 'add_warehouse_purchases', 'edit_purchases', 'approve_purchases', 'view_transfers', 'add_transfers', 'add_wholesale_transfers', 'add_warehouse_transfers',
  'edit_transfers', 'approve_transfers', 'view_adjustments', 'add_adjustments', 'add_wholesale_adjustments', 'add_warehouse_adjustments', 'edit_adjustments',
  'approve_adjustments', 'view_suppliers', 'add_suppliers', 'edit_suppliers', 'view_customers',
  'view_finance_reconciliation', 'add_finance_reconciliation', 'view_finance_reconciliation_all_branches', 'manage_finance_accounts', 'approve_finance_reconciliation_director', 'approve_finance_reconciliation_manager',
  'view_chat', 'send_chat_messages', 'view_pt_ai',
  'add_customers', 'edit_customers', 'view_credit_control', 'approve_credit_director',
  'approve_credit_manager', 'view_credit_repayment_approvals', 'view_approvals', 'approve_discount_sales',
  'approve_retail_director', 'approve_retail_manager',
  'approve_distribution_director', 'approve_distribution_manager', 'approve_warehouse_director', 'approve_warehouse_manager', 'view_refunds', 'add_refunds', 'view_distribution_refunds', 'add_distribution_refunds',
  'approve_refunds', 'view_expenses', 'add_expenses', 'approve_expenses', 'view_reports', 'view_revenue', 'view_profit', 'view_financials',
  'view_stock_records', 'view_inventory_consistency', 'view_wholesale_invoices', 'view_warehouse_invoices',
  'view_warehouse_approvals', 'view_imei_conflicts', 'view_cashdrawer', 'view_users',
  'view_config', 'view_audit', 'view_super_bin', 'export_tenant_data', 'import_tenant_data'
];

export const GRANT_FEATURE_KEYS = TENANT_GRANT_KEYS.map((key) => `grants.${key}`);

const DASHBOARD_SCOPE_FEATURES = [
  'grants.view_dashboard_cashier_assigned',
  'grants.view_dashboard_cashier_all',
  'grants.view_dashboard_branch_comparison_assigned',
  'grants.view_dashboard_branch_comparison_all'
];

export const ALL_FEATURES = [
  'sections.primary', 'sections.retail', 'sections.distribution', 'sections.warehouse',
  'sections.credit', 'sections.expense', 'sections.finance', 'sections.communication', 'sections.partners', 'sections.admin', 'sections.tabsRuntime',
  'pages.retail.pos', 'pages.retail.purchases', 'pages.retail.transfers', 'pages.retail.adjustments', 'pages.retail.refunds',
  'pages.distribution.goods', 'pages.distribution.pos', 'pages.distribution.invoices', 'pages.distribution.purchase',
  'pages.distribution.transfer', 'pages.distribution.adjustment', 'pages.distribution.refund', 'pages.distribution.approvals',
  'pages.warehouse.goods', 'pages.warehouse.pos', 'pages.warehouse.invoices', 'pages.warehouse.purchase', 'pages.warehouse.transfer',
  'pages.warehouse.adjustment', 'pages.warehouse.approvals',
  'pages.finance.reconciliation',
  'pages.communication.chat', 'pages.communication.askPtAi',
  'modules.dashboard', 'modules.pos', 'modules.wholesalePos', 'modules.invoices', 'modules.sales',
  'modules.products', 'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.expenses', 'modules.finance',
  'modules.communication',
  'modules.transfers', 'modules.adjustments', 'modules.suppliers', 'modules.customers',
  'modules.creditControl', 'modules.approvalsCenter', 'modules.refunds', 'modules.refundApprovals',
  'modules.expenseApprovals', 'modules.reports', 'modules.backup',
  'admin.users', 'admin.manual', 'admin.audit', 'admin.serverLogs', 'admin.stockRecords', 'admin.inventoryConsistency',
  'admin.cashDrawer', 'admin.config', 'admin.superBin', 'admin.godhand', 'admin.docs',
  'features.offlineBackup',
  'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords',
  ...GRANT_FEATURE_KEYS
];

export const PLAN_FEATURES = {
  basic: [
    'sections.primary', 'sections.retail', 'sections.finance', 'sections.partners', 'sections.admin', 'sections.tabsRuntime',
    'pages.retail.pos', 'pages.retail.purchases', 'pages.retail.transfers', 'pages.retail.adjustments', 'pages.retail.refunds',
    'pages.finance.reconciliation',
    'pages.communication.chat', 'pages.communication.askPtAi',
    'modules.dashboard', 'modules.pos', 'modules.invoices', 'modules.sales', 'modules.products',
    'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.finance', 'modules.communication', 'modules.suppliers',
    'modules.customers', 'modules.backup', 'admin.users', 'admin.audit',
    'admin.cashDrawer', 'admin.config', 'admin.superBin', 'features.offlineBackup',
    'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords',
    'grants.view_dashboard', 'grants.view_dashboard_cashier_assigned', 'grants.view_dashboard_cashier_all', 'grants.view_dashboard_branch_comparison_assigned', 'grants.view_dashboard_branch_comparison_all', 'grants.view_pos', 'grants.view_retail_price', 'grants.view_sales',
    'grants.add_sales', 'grants.backdate_sales', 'grants.reset_own_password', 'grants.view_products', 'grants.add_products', 'grants.edit_products',
    'grants.view_inventory', 'grants.edit_inventory', 'grants.view_labels', 'grants.view_purchases',
    'grants.add_purchases', 'grants.add_wholesale_purchases', 'grants.add_warehouse_purchases', 'grants.view_suppliers', 'grants.add_suppliers', 'grants.view_customers', 'grants.view_finance_reconciliation', 'grants.add_finance_reconciliation',
    'grants.view_chat', 'grants.send_chat_messages', 'grants.view_pt_ai', 'grants.add_customers', 'grants.view_cashdrawer', 'grants.view_users', 'grants.view_config', 'grants.view_super_bin',
    'grants.export_tenant_data', 'grants.import_tenant_data'
  ],
  pro: [
    'sections.primary', 'sections.retail', 'sections.distribution', 'sections.warehouse',
    'sections.credit', 'sections.expense', 'sections.finance', 'sections.communication', 'sections.partners', 'sections.admin', 'sections.tabsRuntime',
    'pages.retail.pos', 'pages.retail.purchases', 'pages.retail.transfers', 'pages.retail.adjustments', 'pages.retail.refunds',
    'pages.distribution.goods', 'pages.distribution.pos', 'pages.distribution.invoices', 'pages.distribution.purchase',
    'pages.distribution.transfer', 'pages.distribution.adjustment', 'pages.distribution.refund', 'pages.distribution.approvals',
    'pages.warehouse.goods', 'pages.warehouse.pos', 'pages.warehouse.invoices', 'pages.warehouse.purchase', 'pages.warehouse.transfer',
    'pages.warehouse.adjustment', 'pages.warehouse.approvals',
    'pages.finance.reconciliation',
    'pages.communication.chat', 'pages.communication.askPtAi',
    'modules.dashboard', 'modules.pos', 'modules.wholesalePos', 'modules.invoices', 'modules.sales',
    'modules.products', 'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.expenses', 'modules.finance', 'modules.communication',
    'modules.transfers', 'modules.adjustments', 'modules.suppliers', 'modules.customers',
    'modules.creditControl', 'modules.approvalsCenter', 'modules.refunds', 'modules.refundApprovals',
    'modules.expenseApprovals', 'modules.reports', 'modules.backup',
    'admin.users', 'admin.manual', 'admin.audit', 'admin.serverLogs', 'admin.stockRecords', 'admin.inventoryConsistency',
    'admin.cashDrawer', 'admin.config', 'admin.superBin', 'features.offlineBackup',
    'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords',
    ...GRANT_FEATURE_KEYS.filter((key) => !['grants.approve_credit_director', 'grants.approve_retail_director', 'grants.approve_distribution_director', 'grants.approve_warehouse_director'].includes(key))
  ],
  enterprise: ALL_FEATURES.slice()
};

const SECTION_FALLBACKS = {
  'sections.primary': ['modules.dashboard', 'modules.sales', 'modules.invoices', 'modules.products', 'modules.inventory', 'modules.labels', 'modules.reports', 'modules.backup'],
  'sections.retail': ['modules.pos', 'modules.purchases', 'modules.transfers', 'modules.adjustments', 'modules.refunds'],
  'sections.distribution': ['pages.distribution.goods', 'pages.distribution.pos', 'pages.distribution.invoices', 'pages.distribution.purchase', 'pages.distribution.transfer', 'pages.distribution.adjustment', 'pages.distribution.refund', 'pages.distribution.approvals'],
  'sections.warehouse': ['pages.warehouse.goods', 'pages.warehouse.pos', 'pages.warehouse.invoices', 'pages.warehouse.purchase', 'pages.warehouse.transfer', 'pages.warehouse.adjustment', 'pages.warehouse.approvals'],
  'sections.credit': ['modules.creditControl', 'grants.view_credit_control', 'grants.view_credit_repayment_approvals'],
  'sections.expense': ['modules.expenses', 'modules.expenseApprovals'],
  'sections.finance': ['modules.finance', 'pages.finance.reconciliation', 'grants.view_finance_reconciliation'],
  'sections.communication': ['modules.communication', 'pages.communication.chat', 'pages.communication.askPtAi', 'grants.view_chat', 'grants.send_chat_messages', 'grants.view_pt_ai'],
  'sections.partners': ['modules.suppliers', 'modules.customers'],
  'sections.admin': ['admin.users', 'admin.config', 'admin.audit', 'admin.serverLogs', 'admin.stockRecords', 'admin.inventoryConsistency', 'admin.cashDrawer', 'admin.superBin', 'admin.manual', 'admin.docs', 'admin.godhand'],
  'sections.tabsRuntime': ['features.offlineBackup', 'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords']
};

const PAGE_FALLBACKS = {
  'pages.retail.pos': ['sections.retail', 'modules.pos'],
  'pages.retail.purchases': ['sections.retail', 'modules.purchases'],
  'pages.retail.transfers': ['sections.retail', 'modules.transfers'],
  'pages.retail.adjustments': ['sections.retail', 'modules.adjustments'],
  'pages.retail.refunds': ['sections.retail', 'modules.refunds'],
  'pages.finance.reconciliation': ['sections.finance', 'modules.finance', 'grants.view_finance_reconciliation'],
  'pages.communication.chat': ['sections.communication', 'modules.communication', 'grants.view_chat'],
  'pages.communication.askPtAi': ['sections.communication', 'modules.communication', 'grants.view_pt_ai'],
  'pages.distribution.invoices': ['sections.distribution', 'grants.view_wholesale_invoices'],
  'pages.distribution.approvals': ['sections.distribution', 'grants.approve_distribution_manager'],
  'pages.warehouse.pos': ['sections.warehouse', 'grants.view_warehouse_pos'],
  'pages.warehouse.invoices': ['sections.warehouse', 'grants.view_warehouse_invoices'],
  'pages.warehouse.approvals': ['sections.warehouse', 'grants.view_warehouse_approvals']
};

const FEATURE_DEPENDENCIES = {
  'pages.retail.pos': ['modules.pos', 'grants.view_pos'],
  'pages.retail.purchases': ['modules.purchases', 'grants.view_purchases', 'grants.add_purchases', 'grants.edit_purchases', 'grants.approve_purchases', 'grants.approve_retail_director', 'grants.approve_retail_manager'],
  'pages.retail.transfers': ['modules.transfers', 'grants.view_transfers', 'grants.add_transfers', 'grants.edit_transfers', 'grants.approve_transfers', 'grants.approve_retail_director', 'grants.approve_retail_manager'],
  'pages.retail.adjustments': ['modules.adjustments', 'grants.view_adjustments', 'grants.add_adjustments', 'grants.edit_adjustments', 'grants.approve_adjustments', 'grants.approve_retail_director', 'grants.approve_retail_manager'],
  'pages.retail.refunds': ['modules.refunds', 'grants.view_refunds', 'grants.add_refunds', 'grants.approve_refunds'],
  'pages.finance.reconciliation': ['modules.finance', 'grants.view_finance_reconciliation', 'grants.add_finance_reconciliation'],
  'pages.communication.chat': ['modules.communication', 'grants.view_chat', 'grants.send_chat_messages'],
  'pages.communication.askPtAi': ['modules.communication', 'grants.view_pt_ai'],
  'pages.distribution.goods': ['modules.wholesalePos', 'modules.products', 'grants.view_distribution_products'],
  'pages.distribution.pos': ['modules.wholesalePos', 'modules.products', 'grants.view_wholesale_pos'],
  'pages.distribution.invoices': ['modules.invoices', 'grants.view_wholesale_invoices'],
  'pages.distribution.purchase': ['modules.wholesalePos', 'modules.products', 'grants.view_distribution_products', 'grants.add_wholesale_purchases'],
  'pages.distribution.transfer': ['modules.wholesalePos', 'modules.products', 'grants.view_distribution_products', 'grants.add_transfers'],
  'pages.distribution.adjustment': ['modules.wholesalePos', 'modules.products', 'grants.view_distribution_products', 'grants.add_wholesale_adjustments'],
  'pages.distribution.refund': ['modules.wholesalePos', 'modules.products', 'grants.view_distribution_products', 'grants.add_distribution_refunds'],
  'pages.distribution.approvals': ['modules.wholesalePos', 'modules.products', 'modules.approvalsCenter', 'grants.approve_distribution_director', 'grants.approve_distribution_manager'],
  'pages.warehouse.goods': ['modules.wholesalePos', 'modules.products', 'grants.view_warehouse_products'],
  'pages.warehouse.pos': ['modules.wholesalePos', 'modules.products', 'grants.view_warehouse_pos'],
  'pages.warehouse.invoices': ['modules.invoices', 'grants.view_warehouse_invoices'],
  'pages.warehouse.purchase': ['modules.wholesalePos', 'modules.products', 'grants.view_warehouse_products', 'grants.add_warehouse_purchases'],
  'pages.warehouse.transfer': ['modules.wholesalePos', 'modules.products', 'grants.view_warehouse_products', 'grants.add_transfers'],
  'pages.warehouse.adjustment': ['modules.wholesalePos', 'modules.products', 'grants.view_warehouse_products', 'grants.add_warehouse_adjustments'],
  'pages.warehouse.approvals': ['modules.wholesalePos', 'modules.products', 'modules.approvalsCenter', 'grants.view_warehouse_approvals', 'grants.approve_warehouse_director', 'grants.approve_warehouse_manager']
};

function expandFeatureDependencies(inputKeys = []) {
  const expanded = new Set((inputKeys || []).map((key) => String(key || '').trim()).filter(Boolean));
  let changed = true;
  while (changed) {
    changed = false;
    Array.from(expanded).forEach((key) => {
      const deps = FEATURE_DEPENDENCIES[key] || [];
      deps.forEach((dep) => {
        if (ALL_FEATURES.includes(dep) && !expanded.has(dep)) {
          expanded.add(dep);
          changed = true;
        }
      });
    });
  }
  if (expanded.has('modules.dashboard') || expanded.has('grants.view_dashboard')) {
    DASHBOARD_SCOPE_FEATURES.forEach((key) => {
      if (ALL_FEATURES.includes(key)) expanded.add(key);
    });
  }
  return expanded;
}

export function normalizePlan(plan) {
  const value = String(plan || 'basic').trim().toLowerCase();
  return ['basic', 'pro', 'enterprise'].includes(value) ? value : 'basic';
}

export function normalizeFeatureList(plan, features) {
  if (Array.isArray(features)) {
    const explicit = expandFeatureDependencies(features);
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
  const enabled = expandFeatureDependencies(enabledList);
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
