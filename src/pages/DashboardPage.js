import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { formatCurrency } from '../utils/currency';
import { Chart, BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend, Filler } from 'chart.js';
import * as expensesApi from '../api/expenses';
import { getCashReconciliationSummary } from '../api/cashReconciliations';
import { listOperations } from '../api/wholesale';
import { isFeatureEnabled } from '../utils/featureFlags';
import BranchSelect from '../components/BranchSelect';
import LoadingDots from '../components/LoadingDots';
import { useAppLanguage } from '../utils/localization';
import { getSaleActivityType, getSaleRangeTotals, saleHasActivityInRange } from '../utils/saleAccounting';

Chart.register(BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend, Filler);

function formatLocalDateKey(value) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizePaymentType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'other';
  if (['cash'].includes(raw)) return 'cash';
  if (['card', 'pos'].includes(raw)) return 'card';
  if (['mobile', 'momo', 'mobile_money', 'mobile money', 'momopay'].includes(raw)) return 'mobile';
  if (['wallet'].includes(raw)) return 'wallet';
  return 'other';
}

function addPaymentBreakdown(target, day, paymentType, amount) {
  if (!day) return;
  const value = Number(amount || 0);
  if (value <= 0) return;
  const type = normalizePaymentType(paymentType);
  target[day] = target[day] || {};
  target[day][type] = (target[day][type] || 0) + value;
}

function parseInputDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function startOfLocalDay(value) {
  const dt = parseInputDateKey(value);
  return dt ? new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0) : null;
}

function endOfLocalDay(value) {
  const dt = parseInputDateKey(value);
  return dt ? new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999) : null;
}

function isDateInRange(value, start = null, end = null) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return false;
  if (start && dt.getTime() < start.getTime()) return false;
  if (end && dt.getTime() > end.getTime()) return false;
  return true;
}

function getDashboardSaleActivityType(sale) {
  return getSaleActivityType(sale);
}

function isRefundSale(sale) {
  if (Number(sale?.total || 0) < 0) return true;
  if ((Array.isArray(sale?.payment_methods) ? sale.payment_methods : []).some((row) => String(row?.type || '').trim().toLowerCase() === 'refund')) return true;
  return (Array.isArray(sale?.items) ? sale.items : []).some((item) => String(item?.name || '').trim().toUpperCase().startsWith('REFUND '));
}

function getRefundEventDate(refund) {
  return refund?.approved_at || refund?.created_at || null;
}

function matchesDashboardActivityFilter(sale, filter) {
  const activityType = getDashboardSaleActivityType(sale);
  switch (String(filter || 'all').trim().toLowerCase()) {
    case 'all_sales':
      return activityType === 'retail_sales' || activityType === 'wholesale_sales';
    case 'all_credit':
      return activityType === 'retail_credit' || activityType === 'wholesale_credit';
    case 'retail_sales':
    case 'retail_credit':
    case 'wholesale_sales':
    case 'wholesale_credit':
      return activityType === String(filter || '').trim().toLowerCase();
    case 'all':
    default:
      return true;
  }
}

function isCreditOnlyDashboardFilter(filter) {
  const normalized = String(filter || 'all').trim().toLowerCase();
  return normalized === 'all_credit' || normalized === 'retail_credit' || normalized === 'wholesale_credit';
}

