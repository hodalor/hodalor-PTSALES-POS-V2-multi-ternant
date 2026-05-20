export const TENANT_GRANT_CATALOG = [
  { key: 'view_dashboard', label: 'Open Dashboard' },
  { key: 'view_dashboard_cashier_assigned', label: 'Dashboard Cashier View (Assigned Branches)' },
  { key: 'view_dashboard_cashier_all', label: 'Dashboard Cashier View (All Branches)' },
  { key: 'view_dashboard_branch_comparison_assigned', label: 'Dashboard Branch Comparison (Assigned Branches)' },
  { key: 'view_dashboard_branch_comparison_all', label: 'Dashboard Branch Comparison (All Branches)' },
  { key: 'view_pos', label: 'Use POS' },
  { key: 'view_wholesale_pos', label: 'Use Distribution POS' },
  { key: 'view_retail_price', label: 'See Retail Prices' },
  { key: 'view_wholesale_price', label: 'See Wholesale Prices' },
  { key: 'view_agent_price', label: 'See Agent Prices' },
  { key: 'view_sales', label: 'Open Sales' },
  { key: 'add_sales', label: 'Create Sales' },
  { key: 'backdate_sales', label: 'Backdate Sales' },
  { key: 'view_products', label: 'Open Retail Products' },
  { key: 'view_distribution_products', label: 'Open Distribution Goods' },
  { key: 'view_warehouse_products', label: 'Open Warehouse Goods' },
  { key: 'add_products', label: 'Create Products' },
  { key: 'edit_products', label: 'Edit Products' },
  { key: 'view_inventory', label: 'Open Inventory' },
  { key: 'edit_inventory', label: 'Adjust Inventory' },
  { key: 'view_serialized_inventory', label: 'Open Serialized Inventory' },
  { key: 'view_labels', label: 'Use Labels' },
  { key: 'view_purchases', label: 'Open Purchases' },
  { key: 'add_purchases', label: 'Create Purchases' },
  { key: 'add_wholesale_purchases', label: 'Create Distribution Purchases' },
  { key: 'add_warehouse_purchases', label: 'Create Warehouse Purchases' },
  { key: 'edit_purchases', label: 'Edit Purchases' },
  { key: 'approve_purchases', label: 'Approve Purchases' },
  { key: 'view_transfers', label: 'Open Transfers' },
  { key: 'add_transfers', label: 'Create Transfers' },
  { key: 'add_wholesale_transfers', label: 'Create Distribution Transfers' },
  { key: 'add_warehouse_transfers', label: 'Create Warehouse Transfers' },
  { key: 'edit_transfers', label: 'Edit Transfers' },
  { key: 'approve_transfers', label: 'Approve Transfers' },
  { key: 'view_adjustments', label: 'Open Adjustments' },
  { key: 'add_adjustments', label: 'Create Adjustments' },
  { key: 'add_wholesale_adjustments', label: 'Create Distribution Adjustments' },
  { key: 'add_warehouse_adjustments', label: 'Create Warehouse Adjustments' },
  { key: 'edit_adjustments', label: 'Edit Adjustments' },
  { key: 'approve_adjustments', label: 'Approve Adjustments' },
  { key: 'view_suppliers', label: 'Open Suppliers' },
  { key: 'add_suppliers', label: 'Create Suppliers' },
  { key: 'edit_suppliers', label: 'Edit Suppliers' },
  { key: 'view_customers', label: 'Open Customers' },
  { key: 'add_customers', label: 'Create Customers' },
  { key: 'edit_customers', label: 'Edit Customers' },
  { key: 'view_credit_control', label: 'Open Credit Control' },
  { key: 'approve_credit_director', label: 'Director Credit Approval' },
  { key: 'approve_credit_manager', label: 'Manager Credit Approval' },
  { key: 'view_credit_repayment_approvals', label: 'Open Credit Repayment Approvals' },
  { key: 'view_approvals', label: 'Open Approvals Center' },
  { key: 'approve_distribution_director', label: 'Director Distribution Approval' },
  { key: 'approve_distribution_manager', label: 'Manager Distribution Approval' },
  { key: 'approve_warehouse_director', label: 'Director Warehouse Approval' },
  { key: 'approve_warehouse_manager', label: 'Manager Warehouse Approval' },
  { key: 'view_refunds', label: 'Open Retail Refunds' },
  { key: 'add_refunds', label: 'Create Retail Refund Requests' },
  { key: 'view_distribution_refunds', label: 'Open Distribution Refunds' },
  { key: 'add_distribution_refunds', label: 'Create Distribution Refund Requests' },
  { key: 'approve_refunds', label: 'Refund Approvals' },
  { key: 'view_expenses', label: 'Open Expenses' },
  { key: 'add_expenses', label: 'Create or Delete Expenses' },
  { key: 'approve_expenses', label: 'Approve or Reject Expenses' },
  { key: 'view_reports', label: 'Open Reports' },
  { key: 'view_revenue', label: 'See Revenue Figures' },
  { key: 'view_profit', label: 'See Profit Figures' },
  { key: 'view_finance_reconciliation', label: 'Open Cash Reconciliation' },
  { key: 'add_finance_reconciliation', label: 'Create Cash Reconciliation' },
  { key: 'view_finance_reconciliation_all_branches', label: 'Finance All Branches View' },
  { key: 'manage_finance_accounts', label: 'Manage Finance Accounts' },
  { key: 'approve_finance_reconciliation_director', label: 'Director Reconciliation Approval' },
  { key: 'approve_finance_reconciliation_manager', label: 'Manager Reconciliation Approval' },
  { key: 'view_chat', label: 'Open Internal Chat' },
  { key: 'send_chat_messages', label: 'Send Internal Chat Messages' },
  { key: 'view_pt_ai', label: 'Use Ask PT AI' },
  { key: 'view_stock_records', label: 'Open Stock Records' },
  { key: 'view_inventory_consistency', label: 'Open Inventory Consistency' },
  { key: 'view_wholesale_invoices', label: 'Open Wholesale Invoices' },
  { key: 'view_warehouse_invoices', label: 'Open Warehouse Invoices' },
  { key: 'view_warehouse_approvals', label: 'Open Warehouse Approvals' },
  { key: 'view_imei_conflicts', label: 'Open IMEI Conflicts' },
  { key: 'view_cashdrawer', label: 'Open Cash Drawer' },
  { key: 'view_users', label: 'Open Users' },
  { key: 'view_config', label: 'Open Config' },
  { key: 'view_audit', label: 'Open Audit Log' },
  { key: 'export_tenant_data', label: 'Export Tenant Data' },
  { key: 'import_tenant_data', label: 'Import Tenant Data' }
];

