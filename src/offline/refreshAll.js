import * as productsApi from '../api/products';
import * as suppliersApi from '../api/suppliers';
import * as customersApi from '../api/customers';
import * as branchesApi from '../api/branches';
import * as refundsApi from '../api/refunds';
import * as purchasesApi from '../api/purchases';
import * as transfersApi from '../api/transfers';
import * as salesApi from '../api/sales';
import * as usersApi from '../api/users';
import * as auditsApi from '../api/audits';
import * as invoicesApi from '../api/invoices';
import { setProducts } from '../store/productsSlice';
import { setSuppliers } from '../store/suppliersSlice';
import { setCustomers } from '../store/customersSlice';
import { setBranches } from '../store/branchesSlice';
import { setRequests } from '../store/refundsSlice';
import { setExpenseRequests } from '../store/expenseRequestsSlice';
import { setAdjustmentRequests } from '../store/adjustmentRequestsSlice';
import { setSales } from '../store/salesSlice';
import { setUsers } from '../store/usersSlice';
import { setEntries as setAuditEntries } from '../store/auditSlice';
import { setInvoices } from '../store/invoicesSlice';
import * as expensesApi from '../api/expenses';
import * as adjustmentsApi from '../api/adjustments';
import { setPurchaseRequests } from '../store/purchasesSlice';
import { setTransferRequests } from '../store/transfersSlice';
import { isFeatureEnabled } from '../utils/featureFlags';

