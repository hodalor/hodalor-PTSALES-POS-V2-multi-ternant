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

export async function refreshAllData(dispatch) {
  const results = await Promise.allSettled([
    productsApi.list(),
    suppliersApi.list(),
    customersApi.list(),
    branchesApi.list(),
    refundsApi.listRequests(),
    purchasesApi.listRequests({ status: 'pending_approval', limit: 200 }),
    transfersApi.listRequests({ status: 'pending_approval', limit: 200 }),
    expensesApi.listRequests(),
    adjustmentsApi.listRequests(),
    salesApi.list(),
    usersApi.list(),
    auditsApi.list(),
    invoicesApi.list()
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
