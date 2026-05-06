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

Chart.register(BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend, Filler);

function formatLocalDateKey(value) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseInputDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
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
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultFromIso = todayIso;
  const [periodMode, setPeriodMode] = useState('range');
  const [dateFrom, setDateFrom] = useState(defaultFromIso);
  const [dateTo, setDateTo] = useState(todayIso);
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
    (async () => {
      if (!canUseFinanceReconciliation) {
        if (alive) setFinanceSummaryLoading(false);
        if (alive) setFinanceSummary({ depositedAmount: 0, awaitingAmount: 0, pendingApprovalAmount: 0, backlogDays: 0 });
        return;
      }
      try {
        if (alive) setFinanceSummaryLoading(true);
        const data = await getCashReconciliationSummary({
          branchId: financeSummaryBranchId || undefined,
          from: periodMode === 'all_time' ? undefined : (dateFrom || defaultFromIso),
          to: periodMode === 'all_time' ? undefined : (dateTo || todayIso)
        });
        if (!alive) return;
        setFinanceSummary({
          depositedAmount: Number(data?.depositedAmount || 0),
          awaitingAmount: Number(data?.awaitingAmount || 0),
          pendingApprovalAmount: Number(data?.pendingApprovalAmount || 0),
          backlogDays: Number(data?.backlogDays || 0)
        });
        setFinanceSummaryLoading(false);
      } catch {
        if (!alive) return;
        setFinanceSummaryLoading(false);
        setFinanceSummary({ depositedAmount: 0, awaitingAmount: 0, pendingApprovalAmount: 0, backlogDays: 0 });
      }
    })();
    return () => { alive = false; };
  }, [canUseFinanceReconciliation, dateFrom, dateTo, defaultFromIso, financeSummaryBranchId, periodMode, todayIso]);

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
    const sourceSales = sales.filter((s) => matchBranch(s.branchId) && inRange(s.created_at));
    const competitionSales = sales.filter((s) => matchCompetitionBranch(s.branchId) && inRange(s.created_at));
    const branchNameById = new Map(branches.map((branch) => [String(branch.id), branch.name || branch.code || branch.id]));
    let todayTotal = 0;
    let todayProfit = 0;
    let last30Revenue = 0;
    let last30Profit = 0;
    let last30Cost = 0;
    let itemsSold = 0;
    const perDay = {};
    const perDayPayments = {}; // { 'YYYY-MM-DD': { cash: x, card: y, ... } }
    const categoryTotals = {};
    const productUnits = {}; // sku -> qty
    const cashierMap = new Map();
    const customerMap = new Map();
    const productProfit = new Map();
    for (const sale of sourceSales) {
      const day = formatLocalDateKey(sale.created_at);
      if (!day) continue;
      perDay[day] = (perDay[day] || 0) + sale.total;
      perDayPayments[day] = perDayPayments[day] || {};
      (sale.payment_methods || []).forEach(pm => {
        const paymentType = pm.type || 'other';
        perDayPayments[day][paymentType] = (perDayPayments[day][paymentType] || 0) + (pm.amount || 0);
      });
      todayTotal += sale.total;
      todayProfit += Number(sale.profitTotal || 0);
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
        customerRow.sales += 1;
        customerRow.amount += Number(sale.total || 0);
      }
      for (const it of sale.items) {
        itemsSold += it.qty;
        const prod = products.find(p => p.sku === it.sku);
        const cat = prod?.category || t('Uncategorized');
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
        const customerId = String(sale.customerId || '').trim();
        const customerCode = String(sale.customerCode || '').trim();
        const customerName = String(sale.customerName || '').trim();
        const customerLabel = customerName || customerCode || customerId;
        const normalizedCustomerLabel = customerLabel.toLowerCase();
        if (customerLabel && !['walk-in', 'walk in', '—', '-'].includes(normalizedCustomerLabel)) {
          const customerKey = customerId || customerCode || normalizedCustomerLabel;
          const customerRow = customerMap.get(customerKey);
          if (customerRow) customerRow.products += qty;
        }
      }
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
      cashierRow.sales += 1;
      cashierRow.revenue += Number(sale.total || 0);
      cashierRow.profit += Number(sale.profitTotal || 0);
    }
    const filteredDateKeys = sourceSales
      .map((sale) => formatLocalDateKey(sale.created_at))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const daysInRange = periodMode === 'all_time'
      ? Array.from(new Set(filteredDateKeys))
      : enumerateDateKeys(dateFrom || defaultFromIso, dateTo || todayIso);
    const last7 = daysInRange.slice(-7);
    const last30 = daysInRange;
    const lineData = {
      labels: last30,
      datasets: [{
        label: t('Revenue'),
        data: last30.map(d => +(perDay[d] || 0).toFixed(2)),
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
    const last30Sales = sourceSales;
    last30Profit = last30Sales.reduce((s, x) => s + (Number(x.profitTotal) || 0), 0);
    last30Cost = last30Sales.reduce((s, x) => s + (Number(x.costTotal) || 0), 0);
    const marginPct = last30Revenue > 0 ? Math.round((last30Profit / last30Revenue) * 10000) / 100 : 0;
    const paymentTypes = ['cash','card','mobile','wallet','other'];
    const paymentBar = {
      labels: last7,
      datasets: paymentTypes.map((paymentType, idx) => ({
        label: t(paymentType.charAt(0).toUpperCase() + paymentType.slice(1)),
        data: last7.map(d => +(perDayPayments[d]?.[paymentType] || 0).toFixed(2)),
        backgroundColor: ['#2563eb','#14b8a6','#8b5cf6','#f59e0b','#94a3b8'][idx],
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

    return { todayTotal, todayProfit, itemsSold, transactionCount: sourceSales.length, lineData, paymentBar, doughData, topBar, stackedOptions, lineOptions, barOptions, cashierBar, last30Revenue, last30Profit, last30Cost, marginPct, cashierLeaderboard, customerLeaderboardByAmount, customerLeaderboardByProducts, topProfitProducts, multiBranchCashierView };
  }, [sales, products, branches, branchId, dateFrom, dateTo, inRange, matchBranch, matchCompetitionBranch, defaultFromIso, todayIso, periodMode, canUseScopedDashboardBranches, canViewBranchCompetitionAll, canViewCashierCompetitionAll, t]);

  const finance = useMemo(() => {
    const expenseTotal = expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const net = metrics.last30Revenue - expenseTotal;
    const projected30 = net;
    return { expenseTotal, net, projected30 };
  }, [expenses, metrics.last30Revenue]);

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
    const map = new Map();
    for (const s of sales) {
      if (!inRange(s.created_at) || !matchCompetitionBranch(s.branchId)) continue;
      const key = String(s.branchId || '');
      if (!map.has(key)) map.set(key, { branchId: key, name: byId.get(key) || key, revenue: 0, profit: 0, sales: 0 });
      const row = map.get(key);
      row.revenue += Number(s.total) || 0;
      row.profit += Number(s.profitTotal) || 0;
      row.sales += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [sales, branches, inRange, matchCompetitionBranch, canViewBranchCompetitionAssigned, canViewBranchCompetitionAll]);
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
    { key: 'sales', label: t('Sales (Filtered Range)'), value: maskRevenue(metrics.todayTotal), subtitle: periodMode === 'all_time' ? t('All recorded time') : t('Current selected range'), accent: '#2563eb', tint: '#dbeafe', badge: 'SL' },
    { key: 'profit', label: t('Profit (Filtered Range)'), value: maskProfit(metrics.todayProfit), subtitle: canViewProfit ? t('Live profit summary') : t('Profit access masked'), accent: '#7c3aed', tint: '#ede9fe', badge: 'PF' },
    { key: 'items', label: t('Items Sold'), value: metrics.itemsSold, subtitle: t('Units moved in scope'), accent: '#0f766e', tint: '#ccfbf1', badge: 'IT' },
    { key: 'transactions', label: t('Transactions'), value: metrics.transactionCount, subtitle: t('Completed sales count'), accent: '#f59e0b', tint: '#fef3c7', badge: 'TX' },
    { key: 'margin', label: t('Margin'), value: maskProfitText(`${metrics.marginPct}%`), subtitle: t('Gross margin percentage'), accent: '#ec4899', tint: '#fce7f3', badge: 'MG' },
    { key: 'cashflow', label: t('Net Cashflow'), value: maskProfit(finance.net), subtitle: t('Revenue minus expenses'), accent: '#16a34a', tint: '#dcfce7', badge: 'CF' },
    ...(canUseFinanceReconciliation ? [
      { key: 'deposited', label: t('Deposited to Company Account'), value: maskRevenue(financeSummary.depositedAmount), subtitle: financeSummaryLoading ? t('Refreshing finance summary') : t('Approved reconciliations'), accent: '#14b8a6', tint: '#ccfbf1', badge: 'DP', loading: financeSummaryLoading },
      { key: 'awaiting', label: t('Waiting for Deposit'), value: maskRevenue(financeSummary.awaitingAmount), subtitle: financeSummaryLoading ? t('Refreshing finance summary') : t('Backlog days: {count}', { count: financeSummary.backlogDays }), accent: '#ef4444', tint: '#fee2e2', badge: 'WD', loading: financeSummaryLoading }
    ] : [])
  ];
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
      <div className="summary-grid" style={{ marginBottom: 12, gap: 12 }}>
        {summaryCards.map((card) => (
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
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, alignItems: 'start' }}>
        <div style={sectionCardStyle}>
          <h2 style={sectionTitleStyle}>{t('Revenue (Selected Range)')}</h2>
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
