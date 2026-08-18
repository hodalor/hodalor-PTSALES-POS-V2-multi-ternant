import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRepayment, getCustomerCreditSummary, listCreditCustomers, listCreditSales, listRepayments, removeCreditSale, removeManyCreditSales, removeManyRepayments, removeRepayment } from '../api/credits';
import { useToast } from '../components/ToastProvider';
import { formatCurrency } from '../utils/currency';
import { confirmDialog, promptDialog } from '../utils/dialogs';
import { useSelector } from 'react-redux';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import InlineSpinner from '../components/InlineSpinner';
import BranchSelect from '../components/BranchSelect';
import LoadingDots from '../components/LoadingDots';
import Modal from '../components/Modal';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import { formatDate, formatDateTime } from '../utils/dateFormat';
import { getCreditModeLabel, isCreditSale } from '../utils/saleAccounting';

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function sortByLatest(rows = [], picker) {
  return [...rows].sort((a, b) => {
    const aTs = new Date(typeof picker === 'function' ? picker(a) : a?.created_at || a?.createdAt || 0).getTime();
    const bTs = new Date(typeof picker === 'function' ? picker(b) : b?.created_at || b?.createdAt || 0).getTime();
    return (Number.isNaN(bTs) ? 0 : bTs) - (Number.isNaN(aTs) ? 0 : aTs);
  });
}

function isCreditSaleRecord(row) {
  return isCreditSale(row);
}

function getCreditPackageLabel(row) {
  return getCreditModeLabel(row);
}

function normalizeCreditSaleRow(row = {}) {
  const totalAmount = toNumber(row.total_amount ?? row.totalAmount ?? row.total);
  const amountPaid = toNumber(row.amount_paid ?? row.amountPaid ?? row.creditAmountPaidNow ?? row.creditSale?.amount_paid ?? row.creditSale?.amountPaidNow);
  const balance = row.balance != null
    ? toNumber(row.balance)
    : Math.max(0, totalAmount - amountPaid);
  const accumulatedPenalty = toNumber(row.accumulated_penalty ?? row.accumulatedPenalty ?? row.creditSale?.accumulated_penalty);
  const dueDate = row.due_date || row.dueDate || row.creditDueDate || row.creditSale?.due_date || row.creditSale?.dueDate || null;
  const createdAt = row.createdAt || row.created_at || row.saleDate || row.date || null;
  const nowTs = Date.now();
  const dueTs = dueDate ? new Date(dueDate).getTime() : NaN;
  const rawStatus = String(row.status || '').trim().toLowerCase();
  let status = rawStatus;
  if (!['active', 'overdue', 'completed'].includes(status)) {
    if (balance <= 0) status = 'completed';
    else if (!Number.isNaN(dueTs) && dueTs < nowTs) status = 'overdue';
    else status = 'active';
  }
  const overdueDays = row.overdue_days != null
    ? Math.max(0, Number(row.overdue_days || 0))
    : (status === 'overdue' && !Number.isNaN(dueTs)
        ? Math.max(0, Math.floor((nowTs - dueTs) / (24 * 3600 * 1000)))
        : 0);
  return {
    ...row,
    _id: row._id || row.saleId || row.id || row.clientId || '',
    saleId: row.saleId || row.id || row._id || row.clientId || '',
    customer_id: row.customer_id || row.customerId || '',
    branchId: row.branchId || '',
    posType: String(row.posType || row.inventoryType || 'retail').toLowerCase() === 'wholesale' ? 'wholesale' : 'retail',
    items: Array.isArray(row.items) ? row.items : [],
    total_amount: totalAmount,
    amount_paid: amountPaid,
    balance,
    accumulated_penalty: accumulatedPenalty,
    creditPackageId: row.creditPackageId || row.creditSale?.creditPackageId || '',
    creditPackageName: row.creditPackageName || row.creditSale?.creditPackageName || '',
    due_date: dueDate,
    createdAt,
    overdue_days: overdueDays,
    status
  };
}

function formatPaymentRecordSummary(entry = {}, settings = {}) {
  const bits = [
    entry.label || 'Payment',
    formatCurrency(Number(entry.amount || 0), settings),
    formatDateTime(entry.paidAt || entry.approvedAt || entry.initiatedAt),
    entry.paymentMethod ? String(entry.paymentMethod).toUpperCase() : '',
    entry.status ? String(entry.status).replace(/_/g, ' ') : '',
    entry.remark || ''
  ].filter(Boolean);
  return bits.join(' • ');
}

