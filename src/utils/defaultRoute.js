import { isFeatureEnabled } from './featureFlags';

const ROUTE_CANDIDATES = [
  { path: '/dashboard', feature: 'modules.dashboard', roles: ['Admin', 'Manager'], grant: ['view_dashboard', 'see_dashboard'] },
  { path: '/pos', feature: 'pages.retail.pos', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_pos', 'see_pos'] },
  { path: '/wholesale-pos', feature: 'pages.distribution.pos', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_wholesale_pos'] },
  { path: '/wholesale-transfer', feature: 'pages.distribution.transfer', roles: ['Admin', 'Manager', 'Inventory Staff', 'Cashier'], grant: ['add_transfers', 'view_transfers', 'see_transfers'] },
  { path: '/wholesale-goods', feature: 'pages.distribution.goods', roles: ['Admin', 'Manager', 'Inventory Staff', 'Cashier'], grant: ['view_distribution_products'] },
  { path: '/wholesale-purchase', feature: 'pages.distribution.purchase', roles: ['Admin', 'Manager', 'Inventory Staff', 'Cashier'], grant: ['add_wholesale_purchases'] },
  { path: '/wholesale-adjustment', feature: 'pages.distribution.adjustment', roles: ['Admin', 'Manager', 'Inventory Staff', 'Cashier'], grant: ['add_wholesale_adjustments'] },
  { path: '/wholesale-invoices', feature: 'pages.distribution.invoices', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_wholesale_invoices'] },
  { path: '/warehouse-transfer', feature: 'pages.warehouse.transfer', roles: ['Admin', 'Manager', 'Inventory Staff', 'Cashier'], grant: ['add_transfers', 'view_transfers', 'see_transfers'] },
  { path: '/warehouse-goods', feature: 'pages.warehouse.goods', roles: ['Admin', 'Manager', 'Inventory Staff', 'Cashier'], grant: ['view_warehouse_products'] },
  { path: '/warehouse-purchase', feature: 'pages.warehouse.purchase', roles: ['Admin', 'Manager', 'Inventory Staff', 'Cashier'], grant: ['add_warehouse_purchases'] },
  { path: '/warehouse-adjustment', feature: 'pages.warehouse.adjustment', roles: ['Admin', 'Manager', 'Inventory Staff', 'Cashier'], grant: ['add_warehouse_adjustments'] },
  { path: '/warehouse-invoices', feature: 'pages.warehouse.invoices', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_warehouse_invoices'] },
  { path: '/warehouse-approvals', feature: 'pages.warehouse.approvals', roles: ['Admin', 'Manager', 'SuperAdmin'], grant: ['view_warehouse_approvals', 'approve_warehouse_director', 'approve_warehouse_manager'] },
  { path: '/inventory', feature: 'modules.inventory', roles: ['Admin', 'Manager', 'Inventory Staff'], grant: ['view_inventory', 'see_inventory'] },
  { path: '/serialized-inventory', feature: 'modules.inventory', roles: ['Admin', 'Manager', 'Inventory Staff'], grant: ['view_inventory', 'see_inventory', 'view_serialized_inventory'] },
  { path: '/products', feature: 'modules.products', roles: ['Admin', 'Manager', 'Inventory Staff'], grant: ['view_products', 'see_products'] },
  { path: '/transfers', feature: 'pages.retail.transfers', roles: ['Admin', 'Manager', 'Inventory Staff'], grant: ['view_transfers', 'see_transfers'] },
  { path: '/adjustments', feature: 'pages.retail.adjustments', roles: ['Admin', 'Manager', 'Inventory Staff'], grant: ['view_adjustments', 'see_adjustments'] },
  { path: '/purchases', feature: 'pages.retail.purchases', roles: ['Admin', 'Manager', 'Inventory Staff'], grant: ['view_purchases', 'see_purchases'] },
  { path: '/sales', feature: 'modules.sales', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_sales', 'see_sales'] },
  { path: '/invoices', feature: 'modules.invoices', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_invoices', 'see_invoices'] },
  { path: '/customers', feature: 'sections.partners', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_customers', 'see_customers'] },
  { path: '/suppliers', feature: 'sections.partners', roles: ['Admin', 'Manager', 'Inventory Staff'], grant: ['view_suppliers', 'see_suppliers'] },
  { path: '/credit-control', feature: 'modules.creditControl', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_credit_control'] },
  { path: '/reports', feature: 'modules.reports', roles: ['Admin', 'Manager', 'Auditor'], grant: ['view_reports', 'see_reports'] },
  { path: '/cash-reconciliation', feature: 'pages.finance.reconciliation', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_finance_reconciliation', 'add_finance_reconciliation', 'approve_finance_reconciliation_director', 'approve_finance_reconciliation_manager'] },
  { path: '/expenses', feature: 'sections.expense', roles: ['Admin', 'Manager'], grant: ['view_expenses', 'see_expenses', 'add_expenses'] },
  { path: '/approvals-center', feature: 'modules.approvalsCenter', roles: ['Admin', 'Manager', 'SuperAdmin'], grant: ['view_approvals', 'approve_distribution_director', 'approve_distribution_manager', 'approve_warehouse_director', 'approve_warehouse_manager', 'approve_credit_director', 'approve_credit_manager'] },
  { path: '/users', feature: 'sections.admin', roles: ['Admin', 'SuperAdmin'], grant: ['view_users', 'see_users'] },
  { path: '/config', feature: 'sections.admin', roles: ['Admin', 'Manager'], grant: ['view_config', 'see_config'] },
  { path: '/cashdrawer', feature: 'sections.admin', roles: ['Admin', 'Manager', 'Cashier'], grant: ['view_cashdrawer', 'see_cashdrawer'] },
  { path: '/tenants', roles: ['SuperAdmin'] }
];

function normalizeGrants(rawGrants) {
  return Array.isArray(rawGrants) ? rawGrants : [];
}

function hasGrant(grants, grant) {
  if (!grant) return false;
  if (grants.includes(grant)) return true;
  if (grant.startsWith('view_')) return grants.includes(`see_${grant.slice(5)}`);
  if (grant.startsWith('see_')) return grants.includes(`view_${grant.slice(4)}`);
  return false;
}

function canAccessRoute(auth = {}, settings = {}, route) {
  const role = String(auth?.role || '').trim();
  const roleLower = role.toLowerCase();
  const isSuper = roleLower === 'superadmin' && String(auth?.user?.tenantId || '').toLowerCase() === 'master';
  if (isSuper) return true;
  if (route?.feature && !isFeatureEnabled(settings, route.feature)) return false;
  const grants = normalizeGrants(auth?.grants);
  const requested = Array.isArray(route?.grant) ? route.grant : route?.grant ? [route.grant] : [];
  const roleAllowed = Array.isArray(route?.roles) && route.roles.length > 0 ? route.roles.includes(role) : true;
  if (requested.length > 0) {
    const grantEnabled = requested.some((entry) => settings?.featureFlags?.[`grants.${String(entry || '')}`] !== false);
    if (!grantEnabled) return false;
    const grantAllowed = requested.some((entry) => hasGrant(grants, entry));
    if (!['superadmin', 'admin'].includes(roleLower) && !grantAllowed) return false;
    if (['superadmin', 'admin'].includes(roleLower)) return grantAllowed || roleAllowed;
    return roleAllowed;
  }
  return roleAllowed;
}

export function resolveDefaultRoute(auth = {}, settings = {}, options = {}) {
  const preferredPath = String(options?.preferredPath || '').trim();
  const exclude = new Set((Array.isArray(options?.exclude) ? options.exclude : []).filter(Boolean));
  const candidates = preferredPath
    ? [
        ...ROUTE_CANDIDATES.filter((route) => route.path === preferredPath),
        ...ROUTE_CANDIDATES.filter((route) => route.path !== preferredPath)
      ]
    : ROUTE_CANDIDATES;
  const match = candidates.find((route) => !exclude.has(route.path) && canAccessRoute(auth, settings, route));
  if (match?.path) return match.path;
  const roleLower = String(auth?.role || '').toLowerCase();
  if (roleLower === 'superadmin') return '/tenants';
  if (roleLower === 'admin' || roleLower === 'manager') return '/dashboard';
  return '/login';
}

