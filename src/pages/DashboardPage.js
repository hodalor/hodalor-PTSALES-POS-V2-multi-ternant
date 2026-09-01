import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { formatCurrency } from '../utils/currency';
import { Chart, BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend, Filler } from 'chart.js';
import * as expensesApi from '../api/expenses';
import { getCashReconciliationSummary } from '../api/cashReconciliations';
import { isFeatureEnabled } from '../utils/featureFlags';
import BranchSelect from '../components/BranchSelect';
import LoadingDots from '../components/LoadingDots';
import { useAppLanguage } from '../utils/localization';
import { buildRefundAdjustedSaleMetrics, getRefundReturnedValue, getSaleActivityType, getSalePaymentTimeline, getSaleRangeTotals, saleHasActivityInRange } from '../utils/saleAccounting';

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

function matchesDashboardActivityFilter(sale, filter) {
  const activityType = getDashboardSaleActivityType(sale);
  switch (String(filter || 'all').trim().toLowerCase()) {
    case 'all_sales':
      return activityType === 'retail_sales' || activityType === 'wholesale_sales' || activityType === 'warehouse_sales';
    case 'all_credit':
      return activityType === 'retail_credit' || activityType === 'wholesale_credit' || activityType === 'warehouse_credit';
    case 'retail_sales':
    case 'retail_credit':
    case 'wholesale_sales':
    case 'wholesale_credit':
    case 'warehouse_sales':
    case 'warehouse_credit':
      return activityType === String(filter || '').trim().toLowerCase();
    case 'all':
    default:
      return true;
  }
}