function CreditControlPage({ initialSection = 'clients', clientFilter = 'all', title = 'Credit Sale Control', description = 'Credit sale balances, overdue tracking, customer rank, and repayment initiation.' }) {
  const settings = useSelector(s => s.settings);
  const saleRows = useSelector(s => s.sales.sales || []);
  const branches = useSelector(s => s.branches.branches || []);
  const auth = useSelector(s => s.auth);
  const toast = useToast();
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const roleLower = String(auth.role || '').toLowerCase();
  const canDeleteCredit = roleLower === 'superadmin';
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [salesSearch, setSalesSearch] = useState('');
  const [repaymentsSearch, setRepaymentsSearch] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [section, setSection] = useState(initialSection);
  const [selectedSaleIds, setSelectedSaleIds] = useState([]);
  const [selectedRepaymentIds, setSelectedRepaymentIds] = useState([]);
  const [bulkActionSales, setBulkActionSales] = useState('');
  const [bulkActionRepayments, setBulkActionRepayments] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deletedSaleKeys, setDeletedSaleKeys] = useState(() => new Set());
  const [sourceFilter, setSourceFilter] = useState('all');
  const [creditPackageFilter, setCreditPackageFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState('');
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultFromIso = new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [periodMode, setPeriodMode] = useState('range');
  const [dateFrom, setDateFrom] = useState(defaultFromIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportCustomerId, setExportCustomerId] = useState('');
  const [exportCustomerSearch, setExportCustomerSearch] = useState('');
  const [exportTypeFilter, setExportTypeFilter] = useState('all');
  const [exportSelectedSaleIds, setExportSelectedSaleIds] = useState([]);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [customerRows, saleRows, repaymentRows] = await Promise.all([
        listCreditCustomers(),
        listCreditSales(),
        listRepayments()
      ]);
      setCustomers(Array.isArray(customerRows) ? customerRows : []);
      setSales(Array.isArray(saleRows) ? saleRows : []);
      setRepayments(Array.isArray(repaymentRows) ? repaymentRows : []);
    } catch (e) {
      toast.show(String(e?.message || 'Failed to load credit data'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setSummary(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const data = await getCustomerCreditSummary(selectedCustomerId);
        if (alive) setSummary(data);
      } catch (e) {
        if (alive) toast.show(String(e?.message || 'Failed to load customer summary'), { type: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [selectedCustomerId, toast]);

  const customerMap = useMemo(() => {
    const map = new Map();
    customers.forEach(row => map.set(String(row._id || row.id), row));
    return map;
  }, [customers]);
  const branchNameById = useMemo(() => new Map((Array.isArray(branches) ? branches : []).map((row) => [String(row.id || ''), row.name || row.code || row.id || ''])), [branches]);
  const getCustomerDetails = useCallback((customerId) => {
    const row = customerMap.get(String(customerId || ''));
    return {
      name: row?.name || customerId || '—',
      businessName: row?.businessName || '—',
      phone: row?.phone || row?.businessPhone || '',
      customerCode: row?.customerCode || '',
      idCardNumber: row?.idCardNumber || ''
    };
  }, [customerMap]);
  const getCustomerSearchText = useCallback((customerId) => {
    const details = getCustomerDetails(customerId);
    return [
      details.name,
      details.businessName,
      details.phone,
      details.customerCode,
      details.idCardNumber,
      customerId
    ].join(' ').toLowerCase();
  }, [getCustomerDetails]);
  const selectedCustomer = useMemo(() => (
    customers.find((row) => String(row._id || row.id) === String(selectedCustomerId || '')) || null
  ), [customers, selectedCustomerId]);
  const customerMatches = useMemo(() => {
    const q = String(customerSearch || '').trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((row) => {
        const fields = [
          String(row.name || ''),
          String(row.businessName || ''),
          String(row.phone || ''),
          String(row.businessPhone || ''),
          String(row.customerCode || '')
        ].join(' ').toLowerCase();
        return fields.includes(q);
      })
      .slice(0, 10);
  }, [customerSearch, customers]);
  const goodClients = useMemo(() => customers.filter(row => Number(row.latePayments || 0) === 0 && Number(row.outstandingBalance || 0) <= 0), [customers]);
  const riskyClients = useMemo(() => customers.filter(row => Number(row.latePayments || 0) > 0 || Number(row.overdueDays || 0) > 0), [customers]);
  const visibleCustomers = useMemo(() => {
    if (clientFilter === 'good') return goodClients;
    if (clientFilter === 'risky') return riskyClients;
    return customers;
  }, [clientFilter, customers, goodClients, riskyClients]);
  const fallbackCreditSales = useMemo(() => {
    return saleRows
      .filter(row => Array.isArray(row.payment_methods) && row.payment_methods.some(p => String(p.type || '').toLowerCase() === 'easybuy'))
      .map(row => ({
        _id: row.creditSaleId || row.id || row._id,
        saleId: row.id || row._id,
        customer_id: row.customerId || '',
        branchId: row.branchId || '',
        posType: row.posType || 'retail',
        items: row.items || [],
        total_amount: Number(row.total || 0),
        amount_paid: Number(row.creditAmountPaidNow || row.creditSale?.amount_paid || 0),
        balance: Number(row.creditBalance || row.creditSale?.balance || Math.max(0, Number(row.total || 0) - Number(row.creditAmountPaidNow || 0))),
        accumulated_penalty: Number(row.creditSale?.accumulated_penalty || 0),
        creditPackageId: row.creditPackageId || row.creditSale?.creditPackageId || '',
        creditPackageName: row.creditPackageName || row.creditSale?.creditPackageName || '',
        due_date: row.creditDueDate || row.creditSale?.due_date || row.creditSale?.dueDate || null,
        createdAt: row.created_at || row.createdAt || row.creditSale?.createdAt || null,
        overdue_days: Number(row.creditSale?.overdue_days || 0),
        status: row.creditSale?.status || 'active'
      }));
  }, [saleRows]);
  const inRange = useCallback((value) => {
    if (periodMode === 'all_time') return true;
    const ts = new Date(value).getTime();
    if (Number.isNaN(ts)) return false;
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : -Infinity;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : Infinity;
    return ts >= fromTs && ts <= toTs;
  }, [dateFrom, dateTo, periodMode]);
  const mergedSales = useMemo(() => {
    const byId = new Map();
    [...fallbackCreditSales, ...sales].forEach(row => {
      const primary = String(row.saleId || row._id || '');
      const alt = String(row._id || '');
      if ((primary && deletedSaleKeys.has(primary)) || (alt && deletedSaleKeys.has(alt))) return;
      const key = String(row.saleId || row._id || '');
      if (!key) return;
      byId.set(key, normalizeCreditSaleRow(row));
    });
    return Array.from(byId.values());
  }, [deletedSaleKeys, fallbackCreditSales, sales]);
  const filteredSales = useMemo(() => (
    (sourceFilter === 'all' ? mergedSales : mergedSales.filter((row) => String(row.posType || 'retail') === sourceFilter))
      .filter((row) => creditPackageFilter === 'all' ? true : getCreditPackageLabel(row) === creditPackageFilter)
  ), [mergedSales, sourceFilter, creditPackageFilter]);
  const branchScopedSales = useMemo(() => filteredSales.filter((row) => {
    if (branchFilter && String(row.branchId || '') !== String(branchFilter)) return false;
    return true;
  }), [filteredSales, branchFilter]);
  const branchFilteredSales = useMemo(() => filteredSales.filter((row) => {
    if (branchFilter && String(row.branchId || '') !== String(branchFilter)) return false;
    const dateValue = row.createdAt || row.created_at || row.saleDate || row.due_date;
    if (!dateValue) return true;
    return inRange(dateValue);
  }), [filteredSales, branchFilter, inRange]);
  const salesById = useMemo(() => new Map(mergedSales.map((row) => [String(row._id || row.saleId || ''), row])), [mergedSales]);
  const shownActiveSales = useMemo(() => branchFilteredSales.filter(row => row.status !== 'completed'), [branchFilteredSales]);
  const overdueSales = useMemo(() => branchFilteredSales.filter(row => row.status === 'overdue'), [branchFilteredSales]);
  const currentActiveSales = useMemo(() => branchFilteredSales.filter((row) => row.status !== 'completed'), [branchFilteredSales]);
  const currentOverdueSales = useMemo(() => branchFilteredSales.filter((row) => row.status === 'overdue'), [branchFilteredSales]);
  const currentPendingAmountRows = useMemo(() => branchFilteredSales.filter((row) => row.status !== 'completed' && row.status !== 'overdue'), [branchFilteredSales]);
  const defaulterRows = useMemo(() => {
    return overdueSales
      .slice()
      .sort((a, b) => {
        const overdueDiff = Number(b.overdue_days || 0) - Number(a.overdue_days || 0);
        if (overdueDiff !== 0) return overdueDiff;
        return Number(b.balance || 0) - Number(a.balance || 0);
      });
  }, [overdueSales]);
  const dueTodaySales = useMemo(() => mergedSales.filter(row => {
    if (!row?.due_date || row.status === 'completed') return false;
    const due = new Date(row.due_date);
    const now = new Date();
    return due.toDateString() === now.toDateString();
  }).filter((row) => {
    if (sourceFilter !== 'all' && String(row.posType || 'retail') !== sourceFilter) return false;
    if (branchFilter && String(row.branchId || '') !== String(branchFilter)) return false;
    return inRange(row.due_date);
  }), [mergedSales, sourceFilter, branchFilter, inRange]);
  const shownRepayments = useMemo(() => {
    return repayments.filter((row) => {
      const sale = salesById.get(String(row.creditSaleId || ''));
      if (sourceFilter !== 'all' && String(sale?.posType || 'retail') !== sourceFilter) return false;
      if (creditPackageFilter !== 'all' && getCreditPackageLabel(sale) !== creditPackageFilter) return false;
      if (branchFilter && String(sale?.branchId || '') !== String(branchFilter)) return false;
      const dateValue = row.createdAt || row.created_at || row.paymentDate || row.date;
      if (dateValue && !inRange(dateValue)) return false;
      return true;
    });
  }, [repayments, salesById, sourceFilter, creditPackageFilter, branchFilter, inRange]);
  const currentPendingRepayments = useMemo(() => {
    return repayments.filter((row) => {
      const sale = salesById.get(String(row.creditSaleId || ''));
      if (sourceFilter !== 'all' && String(sale?.posType || 'retail') !== sourceFilter) return false;
      if (creditPackageFilter !== 'all' && getCreditPackageLabel(sale) !== creditPackageFilter) return false;
      if (branchFilter && String(sale?.branchId || '') !== String(branchFilter)) return false;
      return row.status !== 'approved' && row.status !== 'rejected';
    });
  }, [repayments, salesById, sourceFilter, creditPackageFilter, branchFilter]);
  const creditPackageOptions = useMemo(() => (
    Array.from(new Set(mergedSales.map((row) => getCreditPackageLabel(row)).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [mergedSales]);
  const filteredActiveSales = useMemo(() => {
    const q = String(salesSearch || '').trim().toLowerCase();
    const baseRows = sortByLatest(shownActiveSales, (row) => row?.createdAt || row?.created_at || row?.saleDate || row?.due_date);
    if (!q) return baseRows;
    return baseRows.filter((row) => {
      const itemText = Array.isArray(row.items)
        ? row.items.map((item) => `${item?.name || ''} ${item?.sku || ''}`).join(' ')
        : '';
      const sourceText = String(row.posType || 'retail') === 'wholesale' ? 'distribution credit sale wholesale' : 'retail credit';
      return [
        getCustomerSearchText(row.customer_id),
        itemText,
        sourceText,
        row.status,
        row.due_date
      ].join(' ').toLowerCase().includes(q);
    });
  }, [getCustomerSearchText, salesSearch, shownActiveSales]);
  const filteredRepayments = useMemo(() => {
    const q = String(repaymentsSearch || '').trim().toLowerCase();
    const baseRows = sortByLatest(shownRepayments, (row) => row?.createdAt || row?.created_at || row?.paymentDate || row?.date);
    if (!q) return baseRows;
    return baseRows.filter((row) => [
      getCustomerSearchText(row.customerId),
      row.status,
      row.remark,
      row.createdAt
    ].join(' ').toLowerCase().includes(q));
  }, [getCustomerSearchText, repaymentsSearch, shownRepayments]);
  const creditSummary = useMemo(() => {
    const easybuyRows = currentActiveSales.filter((row) => String(row.posType || 'retail') === 'retail');
    const wholesaleRows = currentActiveSales.filter((row) => String(row.posType || 'retail') === 'wholesale');
    return {
      activeCount: currentActiveSales.length,
      overdueCount: currentOverdueSales.length,
      dueTodayCount: dueTodaySales.length,
      easybuyOutstanding: easybuyRows.reduce((sum, row) => sum + (Number(row.balance || 0) + Number(row.accumulated_penalty || 0)), 0),
      wholesaleOutstanding: wholesaleRows.reduce((sum, row) => sum + (Number(row.balance || 0) + Number(row.accumulated_penalty || 0)), 0),
      pendingAmount: currentPendingAmountRows.reduce((sum, row) => sum + Math.max(0, Number(row.balance || 0)), 0),
      pendingAmountCount: currentPendingAmountRows.length,
      pendingRepaymentAmount: currentPendingRepayments.reduce((sum, row) => sum + (Number(row.amount || row.repayment_amount || 0) || 0), 0),
      pendingRepaymentCount: currentPendingRepayments.length
    };
  }, [currentActiveSales, currentOverdueSales, currentPendingAmountRows, currentPendingRepayments, dueTodaySales.length]);

  useEffect(() => {
    // #region debug-point A:credit-summary-vs-table
    fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'credit-active-sales-list',
        runId: 'pre-fix',
        hypothesisId: 'A',
        location: 'CreditControlPage.js:summary-vs-table',
        msg: '[DEBUG] Credit summary and active sales table counts recalculated',
        data: {
          user: String(auth.user?.name || auth.user?.username || ''),
          role: String(auth.role || ''),
          branchFilter: String(branchFilter || ''),
          sourceFilter: String(sourceFilter || ''),
          creditPackageFilter: String(creditPackageFilter || ''),
          periodMode: String(periodMode || ''),
          dateFrom: String(dateFrom || ''),
          dateTo: String(dateTo || ''),
          mergedSalesCount: mergedSales.length,
          filteredSalesCount: filteredSales.length,
          branchScopedSalesCount: branchScopedSales.length,
          branchFilteredSalesCount: branchFilteredSales.length,
          currentActiveSalesCount: currentActiveSales.length,
          shownActiveSalesCount: shownActiveSales.length,
          filteredActiveSalesCount: filteredActiveSales.length,
          summaryActiveCount: creditSummary.activeCount,
          sampleBranchScoped: currentActiveSales.slice(0, 10).map((row) => ({
            id: String(row?._id || row?.saleId || ''),
            branchId: String(row?.branchId || ''),
            status: String(row?.status || ''),
            posType: String(row?.posType || ''),
            createdAt: row?.createdAt || row?.created_at || row?.saleDate || null,
            dueDate: row?.due_date || null,
            balance: Number(row?.balance || 0)
          })),
          sampleShown: shownActiveSales.slice(0, 10).map((row) => ({
            id: String(row?._id || row?.saleId || ''),
            branchId: String(row?.branchId || ''),
            status: String(row?.status || ''),
            posType: String(row?.posType || ''),
            createdAt: row?.createdAt || row?.created_at || row?.saleDate || null,
            dueDate: row?.due_date || null,
            balance: Number(row?.balance || 0)
          }))
        },
        ts: Date.now()
      })
    }).catch(() => {});
    // #endregion
  }, [auth.role, auth.user?.name, auth.user?.username, branchFilter, branchFilteredSales, branchScopedSales, creditPackageFilter, creditSummary.activeCount, currentActiveSales, dateFrom, dateTo, filteredActiveSales, filteredSales, mergedSales, periodMode, shownActiveSales, sourceFilter]);

  const exportCustomer = useMemo(() => (
    customers.find((row) => String(row._id || row.id || '') === String(exportCustomerId || '')) || null
  ), [customers, exportCustomerId]);
  const exportCustomerMatches = useMemo(() => {
    const q = String(exportCustomerSearch || '').trim().toLowerCase();
    if (!q) return [];
    return customers
      .filter((row) => {
        const fields = [
          String(row.name || ''),
          String(row.businessName || ''),
          String(row.phone || ''),
          String(row.businessPhone || ''),
          String(row.customerCode || ''),
          String(row.idCardNumber || '')
        ].join(' ').toLowerCase();
        return fields.includes(q);
      })
      .slice(0, 12);
  }, [customers, exportCustomerSearch]);
  const exportSales = useMemo(() => {
    if (!exportCustomer) return [];
    const customerId = String(exportCustomer._id || exportCustomer.id || '');
    const customerCode = String(exportCustomer.customerCode || '');
    return sortByLatest(
      saleRows.filter((row) => {
        const matchesCustomer = String(row.customerId || '') === customerId || (customerCode && String(row.customerCode || '') === customerCode);
        if (!matchesCustomer) return false;
        if (exportTypeFilter === 'credit_only') return isCreditSaleRecord(row);
        if (exportTypeFilter === 'paid_only') return !isCreditSaleRecord(row);
        return true;
      }).map((sale) => {
        const repaymentHistory = Array.isArray(sale.repaymentHistory) ? sale.repaymentHistory : [];
        const repaymentById = new Map(repaymentHistory.map((entry) => [String(entry?.repaymentId || ''), entry]));
        const paymentTimeline = Array.isArray(sale.paymentTimeline) ? sale.paymentTimeline : [];
        const paymentRecords = sortByLatest(paymentTimeline.map((event, index) => {
          const source = String(event?.source || 'sale').trim().toLowerCase();
          const repaymentEntry = repaymentById.get(String(event?.repaymentId || '')) || null;
          return {
            id: String(event?.repaymentId || `${sale.id || sale._id}-payment-record-${index}`),
            label: source === 'credit_upfront'
              ? 'Initial Credit Payment'
              : source === 'credit_repayment'
                ? 'Credit Repayment'
                : 'Sale Payment',
            amount: Number(event?.amount || 0) || 0,
            paidAt: event?.paidAt || sale.created_at || sale.createdAt || null,
            paymentMethod: String(repaymentEntry?.paymentMethod || event?.paymentMethod || '').trim(),
            status: repaymentEntry ? String(repaymentEntry?.status || '').trim().toLowerCase() : 'approved',
            initiatedAt: repaymentEntry?.initiatedAt || null,
            initiatedByName: repaymentEntry?.initiatedByName || '',
            initiatedByRole: repaymentEntry?.initiatedByRole || '',
            approvedAt: repaymentEntry?.approvedAt || event?.paidAt || null,
            approvedByName: repaymentEntry?.approvedByName || '',
            approvedByRole: repaymentEntry?.approvedByRole || '',
            remark: String(repaymentEntry?.remark || event?.note || '').trim()
          };
        }), (entry) => entry?.paidAt || entry?.approvedAt || entry?.initiatedAt);
        return {
          ...sale,
          exportSaleId: String(sale.id || sale._id || ''),
          paymentTypeLabel: isCreditSaleRecord(sale) ? getCreditPackageLabel(sale) : 'Paid Sale',
          paymentRecords
        };
      }),
      (sale) => sale?.created_at || sale?.createdAt || sale?.date
    );
  }, [exportCustomer, exportTypeFilter, saleRows]);

  useEffect(() => {
    setExportSelectedSaleIds(exportSales.map((row) => String(row.exportSaleId || '')).filter(Boolean));
  }, [exportSales]);

  function openExportModal() {
    setExportCustomerId(selectedCustomerId || '');
    setExportCustomerSearch(String(selectedCustomer?.name || ''));
    setExportTypeFilter('all');
    setExportOpen(true);
  }

  function runRepaymentExport(format = 'pdf') {
    if (!exportCustomer) {
      toast.show('Select a customer to export', { type: 'error' });
      return;
    }
    const selectedRows = exportSales.filter((row) => exportSelectedSaleIds.includes(String(row.exportSaleId || '')));
    if (selectedRows.length === 0) {
      toast.show('Select at least one purchase history row to export', { type: 'error' });
      return;
    }
    const generatedAt = formatDateTime(new Date());
    const safeCustomerName = String(exportCustomer.name || 'customer').trim().replace(/[^\w.-]+/g, '_');
    const transactionTypeLabel = exportTypeFilter === 'credit_only'
      ? 'Credit Sales Only'
      : exportTypeFilter === 'paid_only'
        ? 'Paid Sales Only'
        : 'All Transactions';
    if (format === 'csv') {
      const csvRows = selectedRows.flatMap((sale) => {
        const base = {
          customerName: exportCustomer.name || '—',
          businessName: exportCustomer.businessName || '—',
          saleDate: formatDateTime(sale.created_at || sale.createdAt),
          invoice: sale.invoiceSerial || sale.exportSaleId || '—',
          transactionType: sale.paymentTypeLabel || '—',
          branch: branchNameById.get(String(sale.branchId || '')) || sale.branchId || '—',
          items: Array.isArray(sale.items) ? sale.items.map((item) => `${item?.name || 'Item'} x ${Number(item?.qty || 0)}`).join(', ') : '—',
          saleTotal: formatCurrency(Number(sale.total || 0), settings)
        };
        if (!Array.isArray(sale.paymentRecords) || sale.paymentRecords.length === 0) {
          return [{ ...base, paymentLabel: '—', paymentAmount: '—', paymentDate: '—', paymentStatus: '—', paymentMethod: '—', initiated: '—', approved: '—', remark: '—' }];
        }
        return sale.paymentRecords.map((entry) => ({
          ...base,
          paymentLabel: entry.label || 'Payment',
          paymentAmount: formatCurrency(Number(entry.amount || 0), settings),
          paymentDate: formatDateTime(entry.paidAt),
          paymentStatus: String(entry.status || 'approved').replace(/_/g, ' '),
          paymentMethod: entry.paymentMethod ? String(entry.paymentMethod || '').toUpperCase() : '—',
          initiated: entry.initiatedAt ? `${formatDateTime(entry.initiatedAt)}${entry.initiatedByName ? ` by ${entry.initiatedByName}${entry.initiatedByRole ? ` (${entry.initiatedByRole})` : ''}` : ''}` : '—',
          approved: (entry.approvedAt || entry.approvedByName) ? `${formatDateTime(entry.approvedAt)}${entry.approvedByName ? ` by ${entry.approvedByName}${entry.approvedByRole ? ` (${entry.approvedByRole})` : ''}` : ''}` : '—',
          remark: entry.remark || '—'
        }));
      });
      exportCsv(`purchase-history-${safeCustomerName}.csv`, [
        { key: 'customerName', label: 'Customer' },
        { key: 'businessName', label: 'Business Name' },
        { key: 'saleDate', label: 'Sale Date' },
        { key: 'invoice', label: 'Invoice' },
        { key: 'transactionType', label: 'Transaction Type' },
        { key: 'branch', label: 'Branch' },
        { key: 'items', label: 'Items' },
        { key: 'saleTotal', label: 'Sale Total' },
        { key: 'paymentLabel', label: 'Payment Record' },
        { key: 'paymentAmount', label: 'Payment Amount' },
        { key: 'paymentDate', label: 'Paid At' },
        { key: 'paymentStatus', label: 'Payment Status' },
        { key: 'paymentMethod', label: 'Method' },
        { key: 'initiated', label: 'Initiated' },
        { key: 'approved', label: 'Approved' },
        { key: 'remark', label: 'Remark' }
      ], csvRows);
      setExportOpen(false);
      return;
    }
    const pdfRows = selectedRows.flatMap((sale) => {
      const paymentRecords = Array.isArray(sale.paymentRecords) ? sale.paymentRecords : [];
      const totalPaid = paymentRecords.reduce((sum, entry) => sum + Math.max(0, Number(entry?.amount || 0)), 0);
      const saleDetails = [
        `Date: ${formatDateTime(sale.created_at || sale.createdAt)}`,
        `Invoice: ${sale.invoiceSerial || sale.exportSaleId || '—'}`,
        `Type: ${sale.paymentTypeLabel || '—'}`,
        `Branch: ${branchNameById.get(String(sale.branchId || '')) || sale.branchId || '—'}`
      ].join('\n');
      const itemSummary = Array.isArray(sale.items) ? sale.items.map((item) => `${item?.name || 'Item'} x ${Number(item?.qty || 0)}`).join(', ') : '—';
      const rows = [{
        rowType: 'sale',
        saleDetails,
        items: itemSummary || '—',
        saleTotal: formatCurrency(Number(sale.total || 0), settings),
        totalPaid: formatCurrency(totalPaid, settings),
        paymentDetails: paymentRecords.length > 0 ? `${paymentRecords.length} payment record(s)` : 'No payment records'
      }];
      paymentRecords.forEach((entry, index) => {
        rows.push({
          rowType: 'payment',
          saleDetails: index === 0 ? 'Payment Records' : '',
          items: '',
          saleTotal: '',
          totalPaid: '',
          paymentDetails: formatPaymentRecordSummary(entry, settings)
        });
      });
      return rows;
    });
    const exportBranchId = branchFilter || currentBranchId || '';
    const exportBranchName = branchNameById.get(String(exportBranchId || '')) || (branchFilter ? branchFilter : 'All Branches');
    exportTablePdf(`Customer Purchase History - ${exportCustomer.name || 'Customer'}`, [
      { key: 'saleDetails', label: 'Sale Details' },
      { key: 'items', label: 'Items' },
      { key: 'saleTotal', label: 'Sale Total' },
      { key: 'totalPaid', label: 'Total Paid' },
      { key: 'paymentDetails', label: 'Payment Records' }
    ], pdfRows, {
      letterhead: {
        logoUrl: settings?.clientLogoUrl || '/clientlogo512.png',
        companyName: settings?.receiptBrandName || settings?.clientAppName || settings?.appName || 'ptSales POS',
        branch: exportBranchName,
        phone: settings?.businessPhone || '',
        address: settings?.invoiceCompanyAddress || ''
      },
      meta: [
        { label: 'Exported At', value: generatedAt },
        { label: 'Generated By', value: auth.user?.name || 'unknown' },
        { label: 'Customer', value: exportCustomer.name || '—' },
        { label: 'Business Name', value: exportCustomer.businessName || '—' },
        { label: 'Transaction Type', value: transactionTypeLabel },
        { label: 'Selected Sales', value: String(selectedRows.length) }
      ],
      orientation: 'landscape',
      getRowClass: (row) => row?.rowType === 'sale' ? 'row-sale' : 'row-payment'
    });
    setExportOpen(false);
  }

  async function startRepayment(row) {
    const outstandingAmount = Math.max(0, Number(row?.balance || 0) + Number(row?.accumulated_penalty || 0));
    const pendingAmount = repayments
      .filter((item) => String(item?.creditSaleId || '') === String(row?._id || ''))
      .filter((item) => ['pending_director', 'pending_manager'].includes(String(item?.status || '').toLowerCase()))
      .reduce((sum, item) => sum + Math.max(0, Number(item?.amount || 0)), 0);
    const availableAmount = Math.max(0, outstandingAmount - pendingAmount);
    if (availableAmount <= 0) {
      toast.show('This balance is already covered by pending repayments', { type: 'error' });
      return;
    }
    const amount = await promptDialog('Repayment amount');
    if (!amount || Number(amount) <= 0) {
      toast.show('Enter a valid repayment amount', { type: 'error' });
      return;
    }
    if (Number(amount) > availableAmount) {
      toast.show(`Repayment cannot exceed the remaining payable amount of ${formatCurrency(availableAmount, settings)}`, { type: 'error' });
      return;
    }
    const remark = await promptDialog('Repayment remark');
    const paymentMethodRaw = await promptDialog('Payment method: cash, card, mobile, or wallet', 'cash');
    const paymentMethod = ['cash', 'card', 'mobile', 'wallet'].includes(String(paymentMethodRaw || '').trim().toLowerCase())
      ? String(paymentMethodRaw || '').trim().toLowerCase()
      : 'cash';
    setWorkingId(row._id || '');
    try {
      const payload = { creditSaleId: row._id, amount: Number(amount), paymentMethod, remark: String(remark || '') };
      if (!navigator.onLine && offlineBackupAllowed) {
        await enqueueHttp({ collection: 'creditrepayments', label: 'Credit repayment', path: '/api/credits/repayments', method: 'POST', body: payload });
        toast.show('Repayment saved offline. It will sync when online.', { type: 'success' });
      } else {
        await createRepayment(payload);
        toast.show('Repayment submitted for approval', { type: 'success' });
      }
      await loadAll();
      if (selectedCustomerId) {
        const next = await getCustomerCreditSummary(selectedCustomerId);
        setSummary(next);
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to create repayment'), { type: 'error' });
    } finally {
      setWorkingId('');
    }
  }

  async function deleteCreditSaleRow(row) {
    if (!canDeleteCredit) return;
    const id = String(row?._id || row?.saleId || '');
    if (!id) return;
    const ok = await confirmDialog('Delete this credit sale record? It will go to Super Bin.');
    if (!ok) return;
    setDeletingId(id);
    try {
      await removeCreditSale(id);
      setSales(prev => prev.filter(item => String(item._id || '') !== id && String(item.saleId || '') !== id));
      setDeletedSaleKeys(prev => {
        const next = new Set(prev);
        next.add(String(id));
        next.add(String(row?._id || ''));
        next.add(String(row?.saleId || ''));
        return next;
      });
      setSummary(null);
      toast.show('Credit sale moved to Super Bin', { type: 'success' });
      void loadAll();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete credit sale'), { type: 'error' });
    } finally {
      setDeletingId('');
    }
  }

  async function deleteRepaymentRow(row) {
    if (!canDeleteCredit) return;
    const id = String(row?._id || '');
    if (!id) return;
    const ok = await confirmDialog('Delete this repayment record? It will go to Super Bin.');
    if (!ok) return;
    setDeletingId(id);
    try {
      await removeRepayment(id);
      setRepayments(prev => prev.filter(item => String(item._id || '') !== id));
      toast.show('Repayment moved to Super Bin', { type: 'success' });
      void loadAll();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete repayment'), { type: 'error' });
    } finally {
      setDeletingId('');
    }
  }

  async function deleteSelectedSales() {
    const ids = selectedSaleIds.filter(Boolean);
    if (ids.length === 0) return;
    const ok = await confirmDialog(`Delete ${ids.length} selected credit sale record(s)? They will go to Super Bin.`);
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const result = await removeManyCreditSales(ids);
      const deletedCount = Number(result?.count || 0);
      if (deletedCount <= 0) {
        toast.show('No matching credit sale records were moved', { type: 'error' });
        return;
      }
      setSales(prev => prev.filter(item => !ids.includes(String(item._id || '')) && !ids.includes(String(item.saleId || ''))));
      setDeletedSaleKeys(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.add(String(id)));
        return next;
      });
      setSelectedSaleIds([]);
      setBulkActionSales('');
      toast.show(`Moved ${deletedCount} credit sale record(s) to Super Bin`, { type: 'success' });
      void loadAll();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete selected credit sales'), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }

  async function deleteSelectedRepayments() {
    const ids = selectedRepaymentIds.filter(Boolean);
    if (ids.length === 0) return;
    const ok = await confirmDialog(`Delete ${ids.length} selected repayment record(s)? They will go to Super Bin.`);
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const result = await removeManyRepayments(ids);
      const deletedCount = Number(result?.count || 0);
      if (deletedCount <= 0) {
        toast.show('No matching repayment records were moved', { type: 'error' });
        return;
      }
      setRepayments(prev => prev.filter(item => !ids.includes(String(item._id || ''))));
      setSelectedRepaymentIds([]);
      setBulkActionRepayments('');
      toast.show(`Moved ${deletedCount} repayment record(s) to Super Bin`, { type: 'success' });
      void loadAll();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete selected repayments'), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>{title}</h1>
          <div style={{ color: '#64748b', fontSize: 13 }}>{description}</div>
        </div>
        <button className="btn" onClick={loadAll} disabled={loading}>{loading ? <LoadingDots label="Loading credit control" /> : 'Refresh'}</button>
      </div>
      {loading && (
        <div className="card" style={{ padding: 12 }}>
          <div className="loading-bar" style={{ width: '42%', marginBottom: 10 }} />
          <div className="loading-bar" style={{ width: '78%', marginBottom: 10 }} />
          <div className="loading-bar" style={{ width: '60%' }} />
        </div>
      )}

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Period</div>
            <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
              <option value="range">Custom Range</option>
              <option value="all_time">All Time</option>
            </select>
          </label>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>From</div>
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>To</div>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Branch</div>
            <BranchSelect value={branchFilter} onChange={setBranchFilter} includeAll allLabel="All Branches" />
          </label>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Credit Source</div>
            <select className="select" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
              <option value="all">All Sources</option>
              <option value="retail">Retail Credit</option>
              <option value="wholesale">Distribution Credit Sale</option>
            </select>
          </label>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Credit Package</div>
            <select className="select" value={creditPackageFilter} onChange={e => setCreditPackageFilter(e.target.value)}>
              <option value="all">All Packages</option>
              {creditPackageOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="summary-grid">
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Active Credit Sales</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{creditSummary.activeCount}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Overdue Accounts</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: creditSummary.overdueCount > 0 ? '#b91c1c' : undefined }}>{creditSummary.overdueCount}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Retail Credit Balance</div>
          <div className="price-accent" style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(creditSummary.easybuyOutstanding, settings)}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Distribution Credit Balance</div>
          <div className="price-accent" style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(creditSummary.wholesaleOutstanding, settings)}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Pending Amount</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{creditSummary.pendingAmountCount}</div>
          <div className="price-accent" style={{ fontSize: 12 }}>{formatCurrency(creditSummary.pendingAmount, settings)}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Due Today</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: creditSummary.dueTodayCount > 0 ? '#b45309' : undefined }}>{creditSummary.dueTodayCount}</div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Good {goodClients.length} • Flagged {riskyClients.length}</div>
        </div>
      </div>
      </div>

      {clientFilter !== 'good' && section !== 'repayments' && section !== 'sales' && <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>Defaulters</h2>
            <div style={{ color: '#64748b', fontSize: 12 }}>
              Overdue credit sales for the current filters
            </div>
          </div>
          <div style={{ color: '#b91c1c', fontWeight: 700 }}>
            {defaulterRows.length} overdue account(s)
          </div>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Customer</th>
                <th align="left">Business Name</th>
                <th align="left">Type</th>
                <th align="left">Balance</th>
                <th align="left">Penalty</th>
                <th align="left">Sale Date</th>
                <th align="left">Due Date</th>
                <th align="left">Overdue Days</th>
              </tr>
            </thead>
            <tbody>
              {defaulterRows.map((row) => (
                <tr key={`defaulter-${String(row._id || row.saleId || row.clientId || '')}`}>
                  <td>{getCustomerDetails(row.customer_id).name}</td>
                  <td>{getCustomerDetails(row.customer_id).businessName}</td>
                  <td>{getCreditPackageLabel(row)}</td>
                  <td><span className="price-accent">{formatCurrency(Number(row.balance || 0), settings)}</span></td>
                  <td><span className="price-accent">{formatCurrency(Number(row.accumulated_penalty || 0), settings)}</span></td>
                <td>{formatDate(row.createdAt || row.created_at || row.saleDate)}</td>
                <td>{formatDate(row.due_date)}</td>
                  <td style={{ color: '#b91c1c', fontWeight: 700 }}>{Number(row.overdue_days || 0)}</td>
                </tr>
              ))}
              {!loading && defaulterRows.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ padding: 12, color: '#64748b' }}>No defaulters for the current filters</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className={section === 'clients' ? 'btn btn-primary' : 'btn'} onClick={() => setSection('clients')}>Client Ranking</button>
        <button className={section === 'sales' ? 'btn btn-primary' : 'btn'} onClick={() => setSection('sales')}>Active Sales</button>
        <button className={section === 'repayments' ? 'btn btn-primary' : 'btn'} onClick={() => setSection('repayments')}>Repayments</button>
      </div>

      {section === 'clients' && <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Customer Credit Ranking</h2>
          <div style={{ position: 'relative', minWidth: 320, maxWidth: 420, width: '100%' }}>
            <input
              className="input"
              placeholder="Search customer, business name, phone or code"
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
            />
            {customerMatches.length > 0 && (
              <div style={{ position: 'absolute', top: 44, left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', zIndex: 20, maxHeight: 320, overflowY: 'auto' }}>
                {customerMatches.map((row) => (
                  <button
                    key={row._id || row.id}
                    className="btn"
                    onClick={() => {
                      setSelectedCustomerId(String(row._id || row.id || ''));
                      setCustomerSearch(String(row.name || ''));
                    }}
                    style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0 }}
                  >
                    <span style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 700 }}>{row.name}</div>
                      <div style={{ color: '#64748b', fontSize: 12 }}>
                        {row.businessName || '—'} {(row.phone || row.businessPhone) ? `• ${row.phone || row.businessPhone}` : ''} {(row.customerCode || '') && `• ${row.customerCode}`}
                      </div>
                    </span>
                    <span>Select</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {selectedCustomer && (
          <div style={{ marginBottom: 12, color: '#64748b', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div>
              Selected: <strong style={{ color: '#0f172a' }}>{selectedCustomer.name}</strong>
              {selectedCustomer.businessName ? ` • ${selectedCustomer.businessName}` : ''}
              {(selectedCustomer.phone || selectedCustomer.businessPhone) ? ` • ${selectedCustomer.phone || selectedCustomer.businessPhone}` : ''}
            </div>
            <button className="btn" onClick={() => { setSelectedCustomerId(''); setCustomerSearch(''); }}>Clear</button>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th align="left">Customer</th>
              <th align="left">Business Name</th>
              <th align="left">Behaviour</th>
              <th align="left">Rank</th>
              <th align="left">Score</th>
              <th align="left">Outstanding</th>
              <th align="left">Overdue Days</th>
            </tr>
          </thead>
          <tbody>
            {visibleCustomers.map(row => (
              <tr key={row._id || row.id}>
                <td>{row.name}</td>
                <td>{row.businessName || '—'}</td>
                <td>
                  <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, background: Number(row.latePayments || 0) > 0 || Number(row.overdueDays || 0) > 0 ? '#fee2e2' : '#dcfce7', color: Number(row.latePayments || 0) > 0 || Number(row.overdueDays || 0) > 0 ? '#b91c1c' : '#166534', fontWeight: 700, fontSize: 12 }}>
                    {Number(row.latePayments || 0) > 0 || Number(row.overdueDays || 0) > 0 ? 'Bad / Risky' : 'Good Client'}
                  </span>
                </td>
                <td>{row.creditRank || 'Bronze'}</td>
                <td>{Number(row.creditScore || 0)}</td>
                <td>{formatCurrency(Number(row.outstandingBalance || 0), settings)}</td>
                <td>{Number(row.overdueDays || 0)}</td>
              </tr>
            ))}
            {!loading && visibleCustomers.length === 0 && <tr><td colSpan="7" style={{ padding: 12, color: '#64748b' }}>No customer credit data</td></tr>}
          </tbody>
        </table>
        </div>
      </div>}

      {section === 'clients' && summary && (
        <div className="card">
          <h2 className="section-title">Selected Customer Summary</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Credit Purchases</div><strong className="price-accent">{formatCurrency(Number(summary.summary?.totalCreditPurchases || 0), settings)}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Total Paid</div><strong className="price-accent">{formatCurrency(Number(summary.summary?.totalCreditPaid || 0), settings)}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Outstanding</div><strong className="price-accent">{formatCurrency(Number(summary.summary?.outstandingBalance || 0), settings)}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Rank</div><strong>{summary.summary?.creditRank || 'Bronze'}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Overdue Days</div><strong>{Number(summary.summary?.overdueDays || 0)}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Behaviour</div><strong style={{ color: Number(summary.summary?.latePayments || 0) > 0 || Number(summary.summary?.overdueDays || 0) > 0 ? '#b91c1c' : '#15803d' }}>{Number(summary.summary?.latePayments || 0) > 0 || Number(summary.summary?.overdueDays || 0) > 0 ? 'Bad / Risky' : 'Good Client'}</strong></div>
          </div>
        </div>
      )}

      {section === 'sales' && <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Active Credit Sales</h2>
          <div style={{ display: 'grid', gap: 8, minWidth: 320, maxWidth: 420, width: '100%' }}>
            <input
              className="input"
              placeholder="Search customer, business name, phone or code"
              value={salesSearch}
              onChange={e => setSalesSearch(e.target.value)}
            />
            <div style={{ color: '#64748b', fontSize: 12 }}>Filtered by {branchFilter ? 'selected branch' : 'all branches'}, {sourceFilter === 'all' ? 'all sources' : sourceFilter === 'retail' ? 'Retail Credit' : 'Distribution Credit Sale'}, and {creditPackageFilter === 'all' ? 'all credit packages' : creditPackageFilter}</div>
          </div>
        </div>
        {canDeleteCredit && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="select" value={bulkActionSales} onChange={e => setBulkActionSales(e.target.value)} disabled={bulkDeleting}>
              <option value="">Actions</option>
              <option value="delete">Delete Selected</option>
            </select>
            <button className="btn" disabled={bulkDeleting || bulkActionSales !== 'delete' || selectedSaleIds.length === 0} onClick={() => void deleteSelectedSales()}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {bulkDeleting && <InlineSpinner />}
                {bulkDeleting ? 'Deleting…' : 'Apply'}
              </span>
            </button>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              {canDeleteCredit && (
                <th align="left">
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={filteredActiveSales.length > 0 && filteredActiveSales.every(row => selectedSaleIds.includes(String(row._id || row.saleId || '')))}
                    onChange={e => setSelectedSaleIds(e.target.checked ? filteredActiveSales.map(row => String(row._id || row.saleId || '')).filter(Boolean) : [])}
                  />
                </th>
              )}
              <th align="left">Customer</th>
              <th align="left">Business Name</th>
              <th align="left">Type</th>
              <th align="left">Items</th>
              <th align="left">Total</th>
              <th align="left">Paid</th>
              <th align="left">Balance</th>
              <th align="left">Penalty</th>
              <th align="left">Sale Date</th>
              <th align="left">Due Date</th>
              <th align="left">Status</th>
              <th align="left"></th>
              {canDeleteCredit && <th align="left"></th>}
            </tr>
          </thead>
          <tbody>
            {filteredActiveSales.map(row => (
              <tr key={row._id} style={(deletingId === String(row._id || row.saleId || '') || (bulkDeleting && selectedSaleIds.includes(String(row._id || row.saleId || '')))) ? { opacity: 0.55 } : undefined}>
                {canDeleteCredit && (
                  <td>
                    <input
                      type="checkbox"
                      disabled={bulkDeleting}
                      checked={selectedSaleIds.includes(String(row._id || row.saleId || ''))}
                      onChange={e => setSelectedSaleIds(prev => e.target.checked ? [...new Set([...prev, String(row._id || row.saleId || '')])] : prev.filter(id => id !== String(row._id || row.saleId || '')))}
                    />
                  </td>
                )}
                <td>{getCustomerDetails(row.customer_id).name}</td>
                <td>{getCustomerDetails(row.customer_id).businessName}</td>
                <td>{getCreditPackageLabel(row)}</td>
                <td>{Array.isArray(row.items) ? row.items.map(item => `${item.name} × ${item.qty}`).join(', ') : '—'}</td>
                <td><span className="price-accent">{formatCurrency(Number(row.total_amount || 0), settings)}</span></td>
                <td><span className="price-accent">{formatCurrency(Number(row.amount_paid || 0), settings)}</span></td>
                <td><span className="price-accent">{formatCurrency(Number(row.balance || 0), settings)}</span></td>
                <td><span className="price-accent">{formatCurrency(Number(row.accumulated_penalty || 0), settings)}</span></td>
                <td>{formatDate(row.createdAt || row.created_at || row.saleDate)}</td>
                <td>{formatDate(row.due_date)} {row.status === 'overdue' ? `• ${row.overdue_days || 0} day(s)` : ''}</td>
                <td>
                  <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 999, background: row.status === 'overdue' ? '#fee2e2' : row.status === 'active' ? '#fef3c7' : '#dcfce7', color: row.status === 'overdue' ? '#b91c1c' : row.status === 'active' ? '#92400e' : '#166534', fontWeight: 700, fontSize: 12 }}>
                    {row.status}
                  </span>
                </td>
                <td><button className="btn btn-primary" onClick={() => startRepayment(row)} disabled={workingId === row._id}>{workingId === row._id ? 'Working…' : 'Repayment'}</button></td>
                {canDeleteCredit && (
                  <td>
                    <button className="btn" onClick={() => void deleteCreditSaleRow(row)} disabled={deletingId === String(row._id || row.saleId || '')}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {deletingId === String(row._id || row.saleId || '') && <InlineSpinner />}
                        {deletingId === String(row._id || row.saleId || '') ? 'Deleting…' : 'Delete'}
                      </span>
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!loading && filteredActiveSales.length === 0 && <tr><td colSpan={canDeleteCredit ? 14 : 12} style={{ padding: 12, color: '#64748b' }}>No active credit sales</td></tr>}
          </tbody>
        </table>
        </div>
      </div>}

      {section === 'repayments' && <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>Repayment History</h2>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
              Latest repayment transactions appear first.
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8, minWidth: 320, maxWidth: 520, width: '100%' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={openExportModal}>Export Purchase History</button>
            </div>
            <input
              className="input"
              placeholder="Search customer, business name, phone or code"
              value={repaymentsSearch}
              onChange={e => setRepaymentsSearch(e.target.value)}
            />
            <div style={{ color: '#64748b', fontSize: 12 }}>Filtered by {branchFilter ? 'selected branch' : 'all branches'}, {sourceFilter === 'all' ? 'all sources' : sourceFilter === 'retail' ? 'Retail Credit' : 'Distribution Credit Sale'}, and {creditPackageFilter === 'all' ? 'all credit packages' : creditPackageFilter}</div>
          </div>
        </div>
        {canDeleteCredit && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="select" value={bulkActionRepayments} onChange={e => setBulkActionRepayments(e.target.value)} disabled={bulkDeleting}>
              <option value="">Actions</option>
              <option value="delete">Delete Selected</option>
            </select>
            <button className="btn" disabled={bulkDeleting || bulkActionRepayments !== 'delete' || selectedRepaymentIds.length === 0} onClick={() => void deleteSelectedRepayments()}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {bulkDeleting && <InlineSpinner />}
                {bulkDeleting ? 'Deleting…' : 'Apply'}
              </span>
            </button>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              {canDeleteCredit && (
                <th align="left">
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={filteredRepayments.length > 0 && filteredRepayments.every(row => selectedRepaymentIds.includes(String(row._id || '')))}
                    onChange={e => setSelectedRepaymentIds(e.target.checked ? filteredRepayments.map(row => String(row._id || '')).filter(Boolean) : [])}
                  />
                </th>
              )}
              <th align="left">Customer</th>
              <th align="left">Business Name</th>
              <th align="left">Amount</th>
              <th align="left">Status</th>
              <th align="left">Remark</th>
              <th align="left">Created</th>
              {canDeleteCredit && <th align="left"></th>}
            </tr>
          </thead>
          <tbody>
            {filteredRepayments.map(row => (
              <tr key={row._id} style={(deletingId === String(row._id || '') || (bulkDeleting && selectedRepaymentIds.includes(String(row._id || '')))) ? { opacity: 0.55 } : undefined}>
                {canDeleteCredit && (
                  <td>
                    <input
                      type="checkbox"
                      disabled={bulkDeleting}
                      checked={selectedRepaymentIds.includes(String(row._id || ''))}
                      onChange={e => setSelectedRepaymentIds(prev => e.target.checked ? [...new Set([...prev, String(row._id || '')])] : prev.filter(id => id !== String(row._id || '')))}
                    />
                  </td>
                )}
                <td>{getCustomerDetails(row.customerId).name}</td>
                <td>{getCustomerDetails(row.customerId).businessName}</td>
                <td><span className="price-accent">{formatCurrency(Number(row.amount || 0), settings)}</span></td>
                <td>{row.status}</td>
                <td>{row.remark || '—'}</td>
                <td>{formatDateTime(row.createdAt)}</td>
                {canDeleteCredit && (
                  <td>
                    <button className="btn" onClick={() => void deleteRepaymentRow(row)} disabled={deletingId === String(row._id || '')}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {deletingId === String(row._id || '') && <InlineSpinner />}
                        {deletingId === String(row._id || '') ? 'Deleting…' : 'Delete'}
                      </span>
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!loading && filteredRepayments.length === 0 && <tr><td colSpan={canDeleteCredit ? 8 : 6} style={{ padding: 12, color: '#64748b' }}>No repayments recorded yet</td></tr>}
          </tbody>
        </table>
        </div>
      </div>}
      {exportOpen && (
        <Modal
          title="Export Customer Purchase History"
          onClose={() => setExportOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setExportOpen(false)}>Cancel</button>
              <button className="btn" onClick={() => runRepaymentExport('csv')}>Export CSV</button>
              <button className="btn btn-primary" onClick={() => runRepaymentExport('pdf')}>Export PDF</button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <label>
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Customer</div>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input"
                    placeholder="Search customer, business name, phone or code"
                    value={exportCustomerSearch}
                    onChange={(e) => {
                      setExportCustomerSearch(e.target.value);
                      if (!String(e.target.value || '').trim()) setExportCustomerId('');
                    }}
                  />
                  {exportCustomerMatches.length > 0 && (
                    <div style={{ position: 'absolute', top: 44, left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', zIndex: 20, maxHeight: 320, overflowY: 'auto' }}>
                      {exportCustomerMatches.map((row) => (
                        <button
                          key={String(row._id || row.id || '')}
                          className="btn"
                          onClick={() => {
                            setExportCustomerId(String(row._id || row.id || ''));
                            setExportCustomerSearch(String(row.name || ''));
                          }}
                          style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0 }}
                        >
                          <span style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 700 }}>{row.name}</div>
                            <div style={{ color: '#64748b', fontSize: 12 }}>
                              {row.businessName || '—'} {(row.phone || row.businessPhone) ? ` • ${row.phone || row.businessPhone}` : ''} {(row.customerCode || '') ? ` • ${row.customerCode}` : ''}
                            </div>
                          </span>
                          <span>Select</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>
              <label>
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Transaction Type</div>
                <select className="select" value={exportTypeFilter} onChange={e => setExportTypeFilter(e.target.value)}>
                  <option value="all">All Transactions</option>
                  <option value="paid_only">Paid Sales Only</option>
                  <option value="credit_only">Credit Sales Only</option>
                </select>
              </label>
            </div>
            {exportCustomer && (
              <div style={{ color: '#64748b', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  Exporting for <strong style={{ color: '#0f172a' }}>{exportCustomer.name}</strong>
                  {exportCustomer.businessName ? ` • ${exportCustomer.businessName}` : ''}
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    setExportCustomerId('');
                    setExportCustomerSearch('');
                  }}
                >
                  Clear
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={() => setExportSelectedSaleIds(exportSales.map((row) => String(row.exportSaleId || '')).filter(Boolean))}
                disabled={exportSales.length === 0}
              >
                Select All
              </button>
              <button className="btn" onClick={() => setExportSelectedSaleIds([])} disabled={exportSelectedSaleIds.length === 0}>Clear</button>
              <div style={{ color: '#64748b', fontSize: 12 }}>
                {exportSelectedSaleIds.length} selected of {exportSales.length}
              </div>
            </div>
            <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th align="left">
                      <input
                        type="checkbox"
                        checked={exportSales.length > 0 && exportSales.every((row) => exportSelectedSaleIds.includes(String(row.exportSaleId || '')))}
                        onChange={e => setExportSelectedSaleIds(e.target.checked ? exportSales.map((row) => String(row.exportSaleId || '')).filter(Boolean) : [])}
                      />
                    </th>
                    <th align="left">Date</th>
                    <th align="left">Invoice</th>
                    <th align="left">Type</th>
                    <th align="left">Items</th>
                    <th align="left">Total</th>
                    <th align="left">Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {exportSales.map((sale) => (
                    <tr key={String(sale.exportSaleId || '')}>
                      <td>
                        <input
                          type="checkbox"
                          checked={exportSelectedSaleIds.includes(String(sale.exportSaleId || ''))}
                          onChange={e => setExportSelectedSaleIds((prev) => e.target.checked
                            ? [...new Set([...prev, String(sale.exportSaleId || '')])]
                            : prev.filter((id) => id !== String(sale.exportSaleId || '')))}
                        />
                      </td>
                      <td>{formatDateTime(sale.created_at || sale.createdAt)}</td>
                      <td>{sale.invoiceSerial || sale.exportSaleId || '—'}</td>
                      <td>{sale.paymentTypeLabel}</td>
                      <td>{Array.isArray(sale.items) ? sale.items.map((item) => `${item?.name || 'Item'} x ${Number(item?.qty || 0)}`).join(', ') : '—'}</td>
                      <td>{formatCurrency(Number(sale.total || 0), settings)}</td>
                      <td>{Array.isArray(sale.paymentRecords) ? sale.paymentRecords.length : 0}</td>
                    </tr>
                  ))}
                  {exportSales.length === 0 && (
                    <tr><td colSpan="7" style={{ padding: 12, color: '#64748b' }}>No purchase history found for the selected customer and transaction type.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default CreditControlPage;
