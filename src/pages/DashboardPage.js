import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { formatCurrency } from '../utils/currency';
import { Chart, BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend, Filler } from 'chart.js';
import * as expensesApi from '../api/expenses';
import { listOperations } from '../api/wholesale';
import { isFeatureEnabled } from '../utils/featureFlags';
import BranchSelect from '../components/BranchSelect';

Chart.register(BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend, Filler);

function DashboardPage() {
  const sales = useSelector(s => s.sales.sales);
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
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
  const canUseExpenses = isFeatureEnabled(settings, 'modules.expenses') && (
    roleLower === 'superadmin' ||
    roleLower === 'admin' ||
    (Array.isArray(auth.grants) && ['view_expenses', 'see_expenses', 'add_expenses'].some((key) => auth.grants.includes(key)))
  );
  const [expenses, setExpenses] = useState([]);
  const [warehousePending, setWarehousePending] = useState(0);
  const [wholesalePending, setWholesalePending] = useState(0);
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultFromIso = new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10);
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
  const [branchId, setBranchId] = useState(() => (
    isPrivilegedDashboardViewer || canUseScopedDashboardBranches
      ? ''
      : (settings.currentBranchId || '')
  ));
  const dashboardScopeModeRef = useRef('');

  useEffect(() => {
    const nextScopeMode = isPrivilegedDashboardViewer
      ? 'all'
      : (canUseScopedDashboardBranches ? 'scoped' : 'current');
    if (dashboardScopeModeRef.current !== nextScopeMode) {
      dashboardScopeModeRef.current = nextScopeMode;
      setBranchId(nextScopeMode === 'current' ? (settings.currentBranchId || '') : '');
      return;
    }
    if (isPrivilegedDashboardViewer) return;
    if (!canUseScopedDashboardBranches) {
      setBranchId(settings.currentBranchId || '');
      return;
    }
    const current = String(branchId || '').trim();
    if (!current) return;
    if (!allowedDashboardBranchIdSet.has(current)) {
      setBranchId(allowedDashboardBranchIds[0] || settings.currentBranchId || '');
    }
  }, [allowedDashboardBranchIdSet, allowedDashboardBranchIds, branchId, canUseScopedDashboardBranches, isPrivilegedDashboardViewer, settings.currentBranchId]);

  const inRange = useCallback((iso) => {
    if (periodMode === 'all_time') return true;
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return false;
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : -Infinity;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : Infinity;
    return ts >= fromTs && ts <= toTs;
  }, [dateFrom, dateTo, periodMode]);
  const matchBranch = useCallback((value) => {
    const key = String(value || '').trim();
    if (canViewCashierCompetitionAll || canViewBranchCompetitionAll) {
      if (!branchId) return true;
      return key === String(branchId || '').trim();
    }
    if (canUseScopedDashboardBranches) {
      if (!branchId) return allowedDashboardBranchIdSet.has(key);
      return key === String(branchId || '').trim();
    }
    return key === String(settings.currentBranchId || '').trim();
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

  const metrics = useMemo(() => {
    const sourceSales = sales.filter((s) => matchBranch(s.branchId) && inRange(s.created_at));
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
      const day = new Date(sale.created_at).toISOString().slice(0, 10);
      perDay[day] = (perDay[day] || 0) + sale.total;
      perDayPayments[day] = perDayPayments[day] || {};
      (sale.payment_methods || []).forEach(pm => {
        const t = pm.type || 'other';
        perDayPayments[day][t] = (perDayPayments[day][t] || 0) + (pm.amount || 0);
      });
      todayTotal += sale.total;
      todayProfit += Number(sale.profitTotal || 0);
      const seller = sale.sellerName || 'Unknown';
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
        const cat = prod?.category || 'Uncategorized';
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
    const filteredDates = sourceSales.map((sale) => new Date(sale.created_at).getTime()).filter((ts) => !Number.isNaN(ts)).sort((a, b) => a - b);
    const start = periodMode === 'all_time'
      ? new Date(filteredDates[0] || Date.now())
      : new Date(`${dateFrom || defaultFromIso}T00:00:00`);
    const end = periodMode === 'all_time'
      ? new Date(filteredDates[filteredDates.length - 1] || Date.now())
      : new Date(`${dateTo || todayIso}T00:00:00`);
    const daysInRange = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 24 * 3600 * 1000) {
      daysInRange.push(new Date(t).toISOString().slice(0, 10));
    }
    const last7 = daysInRange.slice(-7);
    const last30 = daysInRange;
    const lineData = {
      labels: last30,
      datasets: [{
        label: 'Revenue',
        data: last30.map(d => +(perDay[d] || 0).toFixed(2)),
        fill: true,
        tension: 0.35,
        backgroundColor: 'rgba(22,163,74,0.15)',
        borderColor: '#16a34a',
        pointRadius: 0
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
      datasets: paymentTypes.map((t, idx) => ({
        label: t.charAt(0).toUpperCase() + t.slice(1),
        data: last7.map(d => +(perDayPayments[d]?.[t] || 0).toFixed(2)),
        backgroundColor: ['#16a34a','#0ea5e9','#8b5cf6','#f59e0b','#64748b'][idx]
      }))
    };
    const doughLabels = Object.keys(categoryTotals);
    const doughData = {
      labels: doughLabels,
      datasets: [{
        data: doughLabels.map(k => categoryTotals[k]),
        backgroundColor: ['#0ea5e9','#16a34a','#f59e0b','#ef4444','#8b5cf6','#14b8a6']
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
        label: 'Units',
        data: top5.map(x => x.qty),
        backgroundColor: '#0ea5e9'
      }]
    };
    const stackedOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { stacked: true }, y: { stacked: true } }
    };
    const lineOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      interaction: { intersect: false, mode: 'index' },
      scales: { y: { beginAtZero: true } }
    };
    const barOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, indexAxis: 'y' };
    const cashierRows = Array.from(cashierMap.values()).sort((a, b) => b.revenue - a.revenue);
    const multiBranchCashierView = !branchId;
    const cashierTop = cashierRows.slice(0, 6);
    const cashierBar = {
      labels: cashierTop.map((row) => (multiBranchCashierView ? `${row.branchName} • ${row.seller}` : row.seller)),
      datasets: [{ label: 'Revenue', data: cashierTop.map((row) => +(row.revenue || 0).toFixed(2)), backgroundColor: '#16a34a' }]
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
  }, [sales, products, branches, branchId, dateFrom, dateTo, inRange, matchBranch, defaultFromIso, todayIso, periodMode]);

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
      if (!inRange(s.created_at) || !matchBranch(s.branchId)) continue;
      const key = String(s.branchId || '');
      if (!map.has(key)) map.set(key, { branchId: key, name: byId.get(key) || key, revenue: 0, profit: 0, sales: 0 });
      const row = map.get(key);
      row.revenue += Number(s.total) || 0;
      row.profit += Number(s.profitTotal) || 0;
      row.sales += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [sales, branches, inRange, matchBranch, canViewBranchCompetitionAssigned, canViewBranchCompetitionAll]);
  const customerLeaderboard = useMemo(() => (
    customerLeaderboardMode === 'products'
      ? metrics.customerLeaderboardByProducts
      : metrics.customerLeaderboardByAmount
  ), [customerLeaderboardMode, metrics.customerLeaderboardByAmount, metrics.customerLeaderboardByProducts]);
  const customerLeaderboardChart = useMemo(() => {
    const label = customerLeaderboardMode === 'products' ? 'Products Bought' : 'Amount Spent';
    return {
      labels: customerLeaderboard.map((row) => row.customerName),
      datasets: [{
        label,
        data: customerLeaderboard.map((row) => +(customerLeaderboardMode === 'products' ? row.products : row.amount).toFixed(2)),
        backgroundColor: customerLeaderboardMode === 'products' ? '#0ea5e9' : '#2563eb',
        borderRadius: 6,
        maxBarThickness: 28,
        categoryPercentage: 0.7,
        barPercentage: 0.8
      }]
    };
  }, [customerLeaderboard, customerLeaderboardMode]);

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

  return (
    <div style={{ padding: 16 }}>
      <h1>Dashboard</h1>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
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
            <BranchSelect
              value={branchId}
              onChange={setBranchId}
              includeAll={isPrivilegedDashboardViewer || canUseScopedDashboardBranches}
              allLabel={canViewCashierCompetitionAll || canViewBranchCompetitionAll ? 'All Branches' : 'Assigned Branches'}
              overrideBranches={dashboardBranchOptions}
            />
          </label>
        </div>
      </div>
      <div className="summary-grid" style={{ marginBottom: 16 }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Sales (Filtered Range)</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{maskRevenue(metrics.todayTotal)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Profit (Filtered Range)</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{maskProfit(metrics.todayProfit)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Items Sold</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{metrics.itemsSold}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Transactions</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{metrics.transactionCount}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Margin</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{maskProfitText(`${metrics.marginPct}%`)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Net Cashflow</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{maskProfit(finance.net)}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Revenue (Selected Range)</h2>
          <div style={{ height: 260 }}>
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
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Units by Category</h2>
          <Doughnut data={metrics.doughData} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Revenue</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{maskRevenue(metrics.last30Revenue)}</div>
          <div style={{ marginTop: 6, color: '#64748b' }}>COGS: {maskProfit(metrics.last30Cost)}</div>
          <div style={{ marginTop: 2, color: '#64748b' }}>Profit: {maskProfit(metrics.last30Profit)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Expenses</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{maskProfit(finance.expenseTotal)}</div>
          <div style={{ marginTop: 6, color: '#64748b' }}>Projection: {maskProfit(finance.projected30)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Cashflow</div>
          <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Inflow</span><strong>{maskRevenue(metrics.last30Revenue)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Outflow</span><strong>{maskProfit(finance.expenseTotal)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Net</span><strong>{maskProfit(finance.net)}</strong></div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Wholesale Locations</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{wholesaleStats.wholesaleCount}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Wholesale Units</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{wholesaleStats.wholesaleUnits}</div>
          <div style={{ marginTop: 6, color: '#64748b' }}>Pending approvals: {wholesalePending}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Wholesale Low Stock Alerts</h2>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Product</th>
                <th align="left">Wholesale Stock</th>
                <th align="left">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {wholesaleStats.lowStockRows.map(row => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.total}</td>
                  <td>{row.lowStock}</td>
                </tr>
              ))}
              {wholesaleStats.lowStockRows.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>No wholesale low stock alerts</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Warehouse Locations</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{warehouseStats.warehouseCount}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Warehouse Units</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{warehouseStats.warehouseUnits}</div>
          <div style={{ marginTop: 6, color: '#64748b' }}>Pending approvals: {warehousePending}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Warehouse Low Stock Alerts</h2>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Product</th>
                <th align="left">Warehouse Stock</th>
                <th align="left">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {warehouseStats.lowStockRows.map(row => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.total}</td>
                  <td>{row.lowStock}</td>
                </tr>
              ))}
              {warehouseStats.lowStockRows.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>No warehouse low stock alerts</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Top Products (Units)</h2>
          <div style={{ height: 220 }}>
            <Bar data={metrics.topBar} options={metrics.barOptions} />
          </div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Payments by Day (Selected Range)</h2>
          <div style={{ height: 220 }}>
            <Bar data={metrics.paymentBar} options={metrics.stackedOptions} />
          </div>
        </div>
      </div>
      <div style={{ background: '#fff', padding: 16, borderRadius: 12, marginTop: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>Customer Leaderboard (Top 10)</h2>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
              Ranked by the current dashboard filters.
            </div>
          </div>
          <label style={{ minWidth: 220 }}>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Rank By</div>
            <select className="select" value={customerLeaderboardMode} onChange={e => setCustomerLeaderboardMode(e.target.value)}>
              <option value="amount">Amount Spent</option>
              <option value="products">Products Bought</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ height: 280 }}>
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
                        if (customerLeaderboardMode === 'products') return `${ctx.label || 'Customer'}: ${raw} products`;
                        return canViewRevenue ? `${ctx.label || 'Customer'}: ${formatCurrency(raw, settings)}` : `${ctx.label || 'Customer'}: ***`;
                      }
                    }
                  }
                },
                scales: {
                  x: {
                    ticks: {
                      autoSkip: false,
                      maxRotation: 40,
                      minRotation: 40
                    },
                    grid: { display: false }
                  },
                  y: {
                    beginAtZero: true,
                    ticks: {
                      callback: (value) => (customerLeaderboardMode === 'products' || canViewRevenue ? value : '***')
                    }
                  }
                }
              }}
            />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th align="left">#</th>
                  <th align="left">Customer</th>
                  <th align="left">Sales</th>
                  <th align="left">Products</th>
                  <th align="left">Amount</th>
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
                {customerLeaderboard.length === 0 && <tr><td colSpan="5" style={{ padding: 12, color: '#64748b' }}>No customer data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {(canViewCashierCompetitionAssigned || canViewCashierCompetitionAll) && (
      <div style={{ background: '#fff', padding: 16, borderRadius: 12, marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Cashier Performance (Filtered Revenue)</h2>
        <div style={{ height: 240 }}>
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
                      return `${ctx.label || 'Cashier'}: ${formatCurrency(raw, settings)}`;
                    }
                  }
                }
              },
              scales: {
                x: {
                  ticks: {
                    callback: (value) => (canViewRevenue ? value : '***')
                  }
                }
              }
            }}
          />
        </div>
      </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Product Profitability (Top 10)</h2>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Product</th>
                <th align="left">Units</th>
                <th align="left">Profit</th>
              </tr>
            </thead>
            <tbody>
              {metrics.topProfitProducts.map(p => (
                <tr key={p.key}>
                  <td>{p.name}</td>
                  <td>{p.units}</td>
                  <td>{maskProfit(p.profit)}</td>
                </tr>
              ))}
              {metrics.topProfitProducts.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>No data</td></tr>}
            </tbody>
          </table>
        </div>
        {(canViewCashierCompetitionAssigned || canViewCashierCompetitionAll) && (
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Sales Rep Leaderboard (Filtered)</h2>
          <table className="table">
            <thead>
              <tr>
                {metrics.multiBranchCashierView && <th align="left">Branch</th>}
                <th align="left">Seller</th>
                <th align="left">Sales</th>
                <th align="left">Revenue</th>
                <th align="left">Profit</th>
              </tr>
            </thead>
            <tbody>
              {metrics.cashierLeaderboard.map(x => (
                <tr key={x.key}>
                  {metrics.multiBranchCashierView && <td>{x.branchName}</td>}
                  <td>{x.seller}</td>
                  <td>{x.sales}</td>
                  <td>{maskRevenue(x.revenue)}</td>
                  <td>{maskProfit(x.profit)}</td>
                </tr>
              ))}
              {metrics.cashierLeaderboard.length === 0 && <tr><td colSpan={metrics.multiBranchCashierView ? 5 : 4} style={{ padding: 12, color: '#64748b' }}>No data</td></tr>}
            </tbody>
          </table>
        </div>
        )}
      </div>
      {(canViewBranchCompetitionAssigned || canViewBranchCompetitionAll) && (
        <div style={{ background: '#fff', padding: 16, borderRadius: 12, marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Branch Comparison (Filtered)</h2>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Branch</th>
                <th align="left">Sales</th>
                <th align="left">Revenue</th>
                <th align="left">Profit</th>
              </tr>
            </thead>
            <tbody>
              {branchComparison.map(b => (
                <tr key={b.branchId}>
                  <td>{b.name}</td>
                  <td>{b.sales}</td>
                  <td>{maskRevenue(b.revenue)}</td>
                  <td>{maskProfit(b.profit)}</td>
                </tr>
              ))}
              {branchComparison.length === 0 && <tr><td colSpan="4" style={{ padding: 12, color: '#64748b' }}>No data</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default DashboardPage;