function isCreditOnlyDashboardFilter(filter) {
  const normalized = String(filter || 'all').trim().toLowerCase();
  return normalized === 'all_credit' || normalized === 'retail_credit' || normalized === 'wholesale_credit' || normalized === 'warehouse_credit';
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
  const hasAllAssignedBranches = auth.user?.assignedBranches === 'all';
  const isMasterSuperAdmin = roleLower === 'superadmin' && String(auth.user?.tenantId || '').toLowerCase() === 'master';
  const isPrivilegedDashboardViewer = isMasterSuperAdmin || roleLower === 'admin';
  const canViewRevenue = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_revenue') || grants.includes('view_financials');
  const canViewProfit = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_profit') || grants.includes('view_financials');
  const canViewCashierCompetitionAll = isPrivilegedDashboardViewer || (hasAllAssignedBranches && grants.includes('view_dashboard_cashier_all'));
  const canViewCashierCompetitionAssigned = canViewCashierCompetitionAll || grants.includes('view_dashboard_cashier_assigned') || (!hasAllAssignedBranches && grants.includes('view_dashboard_cashier_all'));
  const canViewBranchCompetitionAll = isPrivilegedDashboardViewer || (hasAllAssignedBranches && grants.includes('view_dashboard_branch_comparison_all'));
  const canViewBranchCompetitionAssigned = canViewBranchCompetitionAll || grants.includes('view_dashboard_branch_comparison_assigned') || (!hasAllAssignedBranches && grants.includes('view_dashboard_branch_comparison_all'));
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
    activityFilter: String(activityFilter || 'all'),
    periodMode,
    from: periodMode === 'all_time' ? '' : (dateFrom || defaultFromIso),
    to: periodMode === 'all_time' ? '' : (dateTo || todayIso)
  }), [activityFilter, dateFrom, dateTo, defaultFromIso, financeSummaryBranchId, periodMode, todayIso]);

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
          activityFilter: activityFilter || 'all',
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
  }, [activityFilter, canUseFinanceReconciliation, dateFrom, dateTo, defaultFromIso, financeSummaryBranchId, financeSummaryRequestKey, periodMode, todayIso]);

  const chartTextColor = '#475569';
  const chartGridColor = '#e2e8f0';
  const chartLegendStyle = useMemo(() => ({
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
  }), [chartTextColor]);

  const metrics = useMemo(() => {
    const selectedFrom = periodMode === 'all_time' ? null : startOfLocalDay(dateFrom || defaultFromIso);
    const selectedTo = periodMode === 'all_time' ? null : endOfLocalDay(dateTo || todayIso);
    const salesById = new Map(sales.map((sale) => [String(sale?.id || sale?._id || sale?.clientId || ''), sale]));
    const branchSales = sales.filter((s) => matchBranch(s.branchId));
    const filteredSales = branchSales.filter((s) => matchesDashboardActivityFilter(s, activityFilter));
    const createdSales = filteredSales.filter((s) => !isRefundSale(s) && isDateInRange(s.created_at, selectedFrom, selectedTo));
    const activitySales = filteredSales.filter((s) => !isRefundSale(s) && saleHasActivityInRange(s, selectedFrom, selectedTo));
    const approvedRefundsForSalesMath = refunds.filter((refund) => {
      if (String(refund?.status || '').trim().toLowerCase() !== 'approved') return false;
      if (!matchBranch(refund?.branchId)) return false;
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
    let warehouseCreditOut = 0;
    let totalCreditRecovered = 0;
    let retailCreditRecovered = 0;
    let wholesaleCreditRecovered = 0;
    let warehouseCreditRecovered = 0;
    let approvedRefundItems = 0;
    const perDay = {};
    const perDayPayments = {}; // { 'YYYY-MM-DD': { cash: x, card: y, ... } }
    const categoryTotals = {};
    const productUnits = {}; // sku -> qty
    const cashierMap = new Map();
    const customerMap = new Map();
    const productProfit = new Map();
    const approvedFullRefundSaleIds = new Set();
    const refundAdjustedSales = buildRefundAdjustedSaleMetrics(
      filteredSales.filter((sale) => !isRefundSale(sale)),
      approvedRefundsForSalesMath,
      selectedFrom,
      selectedTo
    );
    const approvedRefundAmountInRange = refundAdjustedSales.approvedRefundAmountInRange;
    const recognizedRefundRevenueImpact = refundAdjustedSales.recognizedRefundRevenueImpact;
    const getSaleAdjustment = (sale) => {
      const saleId = String(sale?.id || sale?._id || sale?.clientId || '').trim();
      return refundAdjustedSales.bySaleId.get(saleId) || null;
    };
    const getAdjustedSaleRangeTotals = (sale) => {
      const adjustment = getSaleAdjustment(sale);
      if (!adjustment) return getSaleRangeTotals(sale, selectedFrom, selectedTo);
      return {
        revenue: Number(adjustment.adjustedRevenue || 0),
        profit: Number(adjustment.adjustedProfit || 0),
        cost: Number(adjustment.adjustedCost || 0),
        payments: 0
      };
    };
    const getSaleRevenueScale = (sale, rangeFrom = selectedFrom, rangeTo = selectedTo) => {
      const adjustment = getSaleAdjustment(sale);
      if (adjustment) {
        const baseRevenue = Number(adjustment.baseRevenue || 0);
        if (baseRevenue <= 0) return 0;
        return Math.max(0, Math.min(1, Number(adjustment.adjustedRevenue || 0) / Math.max(0.0001, baseRevenue)));
      }
      const fallbackTotals = getSaleRangeTotals(sale, rangeFrom, rangeTo);
      return Number(fallbackTotals.revenue || 0) > 0 ? 1 : 0;
    };
    const activitySaleSummaries = activitySales
      .map((sale) => ({ sale, totals: getAdjustedSaleRangeTotals(sale) }))
      .filter(({ totals }) => totals.revenue !== 0 || totals.profit !== 0 || totals.cost !== 0);
    const competitionSaleSummaries = competitionSales
      .map((sale) => ({ sale, totals: getAdjustedSaleRangeTotals(sale) }))
      .filter(({ totals }) => totals.revenue !== 0 || totals.profit !== 0 || totals.cost !== 0);
    const buildNetRevenuePerDay = (rangeFrom = null, rangeTo = null) => {
      const totalsByDay = {};
      for (const sale of filteredSales) {
        if (isRefundSale(sale)) continue;
        const revenueScale = getSaleRevenueScale(sale, rangeFrom, rangeTo);
        if (revenueScale <= 0) continue;
        const timeline = getSalePaymentTimeline(sale);
        timeline.forEach((event) => {
          const paidAt = new Date(event?.paidAt || 0);
          if (Number.isNaN(paidAt.getTime())) return;
          if (rangeFrom && paidAt.getTime() < rangeFrom.getTime()) return;
          if (rangeTo && paidAt.getTime() > rangeTo.getTime()) return;
          const day = formatLocalDateKey(paidAt);
          if (!day) return;
          const adjustedAmount = Math.max(0, Number(event?.amount || 0) * revenueScale);
          totalsByDay[day] = (totalsByDay[day] || 0) + adjustedAmount;
        });
      }
      return totalsByDay;
    };
    for (const sale of filteredSales) {
      const outstandingCredit = Number(sale.outstandingTotal || sale.outstandingBalance || 0);
      const creditMode = String(sale.creditMode || '').trim().toLowerCase();
      creditOut += outstandingCredit;
      if (creditMode === 'retail_easybuy') {
        retailCreditOut += outstandingCredit;
      } else if (creditMode === 'distribution_credit' && String(sale.posType || sale.inventoryType || 'retail').trim().toLowerCase() === 'warehouse') {
        warehouseCreditOut += outstandingCredit;
      } else if (creditMode === 'distribution_credit') {
        wholesaleCreditOut += outstandingCredit;
      }
    }
    for (const { sale, totals: recognized } of activitySaleSummaries) {
      if (recognized.revenue === 0 && recognized.profit === 0 && recognized.cost === 0) continue;
      const creditMode = String(sale.creditMode || '').trim().toLowerCase();
      if (creditMode === 'retail_easybuy') {
        retailCreditRecovered += recognized.revenue;
        totalCreditRecovered += recognized.revenue;
      } else if (creditMode === 'distribution_credit' && String(sale.posType || sale.inventoryType || 'retail').trim().toLowerCase() === 'warehouse') {
        warehouseCreditRecovered += recognized.revenue;
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
    for (const refund of approvedRefundsForSalesMath) {
      const refundType = String(refund?.type || '').trim().toLowerCase();
      const originalSale = salesById.get(String(refund?.saleId || ''));
      if (!originalSale) continue;
      const saleId = String(originalSale?.id || originalSale?._id || originalSale?.clientId || '').trim();
      const originalSaleCreatedInRange = isDateInRange(originalSale.created_at, selectedFrom, selectedTo);
      const originalItems = Array.isArray(originalSale?.items) ? originalSale.items : [];
      const refundItems = Array.isArray(refund?.restockItems) ? refund.restockItems : [];
      const refundReturnedValue = getRefundReturnedValue(refund, originalSale);
      let refundItemQty = 0;
      const customerKey = String(originalSale?.customerId || '').trim()
        || String(originalSale?.customerCode || '').trim()
        || String(originalSale?.customerName || '').trim().toLowerCase();
      if (originalSaleCreatedInRange && refundItems.length > 0) {
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
          const itemSku = String(refundItem?.sku || matchedOriginal?.sku || '').trim();
          const itemProductId = String(refundItem?.productId || matchedOriginal?.productId || '').trim();
          const itemVariantId = String(refundItem?.variantId || matchedOriginal?.variantId || '').trim();
          const cat = String(matchedProduct?.category || categoryBySku.get(itemSku) || '').trim() || t('Uncategorized');
          categoryTotals[cat] = Math.max(0, Number(categoryTotals[cat] || 0) - qty);
          if (itemSku) productUnits[itemSku] = Math.max(0, Number(productUnits[itemSku] || 0) - qty);
          const productKey = `${itemProductId}:${itemVariantId}`;
          if (productProfit.has(productKey)) {
            const row = productProfit.get(productKey);
            const matchedPrice = Number(matchedOriginal?.price || refundReturnedValue || 0);
            row.units = Math.max(0, Number(row.units || 0) - qty);
            row.revenue -= qty * matchedPrice;
            row.cost -= qty * (Number.isFinite(costPrice) ? costPrice : 0);
            row.profit = row.revenue - row.cost;
          }
          if (customerKey && customerMap.has(customerKey)) {
            customerMap.get(customerKey).products = Math.max(0, Number(customerMap.get(customerKey).products || 0) - qty);
          }
        });
      } else if (originalSaleCreatedInRange && refundType === 'full' && originalSale) {
        refundItemQty = originalItems.reduce((sum, item) => sum + Math.max(0, Number(item?.qty || 0)), 0);
        originalItems.forEach((item) => {
          const qty = Math.max(0, Number(item?.qty || 0));
          if (qty <= 0) return;
          const itemSku = String(item?.sku || '').trim();
          const cat = String(categoryBySku.get(itemSku) || '').trim() || t('Uncategorized');
          categoryTotals[cat] = Math.max(0, Number(categoryTotals[cat] || 0) - qty);
          if (itemSku) productUnits[itemSku] = Math.max(0, Number(productUnits[itemSku] || 0) - qty);
          const productKey = `${String(item?.productId || '')}:${String(item?.variantId || '')}`;
          if (productProfit.has(productKey)) {
            const row = productProfit.get(productKey);
            row.units = Math.max(0, Number(row.units || 0) - qty);
            row.revenue -= qty * Number(item?.price || 0);
            row.cost -= qty * Number(item?.costPrice || 0);
            row.profit = row.revenue - row.cost;
          }
          if (customerKey && customerMap.has(customerKey)) {
            customerMap.get(customerKey).products = Math.max(0, Number(customerMap.get(customerKey).products || 0) - qty);
          }
        });
      }
      approvedRefundItems += refundItemQty;
      if (refundType === 'full' && originalSale && isDateInRange(originalSale.created_at, selectedFrom, selectedTo)) {
        approvedFullRefundSaleIds.add(saleId);
      }
    }
    for (const sale of activitySales) {
      const timeline = Array.isArray(sale.paymentTimeline) ? sale.paymentTimeline : [];
      const salePaidAt = new Date(sale.created_at || sale.saleCapturedAt || sale.recordedAt || 0);
      const saleDay = Number.isNaN(salePaidAt.getTime()) ? '' : formatLocalDateKey(salePaidAt);
      const saleDayInRange = saleDay && (!selectedFrom || salePaidAt.getTime() >= selectedFrom.getTime()) && (!selectedTo || salePaidAt.getTime() <= selectedTo.getTime());
      const recordedMethods = Array.isArray(sale.payment_methods) ? sale.payment_methods : [];
      let saleDayAmountCaptured = 0;
      const revenueScale = getSaleRevenueScale(sale, selectedFrom, selectedTo);
      if (revenueScale <= 0) continue;
      timeline.forEach((event) => {
        const paidAt = new Date(event.paidAt || 0);
        if (Number.isNaN(paidAt.getTime())) return;
        if (selectedFrom && paidAt.getTime() < selectedFrom.getTime()) return;
        if (selectedTo && paidAt.getTime() > selectedTo.getTime()) return;
        const day = formatLocalDateKey(paidAt);
        const eventAmount = Math.max(0, Number(event.amount || 0) * revenueScale);
        perDay[day] = (perDay[day] || 0) + eventAmount;
        if (event.source === 'credit_repayment') {
          addPaymentBreakdown(perDayPayments, day, event.paymentMethod || 'cash', eventAmount);
          return;
        }
        if (day === saleDay) saleDayAmountCaptured += eventAmount;
      });
      if (saleDayInRange) {
        if (recordedMethods.length > 0) {
          recordedMethods.forEach((methodRow) => addPaymentBreakdown(perDayPayments, saleDay, methodRow?.type, Math.max(0, Number(methodRow?.amount || 0) * revenueScale)));
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
    const revenueChartFrom = periodMode === 'all_time' ? null : startOfLocalDay(revenueChartFromIso);
    const revenueChartTo = periodMode === 'all_time' ? null : endOfLocalDay(revenueChartToIso);
    const revenuePerDay = buildNetRevenuePerDay(revenueChartFrom, revenueChartTo);
    for (const { sale, totals } of competitionSaleSummaries) {
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
    last30Revenue = activitySaleSummaries.reduce((sum, { totals }) => sum + Number(totals.revenue || 0), 0);
    last30Profit = activitySaleSummaries.reduce((sum, { totals }) => sum + Number(totals.profit || 0), 0);
    last30Cost = activitySaleSummaries.reduce((sum, { totals }) => sum + Number(totals.cost || 0), 0);
    itemsSold = Math.max(0, itemsSold - approvedRefundItems);
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
      transactionCount: Math.max(0, createdSales.length - approvedFullRefundSaleIds.size),
      creditOut,
      retailCreditOut,
      wholesaleCreditOut,
      warehouseCreditOut,
      totalCreditRecovered,
      retailCreditRecovered,
      wholesaleCreditRecovered,
      warehouseCreditRecovered,
      approvedRefundAmount: approvedRefundAmountInRange,
      recognizedRefundRevenueImpact,
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
  }, [sales, refunds, products, branches, dateFrom, dateTo, matchBranch, matchCompetitionBranch, defaultFromIso, defaultRevenueChartFromIso, todayIso, periodMode, activityFilter, t, chartLegendStyle]);

  const finance = useMemo(() => {
    const expenseTotal = expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const net = metrics.last30Revenue - expenseTotal;
    const projected30 = net;
    return { expenseTotal, net, projected30 };
  }, [expenses, metrics.last30Revenue]);
  const creditOnlyDashboardView = useMemo(() => isCreditOnlyDashboardFilter(activityFilter), [activityFilter]);
  const pendingDepositValue = useMemo(() => {
    if (creditOnlyDashboardView) return 0;
    return Math.max(0, Number(financeSummary.awaitingAmount || 0));
  }, [creditOnlyDashboardView, financeSummary.awaitingAmount]);

  function maskRevenue(value) {
    return canViewRevenue ? formatCurrency(value, settings) : '******';
  }

  function maskProfit(value) {
    return canViewProfit ? formatCurrency(value, settings) : '******';
  }

  function maskProfitText(value) {
    return canViewProfit ? value : '***';
  }

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
    { key: 'warehouse_credit_out', label: t('Warehouse Credit Sales'), value: maskRevenue(metrics.warehouseCreditOut), subtitle: t('Outstanding warehouse credit balance'), accent: '#4338ca', tint: '#e0e7ff', badge: 'WHC' },
    { key: 'retail_credit_recovered', label: t('Retail Credit Repayment'), value: maskRevenue(metrics.retailCreditRecovered), subtitle: periodMode === 'all_time' ? t('All retail credit repayments received') : t('Retail credit repayments in selected range'), accent: '#22c55e', tint: '#dcfce7', badge: 'RR' },
    { key: 'wholesale_credit_recovered', label: t('Wholesale Credit Repayment'), value: maskRevenue(metrics.wholesaleCreditRecovered), subtitle: periodMode === 'all_time' ? t('All wholesale credit repayments received') : t('Wholesale credit repayments in selected range'), accent: '#a855f7', tint: '#f3e8ff', badge: 'WR' },
    { key: 'warehouse_credit_recovered', label: t('Warehouse Credit Repayment'), value: maskRevenue(metrics.warehouseCreditRecovered), subtitle: periodMode === 'all_time' ? t('All warehouse credit repayments received') : t('Warehouse credit repayments in selected range'), accent: '#2563eb', tint: '#dbeafe', badge: 'WHR' },
    { key: 'transactions', label: t('Sales Count'), value: metrics.transactionCount, subtitle: t('Sales created in selected range'), accent: '#f59e0b', tint: '#fef3c7', badge: 'TX' },
    { key: 'margin', label: t('Margin'), value: maskProfitText(`${metrics.marginPct}%`), subtitle: t('Gross margin percentage'), accent: '#ec4899', tint: '#fce7f3', badge: 'MG' },
    { key: 'refunded', label: t('Refunded'), value: maskRevenue(metrics.approvedRefundAmount), subtitle: periodMode === 'all_time' ? t('Approved refunds for all time') : t('Approved refunds in selected range'), accent: '#dc2626', tint: '#fee2e2', badge: 'RF' }
  ].filter((card) => !card.hidden);
  const primarySummaryCards = summaryCards.filter((card) => card.primary);
  const secondarySummaryCards = summaryCards.filter((card) => !card.primary);
  const renderSummaryCard = (card) => (
    <div
      key={card.key}
      className="dashboard-card"
      style={{ '--accent': card.accent, '--accent-soft': card.tint }}
    >
      <div className="dashboard-card-top">
        <div className="dashboard-card-copy">
          <div className="dashboard-card-label">{card.label}</div>
          <div className="dashboard-card-value">
            {card.loading ? (
              <LoadingDots label={t('Loading finance summary')} />
            ) : card.value}
          </div>
        </div>
        <div className="dashboard-card-badge">{card.badge}</div>
      </div>
      <div className="dashboard-card-rail" />
    </div>
  );
  return (
    <div className="dashboard-shell">
      <div className="dashboard-header">
        <div className="dashboard-header-copy">
          <div className="ui-eyebrow">{t('Executive Overview')}</div>
          <h1 className="dashboard-title">{t('Dashboard')}</h1>
          <p className="dashboard-subtitle">
            {t('Track revenue, credit, refunds, deposits, and branch performance from one calm operational view.')}
          </p>
        </div>
      </div>
      <div className="card dashboard-filter-card">
        <div className="dashboard-filter-grid">
          <label className="dashboard-filter-field">
            <div className="dashboard-filter-label">{t('Period')}</div>
            <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
              <option value="range">{t('Custom Range')}</option>
              <option value="all_time">{t('All Time')}</option>
            </select>
          </label>
          <label className="dashboard-filter-field">
            <div className="dashboard-filter-label">{t('From')}</div>
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label className="dashboard-filter-field">
            <div className="dashboard-filter-label">{t('To')}</div>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label className="dashboard-filter-field">
            <div className="dashboard-filter-label">{t('Activity')}</div>
            <select className="select" value={activityFilter} onChange={e => setActivityFilter(e.target.value)}>
              <option value="all">{t('All Sales & Credit')}</option>
              <option value="all_sales">{t('All Sales')}</option>
              <option value="all_credit">{t('All Credit')}</option>
              <option value="retail_sales">{t('Retail Sales')}</option>
              <option value="retail_credit">{t('Retail Credit')}</option>
              <option value="wholesale_sales">{t('Wholesale Sales')}</option>
              <option value="wholesale_credit">{t('Wholesale Credit')}</option>
              <option value="warehouse_sales">{t('Warehouse Sales')}</option>
              <option value="warehouse_credit">{t('Warehouse Credit')}</option>
            </select>
          </label>
          <label className="dashboard-filter-field">
            <div className="dashboard-filter-label">{t('Branch')}</div>
            <BranchSelect
              value={branchId}
              onChange={setBranchId}
              includeAll={canViewCashierCompetitionAll || canViewBranchCompetitionAll || (canUseScopedDashboardBranches && dashboardBranchOptions.length > 1)}
              allLabel={canViewCashierCompetitionAll || canViewBranchCompetitionAll ? t('All Branches') : t('Assigned Branches')}
              overrideBranches={dashboardBranchOptions}
            />
          </label>
        </div>
      </div>
      <div className="summary-grid">
        {primarySummaryCards.map(renderSummaryCard)}
      </div>
      {secondarySummaryCards.length > 0 && (
        <div className="dashboard-summary-toggle">
          <button
            type="button"
            className="btn"
            onClick={() => setShowMoreSummaryCards((prev) => !prev)}
          >
            <span className="dashboard-toggle-icon">
              {showMoreSummaryCards ? '-' : '+'}
            </span>
            {showMoreSummaryCards ? t('Hide More Summary Cards') : t('Show More Summary Cards')}
          </button>
        </div>
      )}
      {showMoreSummaryCards && secondarySummaryCards.length > 0 && (
        <div className="summary-grid">
          {secondarySummaryCards.map(renderSummaryCard)}
        </div>
      )}
      <div className="dashboard-grid-2">
        <div className="dashboard-section-card">
          <div className="dashboard-section-head">
            <div>
              <h2 className="dashboard-section-title">{metrics.revenueLineTitle}</h2>
              <p className="dashboard-section-note">{t('Net recognized revenue after approved refund impact.')}</p>
            </div>
          </div>
          <div className="dashboard-chart-tall">
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
        <div className="dashboard-section-card">
          <div className="dashboard-section-head">
            <div>
              <h2 className="dashboard-section-title">{t('Units by Category')}</h2>
              <p className="dashboard-section-note">{t('Sales mix for the current dashboard selection.')}</p>
            </div>
          </div>
          <Doughnut data={metrics.doughData} />
        </div>
      </div>
      <div className="dashboard-mini-grid">
        <div className="dashboard-section-card">
          <div className="dashboard-mini-label">{t('Revenue')}</div>
          <div className="dashboard-mini-value">{maskRevenue(metrics.last30Revenue)}</div>
          <div className="dashboard-mini-meta">{t('COGS')}: {maskProfit(metrics.last30Cost)}</div>
          <div className="dashboard-mini-meta" style={{ marginTop: 2 }}>{t('Profit')}: {maskProfit(metrics.last30Profit)}</div>
        </div>
        <div className="dashboard-section-card">
          <div className="dashboard-mini-label">{t('Expenses')}</div>
          <div className="dashboard-mini-value">{maskProfit(finance.expenseTotal)}</div>
          <div className="dashboard-mini-meta">{t('Projection')}: {maskProfit(finance.projected30)}</div>
        </div>
        <div className="dashboard-section-card">
          <div className="dashboard-mini-label">{t('Cashflow')}</div>
          <div className="dashboard-kv-list">
            <div className="dashboard-kv-row"><span>{t('Inflow')}</span><strong>{maskRevenue(metrics.last30Revenue)}</strong></div>
            <div className="dashboard-kv-row"><span>{t('Outflow')}</span><strong>{maskProfit(finance.expenseTotal)}</strong></div>
            <div className="dashboard-kv-row"><span>{t('Net')}</span><strong>{maskProfit(finance.net)}</strong></div>
          </div>
        </div>
      </div>
      <div className="dashboard-grid-2">
        <div className="dashboard-section-card">
          <div className="dashboard-section-head">
            <div>
              <h2 className="dashboard-section-title">{t('Top Products (Units)')}</h2>
              <p className="dashboard-section-note">{t('Fast view of best-moving items in the current range.')}</p>
            </div>
          </div>
          <div className="dashboard-chart-medium">
            <Bar data={metrics.topBar} options={metrics.barOptions} />
          </div>
        </div>
        <div className="dashboard-section-card">
          <div className="dashboard-section-head">
            <div>
              <h2 className="dashboard-section-title">{t('Payments by Day')}</h2>
              <p className="dashboard-section-note">{t('Cash, card, mobile money, wallet, and other payment mix by day.')}</p>
            </div>
          </div>
          <div className="dashboard-chart-medium">
            <Bar data={metrics.paymentBar} options={metrics.stackedOptions} />
          </div>
        </div>
      </div>
      <div className="dashboard-section-card">
        <div className="dashboard-section-head">
          <div>
            <h2 className="dashboard-section-title">{t('Customer Leaderboard (Top 10)')}</h2>
            <div className="dashboard-section-note">
              {t('Ranked by the current dashboard filters.')}
            </div>
          </div>
          <label className="dashboard-filter-field" style={{ minWidth: 220 }}>
            <div className="dashboard-filter-label">{t('Rank By')}</div>
            <select className="select" value={customerLeaderboardMode} onChange={e => setCustomerLeaderboardMode(e.target.value)}>
              <option value="amount">{t('Amount Spent')}</option>
              <option value="products">{t('Products Bought')}</option>
            </select>
          </label>
        </div>
        <div className="dashboard-table-layout">
          <div className="dashboard-chart-tall">
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
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th align="left">#</th>
                  <th align="left">{t('Customer')}</th>
                  <th align="left">{t('Sales')}</th>
                  <th align="left">{t('Products')}</th>
                  <th align="left">{t('Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {customerLeaderboard.map((row, idx) => (
                  <tr key={row.key}>
                    <td>{idx + 1}</td>
                    <td>{row.customerName}</td>
                    <td>{row.sales}</td>
                    <td>{row.products}</td>
                    <td>{maskRevenue(row.amount)}</td>
                  </tr>
                ))}
                {customerLeaderboard.length === 0 && <tr><td colSpan="5" className="dashboard-table-meta-empty">{t('No customer data')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {(canViewCashierCompetitionAssigned || canViewCashierCompetitionAll) && (
      <div className="dashboard-section-card">
        <div className="dashboard-section-head">
          <div>
            <h2 className="dashboard-section-title">{t('Cashier Performance')}</h2>
            <p className="dashboard-section-note">{t('Filtered revenue by cashier for the active branch scope.')}</p>
          </div>
        </div>
        <div className="dashboard-chart-medium">
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