function enumerateDateKeys(fromKey, toKey) {
  const start = parseInputDateKey(fromKey);
  const end = parseInputDateKey(toKey);
  if (!start || !end || start.getTime() > end.getTime()) return [];
  const dates = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    dates.push(formatLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function DashboardPage() {
  const sales = useSelector(s => s.sales.sales);
  const refunds = useSelector(s => s.refunds.requests || []);
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const { t } = useAppLanguage();
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const isPrivilegedDashboardViewer = roleLower === 'superadmin' || roleLower === 'admin';
  const canViewRevenue = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_revenue') || grants.includes('view_financials');
  const canViewProfit = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_profit') || grants.includes('view_financials');
  const canViewCashierCompetitionAll = isPrivilegedDashboardViewer || grants.includes('view_dashboard_cashier_all');
  const canViewCashierCompetitionAssigned = canViewCashierCompetitionAll || grants.includes('view_dashboard_cashier_assigned');
  const canViewBranchCompetitionAll = isPrivilegedDashboardViewer || grants.includes('view_dashboard_branch_comparison_all');
  const canViewBranchCompetitionAssigned = canViewBranchCompetitionAll || grants.includes('view_dashboard_branch_comparison_assigned');
  const canUseScopedDashboardBranches = canViewCashierCompetitionAssigned || canViewBranchCompetitionAssigned;
  const canSelectAllDashboardBranches = isPrivilegedDashboardViewer || canUseScopedDashboardBranches;
  const canUseFinanceReconciliation = isFeatureEnabled(settings, 'modules.finance') && (
    isPrivilegedDashboardViewer ||
    grants.includes('view_finance_reconciliation') ||
    grants.includes('add_finance_reconciliation') ||
    grants.includes('approve_finance_reconciliation_director') ||
    grants.includes('approve_finance_reconciliation_manager')
  );
  const canUseExpenses = isFeatureEnabled(settings, 'modules.expenses') && (
    roleLower === 'superadmin' ||
    roleLower === 'admin' ||
    (Array.isArray(auth.grants) && ['view_expenses', 'see_expenses', 'add_expenses'].some((key) => auth.grants.includes(key)))
  );
  const [expenses, setExpenses] = useState([]);
  const [financeSummary, setFinanceSummary] = useState({ depositedAmount: 0, awaitingAmount: 0, pendingApprovalAmount: 0, backlogDays: 0 });
  const [financeSummaryLoading, setFinanceSummaryLoading] = useState(false);
  const [warehousePending, setWarehousePending] = useState(0);
  const [wholesalePending, setWholesalePending] = useState(0);
  const todayIso = useMemo(() => formatLocalDateKey(new Date()), []);
  const defaultRevenueChartFromIso = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    return formatLocalDateKey(start);
  }, []);
  const defaultFromIso = todayIso;
  const [periodMode, setPeriodMode] = useState('range');
  const [dateFrom, setDateFrom] = useState(defaultFromIso);
  const [dateTo, setDateTo] = useState(todayIso);
  const [activityFilter, setActivityFilter] = useState('all');
  const [showMoreSummaryCards, setShowMoreSummaryCards] = useState(false);
  const [customerLeaderboardMode, setCustomerLeaderboardMode] = useState('amount');
  const assignedBranchIds = useMemo(() => {
    const assigned = auth.user?.assignedBranches;
    const ids = [
      String(auth.user?.branchId || '').trim(),
      ...(assigned === 'all'
        ? branches.map((branch) => String(branch.id || '').trim())
        : (Array.isArray(assigned) ? assigned : [assigned]).map((value) => String(value || '').trim()))
    ].filter(Boolean);
    return Array.from(new Set(ids));
  }, [auth.user?.assignedBranches, auth.user?.branchId, branches]);
  const allowedDashboardBranchIds = useMemo(() => {
    if (canViewCashierCompetitionAll || canViewBranchCompetitionAll) {
      return branches.map((branch) => String(branch.id || '').trim()).filter(Boolean);
    }
    if (canUseScopedDashboardBranches) return assignedBranchIds;
    return [String(settings.currentBranchId || '').trim()].filter(Boolean);
  }, [assignedBranchIds, branches, canUseScopedDashboardBranches, canViewBranchCompetitionAll, canViewCashierCompetitionAll, settings.currentBranchId]);
  const allowedDashboardBranchIdSet = useMemo(() => new Set(allowedDashboardBranchIds), [allowedDashboardBranchIds]);
  const dashboardBranchOptions = useMemo(() => {
    if (canViewCashierCompetitionAll || canViewBranchCompetitionAll) return branches;
    if (canUseScopedDashboardBranches) return branches.filter((branch) => allowedDashboardBranchIdSet.has(String(branch.id || '').trim()));
    return branches.filter((branch) => String(branch.id || '').trim() === String(settings.currentBranchId || '').trim());
  }, [allowedDashboardBranchIdSet, branches, canUseScopedDashboardBranches, canViewBranchCompetitionAll, canViewCashierCompetitionAll, settings.currentBranchId]);
  const defaultDashboardBranchId = useMemo(() => {
    const current = String(settings.currentBranchId || '').trim();
    if (current && (allowedDashboardBranchIdSet.has(current) || branches.some((branch) => String(branch.id || '').trim() === current))) {
      return current;
    }
    return allowedDashboardBranchIds[0] || '';
  }, [allowedDashboardBranchIdSet, allowedDashboardBranchIds, branches, settings.currentBranchId]);
  const [branchId, setBranchId] = useState(() => (
    defaultDashboardBranchId
  ));
  const financeSummaryBranchId = useMemo(() => {
    if (canSelectAllDashboardBranches && String(branchId ?? '').trim() === '') return '';
    return String(branchId || defaultDashboardBranchId || settings.currentBranchId || '').trim();
  }, [branchId, canSelectAllDashboardBranches, defaultDashboardBranchId, settings.currentBranchId]);
  const dashboardScopeModeRef = useRef('');
  const dashboardBranchInitRef = useRef(false);
  const financeSummaryCacheRef = useRef(new Map());
  const financeSummaryRequestKey = useMemo(() => JSON.stringify({
    branchId: financeSummaryBranchId || '',
    periodMode,
    from: periodMode === 'all_time' ? '' : (dateFrom || defaultFromIso),
    to: periodMode === 'all_time' ? '' : (dateTo || todayIso)
  }), [dateFrom, dateTo, defaultFromIso, financeSummaryBranchId, periodMode, todayIso]);

  useEffect(() => {
    const nextScopeMode = isPrivilegedDashboardViewer
      ? 'all'
      : (canUseScopedDashboardBranches ? 'scoped' : 'current');
    if (dashboardScopeModeRef.current !== nextScopeMode) {
      dashboardScopeModeRef.current = nextScopeMode;
      dashboardBranchInitRef.current = true;
      setBranchId(defaultDashboardBranchId);
      return;
    }
    if (!defaultDashboardBranchId) return;
    if (!dashboardBranchInitRef.current) {
      dashboardBranchInitRef.current = true;
      setBranchId((prev) => prev || defaultDashboardBranchId);
      return;
    }
    const current = String(branchId || '').trim();
    if (canSelectAllDashboardBranches && current === '') return;
    if (current !== String(defaultDashboardBranchId || '').trim() && !allowedDashboardBranchIdSet.has(current) && !branches.some((branch) => String(branch.id || '').trim() === current)) {
      setBranchId(defaultDashboardBranchId);
    }
  }, [allowedDashboardBranchIdSet, branchId, branches, canSelectAllDashboardBranches, defaultDashboardBranchId, canUseScopedDashboardBranches, isPrivilegedDashboardViewer]);

  const inRange = useCallback((iso) => {
    if (periodMode === 'all_time') return true;
    const key = formatLocalDateKey(iso);
    if (!key) return false;
    return (!dateFrom || key >= dateFrom) && (!dateTo || key <= dateTo);
  }, [dateFrom, dateTo, periodMode]);
  const matchBranch = useCallback((value) => {
    const key = String(value || '').trim();
    if (canSelectAllDashboardBranches && String(branchId ?? '').trim() === '') {
      return allowedDashboardBranchIdSet.has(key);
    }
    return key === String(branchId || '').trim();
  }, [allowedDashboardBranchIdSet, branchId, canSelectAllDashboardBranches]);
  const matchCompetitionBranch = useCallback((value) => {
    const key = String(value || '').trim();
    if (canViewCashierCompetitionAll || canViewBranchCompetitionAll) return true;
    if (canUseScopedDashboardBranches) return allowedDashboardBranchIdSet.has(key);
    return key === String(branchId || settings.currentBranchId || '').trim();
  }, [allowedDashboardBranchIdSet, branchId, canUseScopedDashboardBranches, canViewBranchCompetitionAll, canViewCashierCompetitionAll, settings.currentBranchId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!canUseExpenses) {
        if (alive) setExpenses([]);
        return;
      }
      const to = periodMode === 'all_time' ? undefined : (dateTo || todayIso);
      const from = periodMode === 'all_time' ? undefined : (dateFrom || defaultFromIso);
      try {
        const expenseBranchId = isPrivilegedDashboardViewer
          ? (branchId || undefined)
          : (canUseScopedDashboardBranches
            ? (branchId || undefined)
            : settings.currentBranchId);
        const list = await expensesApi.list({ branchId: expenseBranchId, from, to });
        if (!alive) return;
        setExpenses(Array.isArray(list) ? list : []);
      } catch {
        if (!alive) return;
        setExpenses([]);
      }
    })();
    return () => { alive = false; };
  }, [settings.currentBranchId, isPrivilegedDashboardViewer, canUseScopedDashboardBranches, canUseExpenses, branchId, dateFrom, dateTo, todayIso, defaultFromIso, periodMode]);

  useEffect(() => {
    let alive = true;
    let loadingTimer = null;
    (async () => {
      if (!canUseFinanceReconciliation) {
        if (alive) setFinanceSummaryLoading(false);
        if (alive) setFinanceSummary({ depositedAmount: 0, awaitingAmount: 0, pendingApprovalAmount: 0, backlogDays: 0 });
        return;
      }
      const cached = financeSummaryCacheRef.current.get(financeSummaryRequestKey);
      if (cached && alive) {
        setFinanceSummary(cached);
        setFinanceSummaryLoading(false);
      } else {
        loadingTimer = setTimeout(() => {
          if (alive) setFinanceSummaryLoading(true);
        }, 180);
      }
      try {
        const data = await getCashReconciliationSummary({
          branchId: financeSummaryBranchId || undefined,
          from: periodMode === 'all_time' ? undefined : (dateFrom || defaultFromIso),
          to: periodMode === 'all_time' ? undefined : (dateTo || todayIso)
        });
        if (!alive) return;
        const nextSummary = {
          depositedAmount: Number(data?.depositedAmount || 0),
          awaitingAmount: Number(data?.awaitingAmount || 0),
          pendingApprovalAmount: Number(data?.pendingApprovalAmount || 0),
          backlogDays: Number(data?.backlogDays || 0)
        };
        financeSummaryCacheRef.current.set(financeSummaryRequestKey, nextSummary);
        setFinanceSummary(nextSummary);
        setFinanceSummaryLoading(false);
      } catch {
        if (!alive) return;
        setFinanceSummaryLoading(false);
        if (!cached) {
          setFinanceSummary({ depositedAmount: 0, awaitingAmount: 0, pendingApprovalAmount: 0, backlogDays: 0 });
        }
      }
    })();
    return () => {
      alive = false;
      if (loadingTimer) clearTimeout(loadingTimer);
    };
  }, [canUseFinanceReconciliation, dateFrom, dateTo, defaultFromIso, financeSummaryBranchId, financeSummaryRequestKey, periodMode, todayIso]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const groups = await Promise.all([
          listOperations({ operationArea: 'warehouse', operationType: 'purchase', status: 'pending_director' }).catch(() => []),
          listOperations({ operationArea: 'warehouse', operationType: 'transfer', status: 'pending_director' }).catch(() => []),
          listOperations({ operationArea: 'warehouse', operationType: 'adjustment', status: 'pending_director' }).catch(() => []),
          listOperations({ operationArea: 'warehouse', operationType: 'purchase', status: 'pending_manager' }).catch(() => []),
          listOperations({ operationArea: 'warehouse', operationType: 'transfer', status: 'pending_manager' }).catch(() => []),
          listOperations({ operationArea: 'warehouse', operationType: 'adjustment', status: 'pending_manager' }).catch(() => [])
        ]);
        if (!alive) return;
        setWarehousePending(groups.reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0));
      } catch {
        if (!alive) return;
        setWarehousePending(0);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const groups = await Promise.all([
          listOperations({ operationArea: 'wholesale', operationType: 'purchase', status: 'pending_director' }).catch(() => []),
          listOperations({ operationArea: 'wholesale', operationType: 'transfer', status: 'pending_director' }).catch(() => []),
          listOperations({ operationArea: 'wholesale', operationType: 'adjustment', status: 'pending_director' }).catch(() => []),
          listOperations({ operationArea: 'wholesale', operationType: 'purchase', status: 'pending_manager' }).catch(() => []),
          listOperations({ operationArea: 'wholesale', operationType: 'transfer', status: 'pending_manager' }).catch(() => []),
          listOperations({ operationArea: 'wholesale', operationType: 'adjustment', status: 'pending_manager' }).catch(() => [])
        ]);
        if (!alive) return;
        setWholesalePending(groups.reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0));
      } catch {
        if (!alive) return;
        setWholesalePending(0);
      }
    })();
    return () => { alive = false; };
  }, []);

  const chartTextColor = '#475569';
  const chartGridColor = '#e2e8f0';
  const chartLegendStyle = {
    position: 'bottom',
    labels: {
      color: chartTextColor,
      usePointStyle: true,
      pointStyle: 'circle',
      boxWidth: 8,
      boxHeight: 8,
      padding: 16,
      font: { size: 12, weight: '600' }
    }
  };

  const metrics = useMemo(() => {
    const selectedFrom = periodMode === 'all_time' ? null : startOfLocalDay(dateFrom || defaultFromIso);
    const selectedTo = periodMode === 'all_time' ? null : endOfLocalDay(dateTo || todayIso);
    const salesById = new Map(sales.map((sale) => [String(sale?.id || sale?._id || sale?.clientId || ''), sale]));
    const branchSales = sales.filter((s) => matchBranch(s.branchId));
    const filteredSales = branchSales.filter((s) => matchesDashboardActivityFilter(s, activityFilter));
    const createdSales = filteredSales.filter((s) => !isRefundSale(s) && isDateInRange(s.created_at, selectedFrom, selectedTo));
    const activitySales = filteredSales.filter((s) => !isRefundSale(s) && saleHasActivityInRange(s, selectedFrom, selectedTo));
    const approvedRefunds = refunds.filter((refund) => {
      if (String(refund?.status || '').trim().toLowerCase() !== 'approved') return false;
      if (!matchBranch(refund?.branchId)) return false;
      if (!isDateInRange(getRefundEventDate(refund), selectedFrom, selectedTo)) return false;
      const originalSale = salesById.get(String(refund?.saleId || ''));
      const fallbackSale = originalSale || {
        branchId: refund?.branchId,
        posType: String(refund?.refundArea || '').trim().toLowerCase() === 'distribution' ? 'wholesale' : 'retail'
      };
      return matchesDashboardActivityFilter(fallbackSale, activityFilter);
    });
    const productById = new Map();
    const categoryBySku = new Map();
    products.forEach((product) => {
      const productId = String(product?.id || product?._id || '');
      if (productId) productById.set(productId, product);
      const productCategory = String(product?.category || '').trim();
      const productSku = String(product?.sku || '').trim();
      if (productSku && productCategory) categoryBySku.set(productSku, productCategory);
      (Array.isArray(product?.variants) ? product.variants : []).forEach((variant) => {
        const variantSku = String(variant?.sku || '').trim();
        const inheritedCategory = String(variant?.category || productCategory || '').trim();
        if (variantSku && inheritedCategory) categoryBySku.set(variantSku, inheritedCategory);
      });
    });
    const competitionSales = sales.filter((s) => (
      !isRefundSale(s)
      &&
      matchCompetitionBranch(s.branchId)
      && matchesDashboardActivityFilter(s, activityFilter)
      && (isDateInRange(s.created_at, selectedFrom, selectedTo) || saleHasActivityInRange(s, selectedFrom, selectedTo))
    ));
    const branchNameById = new Map(branches.map((branch) => [String(branch.id), branch.name || branch.code || branch.id]));
    let todayTotal = 0;
    let todayProfit = 0;
    let last30Revenue = 0;
    let last30Profit = 0;
    let last30Cost = 0;
    let itemsSold = 0;
    let creditOut = 0;
    let retailCreditOut = 0;
    let wholesaleCreditOut = 0;
    let totalCreditRecovered = 0;
    let retailCreditRecovered = 0;
    let wholesaleCreditRecovered = 0;
    let approvedRefundAmount = 0;
    let approvedRefundProfit = 0;
    let approvedRefundCost = 0;
    let approvedRefundItems = 0;
    let approvedFullRefundSalesCount = 0;
    const perDay = {};
    const revenuePerDay = {};
    const perDayPayments = {}; // { 'YYYY-MM-DD': { cash: x, card: y, ... } }
    const categoryTotals = {};
    const productUnits = {}; // sku -> qty
    const cashierMap = new Map();
    const customerMap = new Map();
    const productProfit = new Map();
    for (const sale of filteredSales) {
      const outstandingCredit = Number(sale.outstandingTotal || sale.outstandingBalance || 0);
      const creditMode = String(sale.creditMode || '').trim().toLowerCase();
      creditOut += outstandingCredit;
      if (creditMode === 'retail_easybuy') {
        retailCreditOut += outstandingCredit;
      } else if (creditMode === 'distribution_credit') {
        wholesaleCreditOut += outstandingCredit;
      }
    }
    for (const sale of activitySales) {
      const recognized = getSaleRangeTotals(sale, selectedFrom, selectedTo);
      if (recognized.revenue === 0 && recognized.profit === 0 && recognized.cost === 0) continue;
      const creditMode = String(sale.creditMode || '').trim().toLowerCase();
      if (creditMode === 'retail_easybuy') {
        retailCreditRecovered += recognized.revenue;
        totalCreditRecovered += recognized.revenue;
      } else if (creditMode === 'distribution_credit') {
        wholesaleCreditRecovered += recognized.revenue;
        totalCreditRecovered += recognized.revenue;
      }
      todayTotal += recognized.revenue;
      todayProfit += recognized.profit;
      const customerId = String(sale.customerId || '').trim();
      const customerCode = String(sale.customerCode || '').trim();
      const customerName = String(sale.customerName || '').trim();
      const customerLabel = customerName || customerCode || customerId;
      const normalizedCustomerLabel = customerLabel.toLowerCase();
      if (customerLabel && !['walk-in', 'walk in', '—', '-'].includes(normalizedCustomerLabel)) {
        const customerKey = customerId || customerCode || normalizedCustomerLabel;
        if (!customerMap.has(customerKey)) {
          customerMap.set(customerKey, {
            key: customerKey,
            customerId,
            customerCode,
            customerName: customerLabel,
            sales: 0,
            amount: 0,
            products: 0
          });
        }
        const customerRow = customerMap.get(customerKey);
        customerRow.amount += recognized.revenue;
      }
    }
    for (const sale of createdSales.filter((row) => !isRefundSale(row))) {
      const customerId = String(sale.customerId || '').trim();
      const customerCode = String(sale.customerCode || '').trim();
      const customerName = String(sale.customerName || '').trim();
      const customerLabel = customerName || customerCode || customerId;
      const normalizedCustomerLabel = customerLabel.toLowerCase();
      let customerRow = null;
      if (customerLabel && !['walk-in', 'walk in', '—', '-'].includes(normalizedCustomerLabel)) {
        const customerKey = customerId || customerCode || normalizedCustomerLabel;
        if (!customerMap.has(customerKey)) {
          customerMap.set(customerKey, {
            key: customerKey,
            customerId,
            customerCode,
            customerName: customerLabel,
            sales: 0,
            amount: 0,
            products: 0
          });
        }
        customerRow = customerMap.get(customerKey);
        if (customerRow) customerRow.sales += 1;
      }
      for (const it of sale.items) {
        itemsSold += it.qty;
        const prod = productById.get(String(it.productId || '')) || products.find((p) => p.sku === it.sku);
        const cat = String(prod?.category || categoryBySku.get(String(it.sku || '').trim()) || '').trim() || t('Uncategorized');
        categoryTotals[cat] = (categoryTotals[cat] || 0) + it.qty;
        productUnits[it.sku] = (productUnits[it.sku] || 0) + it.qty;

        const pid = it.productId || '';
        const key = `${pid}:${it.variantId || ''}`;
        if (!productProfit.has(key)) productProfit.set(key, { key, name: it.name || it.sku || '—', units: 0, revenue: 0, cost: 0, profit: 0 });
        const row = productProfit.get(key);
        const qty = Number(it.qty) || 0;
        const price = Number(it.price) || 0;
        const cp = Number(prod?.costPrice || 0);
        row.units += qty;
        row.revenue += qty * price;
        row.cost += qty * (Number.isFinite(cp) ? cp : 0);
        row.profit = row.revenue - row.cost;
        if (customerRow) customerRow.products += qty;
      }
    }
    for (const refund of approvedRefunds) {
      const refundType = String(refund?.type || '').trim().toLowerCase();
      const originalSale = salesById.get(String(refund?.saleId || ''));
      const originalItems = Array.isArray(originalSale?.items) ? originalSale.items : [];
      const refundItems = Array.isArray(refund?.restockItems) ? refund.restockItems : [];
      const fallbackRevenue = refundType === 'full' ? Math.abs(Number(originalSale?.total || 0)) : 0;
      const refundRevenue = Math.abs(Number(refund?.requestedAmount || 0)) || fallbackRevenue;
      let refundCost = 0;
      let refundItemQty = 0;
      if (refundItems.length > 0) {
        refundItems.forEach((refundItem) => {
          const qty = Math.max(0, Number(refundItem?.qty || 0));
          if (qty <= 0) return;
          refundItemQty += qty;
          const matchedOriginal = originalItems.find((item) => (
            (refundItem?.productId && String(item?.productId || '') === String(refundItem.productId || ''))
            || (refundItem?.variantId && String(item?.variantId || '') === String(refundItem.variantId || ''))
            || (refundItem?.sku && String(item?.sku || '') === String(refundItem.sku || ''))
          )) || {};
          const matchedProduct = productById.get(String(matchedOriginal?.productId || refundItem?.productId || ''));
          const costPrice = Number(matchedOriginal?.costPrice || matchedProduct?.costPrice || 0);
          refundCost += qty * (Number.isFinite(costPrice) ? costPrice : 0);
        });
      } else if (refundType === 'full' && originalSale) {
        refundItemQty = originalItems.reduce((sum, item) => sum + Math.max(0, Number(item?.qty || 0)), 0);
        refundCost = Math.abs(Number(originalSale?.costTotal || 0));
      }
      approvedRefundAmount += refundRevenue;
      approvedRefundCost += refundCost;
      approvedRefundProfit += Math.max(0, refundRevenue - refundCost);
      approvedRefundItems += refundItemQty;
      if (refundType === 'full' && originalSale) approvedFullRefundSalesCount += 1;
    }
    for (const sale of activitySales) {
      const timeline = Array.isArray(sale.paymentTimeline) ? sale.paymentTimeline : [];
      const salePaidAt = new Date(sale.created_at || sale.saleCapturedAt || sale.recordedAt || 0);
      const saleDay = Number.isNaN(salePaidAt.getTime()) ? '' : formatLocalDateKey(salePaidAt);
      const saleDayInRange = saleDay && (!selectedFrom || salePaidAt.getTime() >= selectedFrom.getTime()) && (!selectedTo || salePaidAt.getTime() <= selectedTo.getTime());
      const recordedMethods = Array.isArray(sale.payment_methods) ? sale.payment_methods : [];
      let saleDayAmountCaptured = 0;
      timeline.forEach((event) => {
        const paidAt = new Date(event.paidAt || 0);
        if (Number.isNaN(paidAt.getTime())) return;
        if (selectedFrom && paidAt.getTime() < selectedFrom.getTime()) return;
        if (selectedTo && paidAt.getTime() > selectedTo.getTime()) return;
        const day = formatLocalDateKey(paidAt);
        const eventAmount = Number(event.amount || 0);
        perDay[day] = (perDay[day] || 0) + eventAmount;
        if (event.source === 'credit_repayment') {
          addPaymentBreakdown(perDayPayments, day, event.paymentMethod || 'cash', eventAmount);
          return;
        }
        if (day === saleDay) saleDayAmountCaptured += eventAmount;
      });
      if (saleDayInRange) {
        if (recordedMethods.length > 0) {
          recordedMethods.forEach((methodRow) => addPaymentBreakdown(perDayPayments, saleDay, methodRow?.type, methodRow?.amount));
        } else if (saleDayAmountCaptured > 0) {
          addPaymentBreakdown(perDayPayments, saleDay, 'other', saleDayAmountCaptured);
        }
      }
    }
    const useRevenueChartDefaultWindow = periodMode === 'range'
      && String(dateFrom || '') === String(todayIso || '')
      && String(dateTo || '') === String(todayIso || '');
    const revenueChartFromIso = periodMode === 'all_time'
      ? ''
      : (useRevenueChartDefaultWindow ? defaultRevenueChartFromIso : (dateFrom || defaultFromIso));
    const revenueChartToIso = periodMode === 'all_time'
      ? ''
      : (dateTo || todayIso);
    const revenueChartSales = filteredSales;
    for (const sale of revenueChartSales) {
      const timeline = Array.isArray(sale.paymentTimeline) ? sale.paymentTimeline : [];
      timeline.forEach((event) => {
        const paidAt = new Date(event.paidAt || 0);
        if (Number.isNaN(paidAt.getTime())) return;
        const key = formatLocalDateKey(paidAt);
        if (!key) return;
        if (periodMode !== 'all_time') {
          if (revenueChartFromIso && key < revenueChartFromIso) return;
          if (revenueChartToIso && key > revenueChartToIso) return;
        }
        revenuePerDay[key] = (revenuePerDay[key] || 0) + Number(event.amount || 0);
      });
    }
    for (const sale of competitionSales) {
      const seller = sale.sellerName || t('Unknown');
      const saleBranchId = String(sale.branchId || '').trim();
      const saleBranchName = branchNameById.get(saleBranchId) || sale.branchName || saleBranchId || '—';
      const cashierKey = `${saleBranchId}::${seller}`;
      if (!cashierMap.has(cashierKey)) {
        cashierMap.set(cashierKey, {
          key: cashierKey,
          branchId: saleBranchId,
          branchName: saleBranchName,
          seller,
          sales: 0,
          revenue: 0,
          profit: 0
        });
      }
      const cashierRow = cashierMap.get(cashierKey);
      const totals = getSaleRangeTotals(sale, selectedFrom, selectedTo);
      if (totals.revenue === 0 && totals.profit === 0) continue;
      cashierRow.sales += 1;
      cashierRow.revenue += totals.revenue;
      cashierRow.profit += totals.profit;
    }
    const filteredDateKeys = createdSales
      .map((sale) => formatLocalDateKey(sale.created_at))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const daysInRange = periodMode === 'all_time'
      ? Array.from(new Set([...filteredDateKeys, ...Object.keys(perDayPayments), ...Object.keys(revenuePerDay)])).sort((a, b) => a.localeCompare(b))
      : enumerateDateKeys(dateFrom || defaultFromIso, dateTo || todayIso);
    const last7 = daysInRange.slice(-7);
    const revenueChartDays = periodMode === 'all_time'
      ? Array.from(new Set(Object.keys(revenuePerDay))).sort((a, b) => a.localeCompare(b))
      : enumerateDateKeys(revenueChartFromIso, revenueChartToIso);
    const last30 = daysInRange;
    const lineData = {
      labels: revenueChartDays,
      datasets: [{
        label: t('Revenue'),
        data: revenueChartDays.map(d => +(revenuePerDay[d] || 0).toFixed(2)),
        fill: true,
        tension: 0.35,
        backgroundColor: 'rgba(37,99,235,0.12)',
        borderColor: '#2563eb',
        pointBackgroundColor: '#2563eb',
        pointBorderColor: '#ffffff',
        pointHoverRadius: 4,
        pointRadius: 2.5,
        borderWidth: 2.5
      }]
    };
    last30Revenue = last30.reduce((s, d) => s + (Number(perDay[d] || 0)), 0);
    const last30Sales = activitySales;
    last30Profit = last30Sales.reduce((s, x) => s + getSaleRangeTotals(x, selectedFrom, selectedTo).profit, 0);
    last30Cost = last30Sales.reduce((s, x) => s + getSaleRangeTotals(x, selectedFrom, selectedTo).cost, 0);
    todayTotal = Math.max(0, todayTotal - approvedRefundAmount);
    todayProfit = Math.max(0, todayProfit - approvedRefundProfit);
    itemsSold = Math.max(0, itemsSold - approvedRefundItems);
    last30Revenue = Math.max(0, last30Revenue - approvedRefundAmount);
    last30Profit = Math.max(0, last30Profit - approvedRefundProfit);
    last30Cost = Math.max(0, last30Cost - approvedRefundCost);
    const marginPct = last30Revenue > 0 ? Math.round((last30Profit / last30Revenue) * 10000) / 100 : 0;
    const paymentTypes = ['cash','card','mobile','wallet','other'];
    const paymentBar = {
      labels: last7,
      datasets: paymentTypes.map((paymentType, idx) => ({
        label: t(paymentType.charAt(0).toUpperCase() + paymentType.slice(1)),
        data: last7.map(d => +(perDayPayments[d]?.[paymentType] || 0).toFixed(2)),
        backgroundColor: ['#2563eb','#14b8a6','#facc15','#8b5cf6','#94a3b8'][idx],
        borderRadius: 8,
        maxBarThickness: 26
      }))
    };
    const doughLabels = Object.keys(categoryTotals);
    const doughData = {
      labels: doughLabels,
      datasets: [{
        data: doughLabels.map(k => categoryTotals[k]),
        backgroundColor: ['#2563eb','#14b8a6','#f59e0b','#ef4444','#8b5cf6','#0f766e','#ec4899','#94a3b8'],
        borderColor: '#ffffff',
        borderWidth: 2,
        hoverOffset: 8
      }]
    };
    const top5 = Object.entries(productUnits)
      .sort((a,b) => b[1]-a[1])
      .slice(0,5)
      .map(([sku, qty]) => {
        const p = products.find(pp => pp.sku === sku);
        return { name: p?.name || sku, qty };
      });
    const topBar = {
      labels: top5.map(x => x.name),
      datasets: [{
        label: t('Units'),
        data: top5.map(x => x.qty),
        backgroundColor: '#2563eb',
        borderRadius: 8,
        maxBarThickness: 24
      }]
    };
    const stackedOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: chartLegendStyle },
      scales: {
        x: {
          stacked: true,
          ticks: { color: chartTextColor, font: { size: 12, weight: '600' } },
          grid: { display: false }
        },
        y: {
          stacked: true,
          ticks: { color: chartTextColor, font: { size: 12, weight: '600' } },
          grid: { color: chartGridColor }
        }
      }
    };
    const lineOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: chartLegendStyle },
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          ticks: { color: chartTextColor, font: { size: 12, weight: '600' } },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: chartTextColor, font: { size: 12, weight: '600' } },
          grid: { color: chartGridColor }
        }
      }
    };
    const barOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: chartTextColor, font: { size: 12, weight: '600' } },
          grid: { color: chartGridColor }
        },
        y: {
          ticks: { color: chartTextColor, font: { size: 12, weight: '700' } },
          grid: { display: false }
        }
      }
    };
    const cashierRows = Array.from(cashierMap.values()).sort((a, b) => b.revenue - a.revenue);
    const multiBranchCashierView = new Set(cashierRows.map((row) => String(row.branchId || '').trim()).filter(Boolean)).size > 1;
    const cashierTop = cashierRows.slice(0, 6);
    const cashierBar = {
      labels: cashierTop.map((row) => (multiBranchCashierView ? `${row.branchName} • ${row.seller}` : row.seller)),
      datasets: [{ label: t('Revenue'), data: cashierTop.map((row) => +(row.revenue || 0).toFixed(2)), backgroundColor: '#14b8a6', borderRadius: 8, maxBarThickness: 22 }]
    };
    const cashierLeaderboard = cashierRows.slice(0, 10);
    const customerRows = Array.from(customerMap.values());
    const customerLeaderboardByAmount = customerRows
      .slice()
      .sort((a, b) => b.amount - a.amount || b.products - a.products || a.customerName.localeCompare(b.customerName))
      .slice(0, 10);
    const customerLeaderboardByProducts = customerRows
      .slice()
      .sort((a, b) => b.products - a.products || b.amount - a.amount || a.customerName.localeCompare(b.customerName))
      .slice(0, 10);

    const topProfitProducts = Array.from(productProfit.values()).sort((a, b) => b.profit - a.profit).slice(0, 10);

    const revenueLineTitle = periodMode === 'all_time'
      ? t('Revenue (All Time)')
      : (useRevenueChartDefaultWindow ? t('Revenue (Last 30 Days)') : t('Revenue (Selected Range)'));
    return {
      todayTotal,
      todayProfit,
      itemsSold,
      transactionCount: Math.max(0, createdSales.length - approvedFullRefundSalesCount),
      creditOut,
      retailCreditOut,
      wholesaleCreditOut,
      totalCreditRecovered,
      retailCreditRecovered,
      wholesaleCreditRecovered,
      approvedRefundAmount,
      lineData,
      paymentBar,
      doughData,
      topBar,
      stackedOptions,
      lineOptions,
      barOptions,
      cashierBar,
      last30Revenue,
      last30Profit,
      last30Cost,
      marginPct,
      cashierLeaderboard,
      customerLeaderboardByAmount,
      customerLeaderboardByProducts,
      topProfitProducts,
      multiBranchCashierView,
      revenueLineTitle
    };
  }, [sales, refunds, products, branches, branchId, dateFrom, dateTo, inRange, matchBranch, matchCompetitionBranch, defaultFromIso, defaultRevenueChartFromIso, todayIso, periodMode, activityFilter, canUseScopedDashboardBranches, canViewBranchCompetitionAll, canViewCashierCompetitionAll, t]);

  const finance = useMemo(() => {
    const expenseTotal = expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const net = metrics.last30Revenue - expenseTotal;
    const projected30 = net;
    return { expenseTotal, net, projected30 };
  }, [expenses, metrics.last30Revenue]);
  const creditOnlyDashboardView = useMemo(() => isCreditOnlyDashboardFilter(activityFilter), [activityFilter]);
  const pendingDepositValue = useMemo(() => {
    if (creditOnlyDashboardView) return 0;
    return Math.max(0, financeSummary.awaitingAmount - metrics.approvedRefundAmount);
  }, [creditOnlyDashboardView, financeSummary.awaitingAmount, metrics.approvedRefundAmount]);

  function maskRevenue(value) {
    return canViewRevenue ? formatCurrency(value, settings) : '******';
  }

  function maskProfit(value) {
    return canViewProfit ? formatCurrency(value, settings) : '******';
  }

  function maskProfitText(value) {
    return canViewProfit ? value : '***';
  }

  const branchComparison = useMemo(() => {
    if (!(canViewBranchCompetitionAssigned || canViewBranchCompetitionAll)) return [];
    const byId = new Map(branches.map(b => [String(b.id), b.name || b.code || b.id]));
    const fullyRefundedSaleIds = new Set(
      (Array.isArray(refunds) ? refunds : [])
        .filter((refund) => String(refund?.status || '').trim().toLowerCase() === 'approved')
        .filter((refund) => String(refund?.type || '').trim().toLowerCase() === 'full')
        .map((refund) => String(refund?.saleId || '').trim())
        .filter(Boolean)
    );
    const map = new Map();
    for (const s of sales) {
      const saleId = String(s?.id || s?._id || s?.clientId || '').trim();
      if (isRefundSale(s)) continue;
      if (saleId && fullyRefundedSaleIds.has(saleId)) continue;
      if (!inRange(s.created_at) || !matchCompetitionBranch(s.branchId)) continue;
      const key = String(s.branchId || '');
      if (!map.has(key)) map.set(key, { branchId: key, name: byId.get(key) || key, revenue: 0, profit: 0, sales: 0 });
      const row = map.get(key);
      row.revenue += Number(s.total) || 0;
      row.profit += Number(s.profitTotal) || 0;
      row.sales += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [sales, refunds, branches, inRange, matchCompetitionBranch, canViewBranchCompetitionAssigned, canViewBranchCompetitionAll]);
  const customerLeaderboard = useMemo(() => (
    customerLeaderboardMode === 'products'
      ? metrics.customerLeaderboardByProducts
      : metrics.customerLeaderboardByAmount
  ), [customerLeaderboardMode, metrics.customerLeaderboardByAmount, metrics.customerLeaderboardByProducts]);
  const customerLeaderboardChart = useMemo(() => {
    const label = customerLeaderboardMode === 'products' ? t('Products Bought') : t('Amount Spent');
    return {
      labels: customerLeaderboard.map((row) => row.customerName),
      datasets: [{
        label,
        data: customerLeaderboard.map((row) => +(customerLeaderboardMode === 'products' ? row.products : row.amount).toFixed(2)),
        backgroundColor: customerLeaderboardMode === 'products' ? '#14b8a6' : '#2563eb',
        borderRadius: 6,
        maxBarThickness: 28,
        categoryPercentage: 0.7,
        barPercentage: 0.8
      }]
    };
  }, [customerLeaderboard, customerLeaderboardMode, t]);

  const warehouseStats = useMemo(() => {
    const warehouseBranches = branches.filter(b => String(b.branchType || 'retail').toLowerCase() === 'warehouse');
    const warehouseUnits = products.reduce((sum, product) => {
      const base = Object.values(product.warehouseStockByBranch || {}).reduce((s, qty) => s + (Number(qty) || 0), 0);
      const variants = Array.isArray(product.variants)
        ? product.variants.reduce((s, variant) => s + Object.values(variant.warehouseStockByBranch || {}).reduce((t, qty) => t + (Number(qty) || 0), 0), 0)
        : 0;
      return sum + base + variants;
    }, 0);
    const lowStockRows = products
      .map(product => {
        const total = Object.values(product.warehouseStockByBranch || {}).reduce((s, qty) => s + (Number(qty) || 0), 0);
        return { id: product.id, name: product.name, lowStock: Number(product.warehouseLowStock != null ? product.warehouseLowStock : (product.lowStock || 0)), total };
      })
      .filter(row => row.lowStock > 0 && row.total <= row.lowStock)
      .sort((a, b) => a.total - b.total)
      .slice(0, 8);
    return {
      warehouseCount: warehouseBranches.length,
      warehouseUnits,
      lowStockRows
    };
  }, [branches, products]);
  const wholesaleStats = useMemo(() => {
    const wholesaleBranches = branches.filter(b => String(b.branchType || 'retail').toLowerCase() === 'wholesale');
    const wholesaleUnits = products.reduce((sum, product) => {
      const base = Object.values(product.wholesaleStockByBranch || {}).reduce((s, qty) => s + (Number(qty) || 0), 0);
      const variants = Array.isArray(product.variants)
        ? product.variants.reduce((s, variant) => s + Object.values(variant.wholesaleStockByBranch || {}).reduce((t, qty) => t + (Number(qty) || 0), 0), 0)
        : 0;
      return sum + base + variants;
    }, 0);
    const lowStockRows = products
      .map(product => {
        const total = Object.values(product.wholesaleStockByBranch || {}).reduce((s, qty) => s + (Number(qty) || 0), 0);
        return { id: product.id, name: product.name, lowStock: Number(product.wholesaleLowStock != null ? product.wholesaleLowStock : (product.lowStock || 0)), total };
      })
      .filter(row => row.lowStock > 0 && row.total <= row.lowStock)
      .sort((a, b) => a.total - b.total)
      .slice(0, 8);
    return {
      wholesaleCount: wholesaleBranches.length,
      wholesaleUnits,
      lowStockRows
    };
  }, [branches, products]);
  const summaryCardStyle = {
    background: '#fff',
    padding: 11,
    borderRadius: 14,
    border: '1px solid #e2e8f0',
    boxShadow: '0 8px 18px rgba(15, 23, 42, 0.05)',
    position: 'relative',
    overflow: 'hidden'
  };
  const summaryCardAccentStyle = (accent) => ({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    background: `linear-gradient(90deg, ${accent} 0%, ${accent}cc 100%)`
  });
  const summaryCardBadgeStyle = (accent, tint) => ({
    width: 36,
    height: 36,
    borderRadius: 999,
    background: tint,
    color: accent,
    display: 'grid',
    placeItems: 'center',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.3,
    flexShrink: 0,
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.5)'
  });
  const summaryCards = [
    { key: 'sales', label: t('Total Sales (Repayment + Actual Sales)'), value: maskRevenue(metrics.todayTotal), subtitle: periodMode === 'all_time' ? t('Recognized sales and repayments for all time') : t('Recognized sales and repayments in selected range'), accent: '#2563eb', tint: '#dbeafe', badge: 'RV', primary: true },
    { key: 'profit', label: t('Total Profit (Repayment Profit + Actual Sales Profit)'), value: maskProfit(metrics.todayProfit), subtitle: canViewProfit ? t('Recognized profit for sales and repayments') : t('Profit access masked'), accent: '#7c3aed', tint: '#ede9fe', badge: 'PF', primary: true },
    { key: 'items', label: t('Items Sold'), value: metrics.itemsSold, subtitle: t('Units from sales created in range'), accent: '#0f766e', tint: '#ccfbf1', badge: 'IT', primary: true },
    { key: 'credit_out', label: t('Total Credit Sales'), value: maskRevenue(metrics.creditOut), subtitle: t('Outstanding balance across all credit sales'), accent: '#b45309', tint: '#ffedd5', badge: 'CR', primary: true },
    { key: 'total_credit_recovered', label: t('Total Credit Recovered'), value: maskRevenue(metrics.totalCreditRecovered), subtitle: periodMode === 'all_time' ? t('All credit repayments received') : t('Credit repayments received in selected range'), accent: '#10b981', tint: '#d1fae5', badge: 'TR', primary: true },
    { key: 'awaiting', label: t('Pending Deposit'), value: maskRevenue(pendingDepositValue), subtitle: financeSummaryLoading ? t('Refreshing finance summary') : (creditOnlyDashboardView ? t('No pending deposit in credit-only view') : t('Money waiting to be deposited after refunds')), accent: '#ef4444', tint: '#fee2e2', badge: 'PD', loading: financeSummaryLoading, primary: canUseFinanceReconciliation, hidden: !canUseFinanceReconciliation },
    { key: 'cashflow', label: t('Cash Available'), value: maskProfit(finance.net), subtitle: t('Recognized revenue minus expenses'), accent: '#16a34a', tint: '#dcfce7', badge: 'CF' },
    { key: 'deposited', label: t('Money Deposited'), value: maskRevenue(financeSummary.depositedAmount), subtitle: financeSummaryLoading ? t('Refreshing finance summary') : t('Approved reconciliations'), accent: '#14b8a6', tint: '#ccfbf1', badge: 'MD', loading: financeSummaryLoading, hidden: !canUseFinanceReconciliation },
    { key: 'retail_credit_out', label: t('Retail Credit Sales'), value: maskRevenue(metrics.retailCreditOut), subtitle: t('Outstanding retail credit balance'), accent: '#0ea5e9', tint: '#e0f2fe', badge: 'RE' },
    { key: 'wholesale_credit_out', label: t('Wholesale Credit Sales'), value: maskRevenue(metrics.wholesaleCreditOut), subtitle: t('Outstanding wholesale credit balance'), accent: '#7c2d12', tint: '#ffedd5', badge: 'WC' },
    { key: 'retail_credit_recovered', label: t('Retail Credit Repayment'), value: maskRevenue(metrics.retailCreditRecovered), subtitle: periodMode === 'all_time' ? t('All retail credit repayments received') : t('Retail credit repayments in selected range'), accent: '#22c55e', tint: '#dcfce7', badge: 'RR' },
    { key: 'wholesale_credit_recovered', label: t('Wholesale Credit Repayment'), value: maskRevenue(metrics.wholesaleCreditRecovered), subtitle: periodMode === 'all_time' ? t('All wholesale credit repayments received') : t('Wholesale credit repayments in selected range'), accent: '#a855f7', tint: '#f3e8ff', badge: 'WR' },
    { key: 'transactions', label: t('Sales Count'), value: metrics.transactionCount, subtitle: t('Sales created in selected range'), accent: '#f59e0b', tint: '#fef3c7', badge: 'TX' },
    { key: 'margin', label: t('Margin'), value: maskProfitText(`${metrics.marginPct}%`), subtitle: t('Gross margin percentage'), accent: '#ec4899', tint: '#fce7f3', badge: 'MG' },
    { key: 'refunded', label: t('Refunded'), value: maskRevenue(metrics.approvedRefundAmount), subtitle: periodMode === 'all_time' ? t('Approved refunds for all time') : t('Approved refunds in selected range'), accent: '#dc2626', tint: '#fee2e2', badge: 'RF' }
  ].filter((card) => !card.hidden);
  const primarySummaryCards = summaryCards.filter((card) => card.primary);
  const secondarySummaryCards = summaryCards.filter((card) => !card.primary);
  const sectionCardStyle = {
    background: '#fff',
    padding: 14,
    borderRadius: 16,
    border: '1px solid #e2e8f0',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)'
  };
  const pageTitleStyle = {
    margin: '0 0 10px',
    fontSize: 30,
    lineHeight: 1.1,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: -0.6
  };
  const sectionTitleStyle = {
    margin: 0,
    fontSize: 17,
    lineHeight: 1.2,
    fontWeight: 800,
    color: '#0f172a',
    letterSpacing: -0.25
  };
  const fieldLabelStyle = {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6
  };
  const bodyMutedStyle = {
    color: '#64748b',
    fontSize: 12.5,
    fontWeight: 500
  };
  const miniStatLabelStyle = {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 700
  };
  const miniStatValueStyle = {
    fontSize: 22,
    lineHeight: 1.15,
    fontWeight: 800,
    color: '#0f172a'
  };
  const tableHeaderStyle = {
    color: '#475569',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.2
  };
  const tableCellStyle = {
    paddingTop: 12,
    paddingBottom: 12,
    color: '#334155',
    fontSize: 13,
    fontWeight: 500
  };
  return (
    <div style={{ padding: 12 }}>
      <h1 style={pageTitleStyle}>{t('Dashboard')}</h1>
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label>
            <div style={fieldLabelStyle}>{t('Period')}</div>
            <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
              <option value="range">{t('Custom Range')}</option>
              <option value="all_time">{t('All Time')}</option>
            </select>
          </label>
          <label>
            <div style={fieldLabelStyle}>{t('From')}</div>
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div style={fieldLabelStyle}>{t('To')}</div>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div style={fieldLabelStyle}>{t('Activity')}</div>
            <select className="select" value={activityFilter} onChange={e => setActivityFilter(e.target.value)}>
              <option value="all">{t('All Sales & Credit')}</option>
              <option value="all_sales">{t('All Sales')}</option>
              <option value="all_credit">{t('All Credit')}</option>
              <option value="retail_sales">{t('Retail Sales')}</option>
              <option value="retail_credit">{t('Retail Credit')}</option>
              <option value="wholesale_sales">{t('Wholesale Sales')}</option>
              <option value="wholesale_credit">{t('Wholesale Credit')}</option>
            </select>
          </label>
          <label>
            <div style={fieldLabelStyle}>{t('Branch')}</div>
            <BranchSelect
              value={branchId}
              onChange={setBranchId}
              includeAll={isPrivilegedDashboardViewer || canUseScopedDashboardBranches}
              allLabel={canViewCashierCompetitionAll || canViewBranchCompetitionAll ? t('All Branches') : t('Assigned Branches')}
              overrideBranches={dashboardBranchOptions}
            />
          </label>
        </div>
      </div>
      <div className="summary-grid" style={{ marginBottom: 6, gap: 12 }}>
        {primarySummaryCards.map((card) => (
          <div key={card.key} style={summaryCardStyle}>
            <div style={summaryCardAccentStyle(card.accent)} />
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.25, fontWeight: 700 }}>{card.label}</div>
                <div style={{ fontSize: 22, lineHeight: 1.1, fontWeight: 800, color: '#0f172a', marginTop: 6 }}>
                  {card.loading ? (
                    <LoadingDots label={t('Loading finance summary')} />
                  ) : card.value}
                </div>
                <div style={{ marginTop: 6, color: '#64748b', fontSize: 11, lineHeight: 1.3 }}>{card.subtitle}</div>
              </div>
              <div style={summaryCardBadgeStyle(card.accent, card.tint)}>{card.badge}</div>
            </div>
            <div style={{ marginTop: 10, height: 4, borderRadius: 999, background: `linear-gradient(90deg, ${card.accent} 0%, ${card.accent}99 72%, rgba(255,255,255,0) 100%)` }} />
          </div>
        ))}
      </div>
      {secondarySummaryCards.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowMoreSummaryCards((prev) => !prev)}
            style={{ fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ width: 18, height: 18, borderRadius: 999, display: 'inline-grid', placeItems: 'center', background: '#e2e8f0', color: '#0f172a', fontSize: 12, fontWeight: 800 }}>
              {showMoreSummaryCards ? '-' : '+'}
            </span>
            {showMoreSummaryCards ? t('Hide More Summary Cards') : t('Show More Summary Cards')}
          </button>
        </div>
      )}
      {showMoreSummaryCards && secondarySummaryCards.length > 0 && (
        <div className="summary-grid" style={{ marginBottom: 12, gap: 12 }}>
          {secondarySummaryCards.map((card) => (
            <div key={card.key} style={summaryCardStyle}>
              <div style={summaryCardAccentStyle(card.accent)} />
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.25, fontWeight: 700 }}>{card.label}</div>
                  <div style={{ fontSize: 22, lineHeight: 1.1, fontWeight: 800, color: '#0f172a', marginTop: 6 }}>
                    {card.loading ? (
                      <LoadingDots label={t('Loading finance summary')} />
                    ) : card.value}
                  </div>
                  <div style={{ marginTop: 6, color: '#64748b', fontSize: 11, lineHeight: 1.3 }}>{card.subtitle}</div>
                </div>
                <div style={summaryCardBadgeStyle(card.accent, card.tint)}>{card.badge}</div>
              </div>
              <div style={{ marginTop: 10, height: 4, borderRadius: 999, background: `linear-gradient(90deg, ${card.accent} 0%, ${card.accent}99 72%, rgba(255,255,255,0) 100%)` }} />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, alignItems: 'start' }}>
        <div style={sectionCardStyle}>
          <h2 style={sectionTitleStyle}>{metrics.revenueLineTitle}</h2>
          <div style={{ height: 220 }}>
            <Line data={metrics.lineData} options={{
              ...metrics.lineOptions,
              scales: {
                ...(metrics.lineOptions.scales || {}),
                y: { ...((metrics.lineOptions.scales || {}).y || {}), ticks: { callback: (value) => (canViewRevenue ? value : '***') } }
              },
              plugins: {
                ...(metrics.lineOptions.plugins || {}),
                tooltip: {
                  callbacks: {
                    label: (ctx) => (canViewRevenue ? `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y || 0, settings)}` : `${ctx.dataset.label}: ***`)
                  }
                }
              }
            }} />
          </div>
        </div>
        <div style={sectionCardStyle}>
          <h2 style={sectionTitleStyle}>{t('Units by Category')}</h2>
          <Doughnut data={metrics.doughData} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12, alignItems: 'start' }}>
        <div style={sectionCardStyle}>
          <div style={miniStatLabelStyle}>{t('Revenue')}</div>
          <div style={miniStatValueStyle}>{maskRevenue(metrics.last30Revenue)}</div>
          <div style={{ ...bodyMutedStyle, marginTop: 6 }}>{t('COGS')}: {maskProfit(metrics.last30Cost)}</div>
          <div style={{ ...bodyMutedStyle, marginTop: 2 }}>{t('Profit')}: {maskProfit(metrics.last30Profit)}</div>
        </div>
        <div style={sectionCardStyle}>
          <div style={miniStatLabelStyle}>{t('Expenses')}</div>
          <div style={miniStatValueStyle}>{maskProfit(finance.expenseTotal)}</div>
          <div style={{ ...bodyMutedStyle, marginTop: 6 }}>{t('Projection')}: {maskProfit(finance.projected30)}</div>
        </div>
        <div style={sectionCardStyle}>
          <div style={miniStatLabelStyle}>{t('Cashflow')}</div>
          <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...bodyMutedStyle }}><span>{t('Inflow')}</span><strong style={{ color: '#0f172a', fontWeight: 800 }}>{maskRevenue(metrics.last30Revenue)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...bodyMutedStyle }}><span>{t('Outflow')}</span><strong style={{ color: '#0f172a', fontWeight: 800 }}>{maskProfit(finance.expenseTotal)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...bodyMutedStyle }}><span>{t('Net')}</span><strong style={{ color: '#0f172a', fontWeight: 800 }}>{maskProfit(finance.net)}</strong></div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12, alignItems: 'start' }}>
        <div style={sectionCardStyle}>
          <h2 style={sectionTitleStyle}>{t('Top Products (Units)')}</h2>
          <div style={{ height: 190 }}>
            <Bar data={metrics.topBar} options={metrics.barOptions} />
          </div>
        </div>
        <div style={sectionCardStyle}>
          <h2 style={sectionTitleStyle}>{t('Payments by Day (Selected Range)')}</h2>
          <div style={{ height: 190 }}>
            <Bar data={metrics.paymentBar} options={metrics.stackedOptions} />
          </div>
        </div>
      </div>
      <div style={{ ...sectionCardStyle, marginTop: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <div>
            <h2 style={sectionTitleStyle}>{t('Customer Leaderboard (Top 10)')}</h2>
            <div style={{ ...bodyMutedStyle, marginTop: 4 }}>
              {t('Ranked by the current dashboard filters.')}
            </div>
          </div>
          <label style={{ minWidth: 220 }}>
            <div style={fieldLabelStyle}>{t('Rank By')}</div>
            <select className="select" value={customerLeaderboardMode} onChange={e => setCustomerLeaderboardMode(e.target.value)}>
              <option value="amount">{t('Amount Spent')}</option>
              <option value="products">{t('Products Bought')}</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}>
          <div style={{ height: 240 }}>
            <Bar
              data={customerLeaderboardChart}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => {
                        const raw = ctx.parsed?.y ?? ctx.parsed?.x ?? 0;
                        if (customerLeaderboardMode === 'products') return `${ctx.label || t('Customer')}: ${raw} ${t('Products Bought').toLowerCase()}`;
                        return canViewRevenue ? `${ctx.label || t('Customer')}: ${formatCurrency(raw, settings)}` : `${ctx.label || t('Customer')}: ***`;
                      }
                    }
                  }
                },
                scales: {
                  x: {
                    ticks: {
                      color: chartTextColor,
                      font: { size: 11, weight: '600' },
                      autoSkip: false,
                      maxRotation: 40,
                      minRotation: 40
                    },
                    grid: { display: false }
                  },
                  y: {
                    beginAtZero: true,
                    ticks: {
                      color: chartTextColor,
                      font: { size: 12, weight: '600' },
                      callback: (value) => (customerLeaderboardMode === 'products' || canViewRevenue ? value : '***')
                    },
                    grid: { color: chartGridColor }
                  }
                }
              }}
            />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th align="left" style={tableHeaderStyle}>#</th>
                  <th align="left" style={tableHeaderStyle}>{t('Customer')}</th>
                  <th align="left" style={tableHeaderStyle}>{t('Sales')}</th>
                  <th align="left" style={tableHeaderStyle}>{t('Products')}</th>
                  <th align="left" style={tableHeaderStyle}>{t('Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {customerLeaderboard.map((row, idx) => (
                  <tr key={row.key}>
                    <td style={tableCellStyle}>{idx + 1}</td>
                    <td style={tableCellStyle}>{row.customerName}</td>
                    <td style={tableCellStyle}>{row.sales}</td>
                    <td style={tableCellStyle}>{row.products}</td>
                    <td style={tableCellStyle}>{maskRevenue(row.amount)}</td>
                  </tr>
                ))}
                {customerLeaderboard.length === 0 && <tr><td colSpan="5" style={{ padding: 12, ...bodyMutedStyle }}>{t('No customer data')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {(canViewCashierCompetitionAssigned || canViewCashierCompetitionAll) && (
      <div style={{ ...sectionCardStyle, marginTop: 12 }}>
        <h2 style={sectionTitleStyle}>{t('Cashier Performance (Filtered Revenue)')}</h2>
        <div style={{ height: 210 }}>
          <Bar
            data={metrics.cashierBar}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              indexAxis: 'y',
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx) => {
                      const raw = ctx.parsed?.x ?? ctx.parsed?.y ?? 0;
                      if (!canViewRevenue) return '***';
                      return `${ctx.label || t('Cashier')}: ${formatCurrency(raw, settings)}`;
                    }
                  }
                }
              },
              scales: {
                x: {
                  ticks: {
                    color: chartTextColor,
                    font: { size: 12, weight: '600' },
                    callback: (value) => (canViewRevenue ? value : '***')
                  },
                  grid: { color: chartGridColor }
                },
                y: {
                  ticks: { color: chartTextColor, font: { size: 12, weight: '700' } },
                  grid: { display: false }
                }
              }
            }}
          />
        </div>
      </div>
      )}
    </div>
  );
}

export default DashboardPage;