export const GRANT_FEATURE_MAP = Object.fromEntries(
  TENANT_GRANT_CATALOG.map((item) => [item.key, `grants.${item.key}`])
);

export const PLAN_DEFAULT_FEATURES = {
  basic: [
    'modules.dashboard', 'modules.pos', 'modules.invoices', 'modules.sales', 'modules.products',
    'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.finance', 'modules.communication', 'modules.suppliers',
    'modules.customers', 'modules.backup', 'admin.users', 'admin.audit',
    'admin.cashDrawer', 'admin.config', 'features.offlineBackup',
    'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords',
    'grants.view_dashboard', 'grants.view_dashboard_cashier_assigned', 'grants.view_dashboard_cashier_all', 'grants.view_dashboard_branch_comparison_assigned', 'grants.view_dashboard_branch_comparison_all', 'grants.view_pos', 'grants.view_retail_price', 'grants.view_sales',
    'grants.add_sales', 'grants.backdate_sales', 'grants.view_products', 'grants.view_distribution_products', 'grants.view_warehouse_products', 'grants.add_products', 'grants.edit_products',
    'grants.view_inventory', 'grants.edit_inventory', 'grants.view_labels', 'grants.view_purchases',
    'grants.add_purchases', 'grants.view_suppliers', 'grants.add_suppliers', 'grants.view_customers', 'grants.view_finance_reconciliation', 'grants.add_finance_reconciliation',
    'grants.view_chat', 'grants.send_chat_messages', 'grants.view_pt_ai', 'grants.add_customers', 'grants.view_cashdrawer', 'grants.view_users', 'grants.view_config',
    'grants.export_tenant_data', 'grants.import_tenant_data'
  ],
  pro: [
    'modules.dashboard', 'modules.pos', 'modules.wholesalePos', 'modules.invoices', 'modules.sales',
    'modules.products', 'modules.inventory', 'modules.labels', 'modules.purchases', 'modules.expenses', 'modules.finance',
    'modules.transfers', 'modules.adjustments', 'modules.suppliers', 'modules.customers',
    'modules.creditControl', 'modules.approvalsCenter', 'modules.refunds', 'modules.refundApprovals',
    'modules.expenseApprovals', 'modules.reports', 'modules.backup', 'modules.communication',
    'admin.users', 'admin.manual', 'admin.audit', 'admin.serverLogs', 'admin.stockRecords', 'admin.inventoryConsistency',
    'admin.cashDrawer', 'admin.config', 'features.offlineBackup',
    'tabs.customerPurchaseHistory', 'tabs.posHeldSales', 'tabs.invoiceNew', 'tabs.invoiceRecords',
    ...TENANT_GRANT_CATALOG.map((item) => `grants.${item.key}`).filter((key) => !['grants.approve_credit_director', 'grants.approve_distribution_director', 'grants.approve_warehouse_director'].includes(key))
  ],
  enterprise: null
};