export async function refreshAllData(dispatch, getState) {
  const state = typeof getState === 'function' ? getState() : {};
  const settings = state?.settings || {};
  const auth = state?.auth || {};
  const roleLower = String(auth?.role || '').toLowerCase();
  const grants = Array.isArray(auth?.grants) ? auth.grants : [];
  const hasGrant = (grant) => {
    const value = String(grant || '');
    if (!value) return false;
    if (grants.includes(value)) return true;
    if (value.startsWith('view_')) return grants.includes(`see_${value.slice(5)}`);
    if (value.startsWith('see_')) return grants.includes(`view_${value.slice(4)}`);
    return false;
  };
  const allow = (feature, roles = [], requestedGrants = []) => {
    if (!feature || !isFeatureEnabled(settings, feature)) return false;
    if (roleLower === 'superadmin') return true;
    const roleOk = (roles || []).map((item) => String(item || '').toLowerCase()).includes(roleLower);
    const required = Array.isArray(requestedGrants) ? requestedGrants : [requestedGrants];
    if (required.length === 0 || required.every((item) => !item)) return roleOk;
    if (roleLower !== 'admin') return required.some(hasGrant);
    return roleOk || required.some(hasGrant);
  };
  const canUseExpenseApprovals = isFeatureEnabled(settings, 'modules.expenseApprovals') && allow('modules.expenseApprovals', ['Admin','Manager'], ['approve_expenses']);
  const canUseAdjustmentApprovals = isFeatureEnabled(settings, 'pages.retail.adjustments') && allow('pages.retail.adjustments', ['Admin','Manager','Director'], ['approve_adjustments']);
  const canLoadPosProducts = (
    (isFeatureEnabled(settings, 'pages.retail.pos') && allow('pages.retail.pos', ['Admin','Manager','Cashier'], ['view_pos','see_pos']))
    || (isFeatureEnabled(settings, 'pages.distribution.pos') && allow('pages.distribution.pos', ['Admin','Manager','Cashier'], ['view_wholesale_pos']))
  );
  const canLoadRefunds = (
    (isFeatureEnabled(settings, 'pages.retail.refunds') && allow('pages.retail.refunds', ['Admin','Manager','Cashier'], ['view_refunds','see_refunds']))
    || (isFeatureEnabled(settings, 'pages.distribution.refund') && allow('pages.distribution.refund', ['Admin','Manager','Inventory Staff','Cashier'], ['view_distribution_refunds','add_distribution_refunds']))
    || allow('modules.sales', ['Admin','Manager','Cashier'], ['view_sales','see_sales'])
    || allow('modules.dashboard', ['Admin','Manager'], ['view_dashboard','see_dashboard'])
    || allow('modules.reports', ['Admin','Manager','Auditor'], ['view_reports','see_reports'])
    || allow('pages.finance.reconciliation', ['Admin','Manager','Cashier'], ['view_finance_reconciliation','add_finance_reconciliation','approve_finance_reconciliation_director','approve_finance_reconciliation_manager'])
  );
  const results = await Promise.allSettled([
    (allow('modules.products', ['Admin','Manager','Inventory Staff'], ['view_products','see_products','view_distribution_products','view_warehouse_products']) || canLoadPosProducts) ? productsApi.list() : Promise.resolve([]),
    isFeatureEnabled(settings, 'modules.suppliers') && allow('modules.suppliers', ['Admin','Manager','Inventory Staff'], ['view_suppliers','see_suppliers']) ? suppliersApi.list() : Promise.resolve([]),
    isFeatureEnabled(settings, 'modules.customers') && allow('modules.customers', ['Admin','Manager','Cashier'], ['view_customers','see_customers']) ? customersApi.list() : Promise.resolve([]),
    branchesApi.list(),
    canLoadRefunds ? refundsApi.listRequests() : Promise.resolve([]),
    isFeatureEnabled(settings, 'pages.retail.purchases') && allow('pages.retail.purchases', ['Admin','Manager','Inventory Staff','Director'], ['approve_purchases','view_purchases','see_purchases']) ? purchasesApi.listRequests({ status: 'pending_approval', limit: 200 }) : Promise.resolve([]),
    isFeatureEnabled(settings, 'pages.retail.transfers') && allow('pages.retail.transfers', ['Admin','Manager','Inventory Staff','Director'], ['approve_transfers','view_transfers','see_transfers']) ? transfersApi.listRequests({ status: 'pending_approval', limit: 200 }) : Promise.resolve([]),
    canUseExpenseApprovals ? expensesApi.listRequests() : Promise.resolve([]),
    canUseAdjustmentApprovals ? adjustmentsApi.listRequests() : Promise.resolve([]),
    allow('modules.sales', ['Admin','Manager','Cashier'], ['view_sales','see_sales']) ? salesApi.list({ all: true }) : Promise.resolve([]),
    isFeatureEnabled(settings, 'admin.users') && allow('admin.users', ['Admin'], ['view_users','see_users']) ? usersApi.list() : Promise.resolve([]),
    ((isFeatureEnabled(settings, 'admin.audit') && allow('admin.audit', ['Admin'], ['view_audit','see_audit'])) || (isFeatureEnabled(settings, 'sections.admin') && allow('sections.admin', ['Admin'], ['view_stock_records','see_stock_records']))) ? auditsApi.list({ all: true }) : Promise.resolve([]),
    isFeatureEnabled(settings, 'modules.invoices') && allow('modules.invoices', ['Admin','Manager','Cashier'], ['view_invoices','see_invoices','view_wholesale_invoices','view_warehouse_invoices']) ? invoicesApi.list() : Promise.resolve([])
  ]);
  const [p, s, c, b, r, pr, tr, er, ar, sl, u, au, invs] = results;
  if (p.status === 'fulfilled' && Array.isArray(p.value)) dispatch(setProducts(p.value));
  if (s.status === 'fulfilled' && Array.isArray(s.value)) dispatch(setSuppliers(s.value));
  if (c.status === 'fulfilled' && Array.isArray(c.value)) dispatch(setCustomers(c.value));
  if (b.status === 'fulfilled' && Array.isArray(b.value) && b.value.length > 0) dispatch(setBranches(b.value));
  if (r.status === 'fulfilled' && Array.isArray(r.value)) dispatch(setRequests(r.value));
  if (pr.status === 'fulfilled' && Array.isArray(pr.value)) dispatch(setPurchaseRequests(pr.value));
  if (tr.status === 'fulfilled' && Array.isArray(tr.value)) dispatch(setTransferRequests(tr.value));
  if (er.status === 'fulfilled' && Array.isArray(er.value)) dispatch(setExpenseRequests(er.value));
  if (ar.status === 'fulfilled' && Array.isArray(ar.value)) dispatch(setAdjustmentRequests(ar.value));
  if (sl.status === 'fulfilled' && Array.isArray(sl.value)) dispatch(setSales(sl.value));
  if (u.status === 'fulfilled' && Array.isArray(u.value)) dispatch(setUsers(u.value));
  if (au.status === 'fulfilled' && Array.isArray(au.value) && au.value.length > 0) dispatch(setAuditEntries(au.value));
  if (invs.status === 'fulfilled' && Array.isArray(invs.value)) dispatch(setInvoices(invs.value));
}