export const FEATURE_GROUP_META = {
  'Menus / Retail & General': {
    order: 1,
    title: 'Menus / Retail & General',
    description: 'Main retail-facing screens shown in the sidebar.'
  },
  'Menus / Distribution & Wholesale': {
    order: 2,
    title: 'Menus / Distribution & Wholesale',
    description: 'Distribution, warehouse, and approval-related menu screens.'
  },
  'Menus / Admin & Control': {
    order: 3,
    title: 'Menus / Admin & Control',
    description: 'Admin-only pages, monitoring, and control screens.'
  },
  'Tabs & Workspace': {
    order: 4,
    title: 'Tabs & Workspace',
    description: 'Extra panels and tabs inside enabled pages.'
  },
  'Runtime & Sync': {
    order: 5,
    title: 'Runtime & Sync',
    description: 'Offline queueing and runtime experience features.'
  },
  'Permissions / Pricing & Visibility': {
    order: 6,
    title: 'Permissions / Pricing & Visibility',
    description: 'Controls what prices and visibility-sensitive data users can see.'
  },
  'Permissions / Retail Actions': {
    order: 7,
    title: 'Permissions / Retail Actions',
    description: 'Action permissions for retail-side operations.'
  },
  'Permissions / Distribution Actions': {
    order: 8,
    title: 'Permissions / Distribution Actions',
    description: 'Action permissions for purchasing, transfers, approvals, and warehouse flows.'
  },
  'Permissions / Admin Actions': {
    order: 9,
    title: 'Permissions / Admin Actions',
    description: 'Permissions for admin tools, logs, and control screens.'
  },
  'Permissions / Finance': {
    order: 10,
    title: 'Permissions / Finance',
    description: 'Permissions for reconciliation, bank account management, and deposit approvals.'
  },
  'Permissions / Communication': {
    order: 11,
    title: 'Permissions / Communication',
    description: 'Permissions for tenant chat and Ask PT AI access.'
  }
};

export const TENANT_SIDEBAR_SECTIONS = [
  {
    id: 'primary',
    sectionKey: 'sections.primary',
    title: 'Primary Menus',
    description: 'Top-level sidebar screens that appear on their own.',
    items: [
      { label: 'Dashboard', keys: ['modules.dashboard', 'grants.view_dashboard'] },
      { label: 'Dashboard Competition Scope', keys: ['modules.dashboard', 'grants.view_dashboard_cashier_assigned', 'grants.view_dashboard_cashier_all', 'grants.view_dashboard_branch_comparison_assigned', 'grants.view_dashboard_branch_comparison_all'] },
      { label: 'Sales', keys: ['modules.sales', 'grants.view_sales', 'grants.add_sales'] },
      { label: 'Invoices', keys: ['modules.invoices'] },
      { label: 'Retail Products', keys: ['modules.products', 'grants.view_products', 'grants.add_products', 'grants.edit_products'] },
      { label: 'Inventory', keys: ['modules.inventory', 'grants.view_inventory', 'grants.edit_inventory'] },
      { label: 'Serialized Inventory', keys: ['modules.inventory', 'grants.view_serialized_inventory'] },
      { label: 'Labels', keys: ['modules.labels', 'grants.view_labels'] },
      { label: 'Approvals Center', keys: ['modules.approvalsCenter', 'grants.view_approvals', 'grants.approve_credit_director', 'grants.approve_credit_manager', 'grants.approve_distribution_director', 'grants.approve_distribution_manager', 'grants.approve_warehouse_director', 'grants.approve_warehouse_manager'] },
      { label: 'Refund Approvals', keys: ['modules.refundApprovals', 'grants.approve_refunds'] },
      { label: 'Reports', keys: ['modules.reports', 'grants.view_reports'] },
      { label: 'Finance', keys: ['modules.finance', 'pages.finance.reconciliation', 'grants.view_finance_reconciliation', 'grants.add_finance_reconciliation', 'grants.view_finance_reconciliation_all_branches', 'grants.approve_finance_reconciliation_director', 'grants.approve_finance_reconciliation_manager'] },
      { label: 'Communication', keys: ['modules.communication', 'pages.communication.chat', 'pages.communication.askPtAi', 'grants.view_chat', 'grants.send_chat_messages', 'grants.view_pt_ai'] },
      { label: 'Revenue / Profit Visibility', keys: ['grants.view_revenue', 'grants.view_profit'] },
      { label: 'Backup', keys: ['modules.backup', 'features.offlineBackup', 'grants.export_tenant_data', 'grants.import_tenant_data'] },
      { label: 'IMEI Conflicts', keys: ['modules.backup', 'grants.view_imei_conflicts'] }
    ]
  },
  {
    id: 'retail',
    sectionKey: 'sections.retail',
    title: 'Retail',
    description: 'Matches the Retail group on the sidebar.',
    items: [
      { label: 'POS', keys: ['pages.retail.pos'] },
      { label: 'Purchases', keys: ['pages.retail.purchases', 'modules.purchases', 'grants.view_purchases', 'grants.add_purchases', 'grants.edit_purchases', 'grants.approve_purchases'] },
      { label: 'Transfers', keys: ['pages.retail.transfers', 'modules.transfers', 'grants.view_transfers', 'grants.add_transfers', 'grants.edit_transfers', 'grants.approve_transfers'] },
      { label: 'Adjustments', keys: ['pages.retail.adjustments', 'modules.adjustments', 'grants.view_adjustments', 'grants.add_adjustments', 'grants.edit_adjustments', 'grants.approve_adjustments'] },
      { label: 'Retail Refunds', keys: ['pages.retail.refunds', 'modules.refunds', 'grants.view_refunds', 'grants.add_refunds', 'grants.approve_refunds'] }
    ]
  },
  {
    id: 'distribution',
    sectionKey: 'sections.distribution',
    title: 'Distribution',
    description: 'Matches the Distribution sidebar group and includes approval capabilities by default.',
    items: [
      { label: 'Distribution Goods', keys: ['pages.distribution.goods', 'modules.wholesalePos', 'modules.products', 'grants.view_distribution_products'] },
      { label: 'Distribution POS', keys: ['pages.distribution.pos', 'modules.wholesalePos', 'grants.view_wholesale_pos'] },
      { label: 'Distribution Invoices', keys: ['pages.distribution.invoices', 'modules.invoices', 'grants.view_wholesale_invoices'] },
      { label: 'Distribution Purchase', keys: ['pages.distribution.purchase', 'modules.wholesalePos', 'grants.view_distribution_products', 'grants.add_wholesale_purchases'] },
      { label: 'Distribution Transfer', keys: ['pages.distribution.transfer', 'modules.wholesalePos', 'grants.view_distribution_products', 'grants.add_wholesale_transfers'] },
      { label: 'Distribution Adjustment', keys: ['pages.distribution.adjustment', 'modules.wholesalePos', 'grants.view_distribution_products', 'grants.add_wholesale_adjustments'] },
      { label: 'Distribution Refunds', keys: ['pages.distribution.refund', 'modules.wholesalePos', 'grants.view_distribution_products', 'grants.view_distribution_refunds', 'grants.add_distribution_refunds'] },
      { label: 'Director / Manager Approvals', keys: ['pages.distribution.approvals', 'modules.wholesalePos', 'modules.approvalsCenter', 'grants.approve_distribution_director', 'grants.approve_distribution_manager'] }
    ]
  },
  {
    id: 'warehouse',
    sectionKey: 'sections.warehouse',
    title: 'Warehouse',
    description: 'Matches the Warehouse sidebar group with warehouse-specific approvals.',
    items: [
      { label: 'Warehouse Goods', keys: ['pages.warehouse.goods', 'modules.wholesalePos', 'modules.products', 'grants.view_warehouse_products'] },
      { label: 'Warehouse Invoices', keys: ['pages.warehouse.invoices', 'modules.invoices', 'grants.view_warehouse_invoices'] },
      { label: 'Warehouse Purchase', keys: ['pages.warehouse.purchase', 'modules.wholesalePos', 'grants.view_warehouse_products', 'grants.add_warehouse_purchases'] },
      { label: 'Warehouse Transfer', keys: ['pages.warehouse.transfer', 'modules.wholesalePos', 'grants.view_warehouse_products', 'grants.add_warehouse_transfers'] },
      { label: 'Warehouse Adjustment', keys: ['pages.warehouse.adjustment', 'modules.wholesalePos', 'grants.view_warehouse_products', 'grants.add_warehouse_adjustments'] },
      { label: 'Warehouse Approvals', keys: ['pages.warehouse.approvals', 'modules.wholesalePos', 'modules.approvalsCenter', 'grants.view_warehouse_approvals', 'grants.approve_warehouse_director', 'grants.approve_warehouse_manager'] }
    ]
  },
  {
    id: 'credit',
    sectionKey: 'sections.credit',
    title: 'Credit Sale',
    description: 'Matches the Credit Sale group on the sidebar.',
    items: [
      { label: 'Overview', keys: ['modules.creditControl', 'grants.view_credit_control'] },
      { label: 'Good Clients', keys: ['modules.creditControl', 'grants.view_credit_control'] },
      { label: 'Defaulters', keys: ['modules.creditControl', 'grants.view_credit_control'] },
      { label: 'Payment Approvals', keys: ['grants.view_credit_repayment_approvals', 'grants.approve_credit_director', 'grants.approve_credit_manager'] }
    ]
  },
  {
    id: 'expense',
    sectionKey: 'sections.expense',
    title: 'Expense',
    description: 'Matches the Expense group on the sidebar.',
    items: [
      { label: 'Expenses', keys: ['modules.expenses', 'grants.view_expenses', 'grants.add_expenses'] },
      { label: 'Expense Approvals', keys: ['modules.expenseApprovals', 'grants.approve_expenses'] }
    ]
  },
  {
    id: 'finance',
    sectionKey: 'sections.finance',
    title: 'Finance',
    description: 'Cash reconciliation and company deposit controls.',
    items: [
      { label: 'Cash Reconciliation', keys: ['modules.finance', 'pages.finance.reconciliation', 'grants.view_finance_reconciliation', 'grants.add_finance_reconciliation', 'grants.view_finance_reconciliation_all_branches', 'grants.approve_finance_reconciliation_director', 'grants.approve_finance_reconciliation_manager'] },
      { label: 'Finance Account Management', keys: ['admin.config', 'grants.view_config', 'grants.manage_finance_accounts'] }
    ]
  },
  {
    id: 'communication',
    sectionKey: 'sections.communication',
    title: 'Communication',
    description: 'Internal tenant chat and Ask PT AI guidance.',
    items: [
      { label: 'Chat', keys: ['modules.communication', 'pages.communication.chat', 'grants.view_chat', 'grants.send_chat_messages'] },
      { label: 'Ask PT AI', keys: ['modules.communication', 'pages.communication.askPtAi', 'grants.view_pt_ai'] }
    ]
  },
  {
    id: 'partners',
    sectionKey: 'sections.partners',
    title: 'Partners',
    description: 'Matches the Partners group on the sidebar.',
    items: [
      { label: 'Suppliers', keys: ['modules.suppliers', 'grants.view_suppliers', 'grants.add_suppliers', 'grants.edit_suppliers'] },
      { label: 'Customers', keys: ['modules.customers', 'grants.view_customers', 'grants.add_customers', 'grants.edit_customers'] }
    ]
  },
  {
    id: 'admin',
    sectionKey: 'sections.admin',
    title: 'Admin',
    description: 'Admin submenu items shown inside the Admin group.',
    items: [
      { label: 'Users', keys: ['admin.users', 'grants.view_users'] },
      { label: 'Manual', keys: ['admin.manual'] },
      { label: 'Audit Log', keys: ['admin.audit', 'grants.view_audit'] },
      { label: 'Server Logs', keys: ['admin.serverLogs'] },
      { label: 'Stock Records', keys: ['admin.stockRecords', 'grants.view_stock_records'] },
      { label: 'Inventory Consistency', keys: ['admin.inventoryConsistency', 'grants.view_inventory_consistency'] },
      { label: 'Cash Drawer', keys: ['admin.cashDrawer', 'grants.view_cashdrawer'] },
      { label: 'Config', keys: ['admin.config', 'grants.view_config'] },
      { label: 'GodHand', keys: ['admin.godhand'] },
      { label: 'Docs', keys: ['admin.docs'] }
    ]
  },
  {
    id: 'tabs-runtime',
    sectionKey: 'sections.tabsRuntime',
    title: 'Tabs & Runtime',
    description: 'Smaller workspace tabs and runtime capabilities.',
    items: [
      { label: 'Customer Purchase History Tab', keys: ['tabs.customerPurchaseHistory'] },
      { label: 'POS Held Sales Tab', keys: ['tabs.posHeldSales'] },
      { label: 'Invoices New Tab', keys: ['tabs.invoiceNew'] },
      { label: 'Invoices Records Tab', keys: ['tabs.invoiceRecords'] },
      { label: 'Offline Queue & Backup', keys: ['features.offlineBackup'] },
      { label: 'Price Visibility', keys: ['grants.view_retail_price', 'grants.view_wholesale_price', 'grants.view_agent_price'] }
    ]
  }
];

export const TENANT_FEATURE_CATALOG = [
  { key: 'modules.dashboard', label: 'Dashboard', group: 'Menus / Retail & General' },
  { key: 'modules.pos', label: 'POS', group: 'Menus / Retail & General' },
  { key: 'modules.sales', label: 'Sales', group: 'Menus / Retail & General' },
  { key: 'modules.products', label: 'Products', group: 'Menus / Retail & General' },
  { key: 'modules.inventory', label: 'Inventory', group: 'Menus / Retail & General' },
  { key: 'modules.labels', label: 'Labels', group: 'Menus / Retail & General' },
  { key: 'modules.customers', label: 'Customers', group: 'Menus / Retail & General' },
  { key: 'modules.suppliers', label: 'Suppliers', group: 'Menus / Retail & General' },
  { key: 'modules.expenses', label: 'Expenses', group: 'Menus / Retail & General' },
  { key: 'modules.reports', label: 'Reports', group: 'Menus / Retail & General' },
  { key: 'modules.backup', label: 'Backup', group: 'Menus / Retail & General' },
  { key: 'modules.communication', label: 'Communication', group: 'Menus / Retail & General' },

  { key: 'modules.wholesalePos', label: 'Distribution POS', group: 'Menus / Distribution & Wholesale' },
  { key: 'modules.invoices', label: 'Invoices', group: 'Menus / Distribution & Wholesale' },
  { key: 'modules.purchases', label: 'Purchases', group: 'Menus / Distribution & Wholesale' },
  { key: 'modules.transfers', label: 'Transfers', group: 'Menus / Distribution & Wholesale' },
  { key: 'modules.adjustments', label: 'Adjustments', group: 'Menus / Distribution & Wholesale' },
  { key: 'modules.creditControl', label: 'Credit Control', group: 'Menus / Distribution & Wholesale' },
  { key: 'modules.approvalsCenter', label: 'Approvals Center', group: 'Menus / Distribution & Wholesale' },
  { key: 'modules.refunds', label: 'Refunds', group: 'Menus / Distribution & Wholesale' },
  { key: 'modules.refundApprovals', label: 'Refund Approvals', group: 'Menus / Distribution & Wholesale' },
  { key: 'modules.expenseApprovals', label: 'Expense Approvals', group: 'Menus / Distribution & Wholesale' },

  { key: 'admin.users', label: 'Users', group: 'Menus / Admin & Control' },
  { key: 'admin.manual', label: 'Manual', group: 'Menus / Admin & Control' },
  { key: 'admin.audit', label: 'Audit Log', group: 'Menus / Admin & Control' },
  { key: 'admin.serverLogs', label: 'Server Logs', group: 'Menus / Admin & Control' },
  { key: 'admin.stockRecords', label: 'Stock Records', group: 'Menus / Admin & Control' },
  { key: 'admin.inventoryConsistency', label: 'Inventory Consistency', group: 'Menus / Admin & Control' },
  { key: 'admin.cashDrawer', label: 'Cash Drawer', group: 'Menus / Admin & Control' },
  { key: 'admin.config', label: 'Config', group: 'Menus / Admin & Control' },
  { key: 'admin.godhand', label: 'GodHand', group: 'Menus / Admin & Control' },
  { key: 'admin.docs', label: 'Docs', group: 'Menus / Admin & Control' },

  { key: 'features.offlineBackup', label: 'Offline usage (queue + backup)', group: 'Runtime & Sync' },
  { key: 'tabs.customerPurchaseHistory', label: 'Customer Purchase History', group: 'Tabs & Workspace' },
  { key: 'tabs.posHeldSales', label: 'POS - Held Sales panel', group: 'Tabs & Workspace' },
  { key: 'tabs.invoiceNew', label: 'Invoices - New Invoice tab', group: 'Tabs & Workspace' },
  { key: 'tabs.invoiceRecords', label: 'Invoices - Records tab', group: 'Tabs & Workspace' },

  ...TENANT_GRANT_CATALOG.map((item) => {
    let group = 'Permissions / Retail Actions';
    if (['view_retail_price', 'view_wholesale_price', 'view_agent_price', 'view_revenue', 'view_profit', 'view_financials', 'view_dashboard_cashier_assigned', 'view_dashboard_cashier_all', 'view_dashboard_branch_comparison_assigned', 'view_dashboard_branch_comparison_all'].includes(item.key)) {
      group = 'Permissions / Pricing & Visibility';
    } else if (['view_chat', 'send_chat_messages', 'view_pt_ai'].includes(item.key)) {
      group = 'Permissions / Communication';
    } else if (['view_wholesale_pos', 'view_purchases', 'add_purchases', 'add_wholesale_purchases', 'add_warehouse_purchases', 'edit_purchases', 'approve_purchases', 'view_transfers', 'add_transfers', 'add_wholesale_transfers', 'add_warehouse_transfers', 'edit_transfers', 'approve_transfers', 'view_adjustments', 'add_adjustments', 'add_wholesale_adjustments', 'add_warehouse_adjustments', 'edit_adjustments', 'approve_adjustments', 'view_credit_control', 'approve_credit_director', 'approve_credit_manager', 'view_credit_repayment_approvals', 'view_approvals', 'approve_distribution_director', 'approve_distribution_manager', 'approve_warehouse_director', 'approve_warehouse_manager', 'view_wholesale_invoices', 'view_warehouse_invoices', 'view_warehouse_approvals'].includes(item.key)) {
      group = 'Permissions / Distribution Actions';
    } else if (['view_users', 'view_config', 'view_audit', 'view_stock_records', 'view_inventory_consistency', 'view_cashdrawer', 'view_imei_conflicts', 'export_tenant_data', 'import_tenant_data'].includes(item.key)) {
      group = 'Permissions / Admin Actions';
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
