import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { formatCurrency } from '../utils/currency';
import { Chart, BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend, Filler } from 'chart.js';
import * as expensesApi from '../api/expenses';
import { listOperations } from '../api/wholesale';
import { isFeatureEnabled } from '../utils/featureFlags';

Chart.register(BarElement, LineElement, PointElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend, Filler);

function DashboardPage() {
  const sales = useSelector(s => s.sales.sales);
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const roleLower = String(auth.role || '').toLowerCase();
  const canViewFinancials = roleLower === 'superadmin' || roleLower === 'admin' || (Array.isArray(auth.grants) && auth.grants.includes('view_financials'));
  const canUseExpenses = isFeatureEnabled(settings, 'modules.expenses') && (
    roleLower === 'superadmin' ||
    roleLower === 'admin' ||
    (Array.isArray(auth.grants) && ['view_expenses', 'see_expenses', 'add_expenses'].some((key) => auth.grants.includes(key)))
  );
  const [heatMode, setHeatMode] = useState('week'); // day, week, month
  const [expenses, setExpenses] = useState([]);
  const [warehousePending, setWarehousePending] = useState(0);
  const [wholesalePending, setWholesalePending] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!canUseExpenses) {
        if (alive) setExpenses([]);
        return;
      }
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      try {
        const list = await expensesApi.list({ branchId: (roleLower === 'superadmin' || roleLower === 'admin') ? undefined : settings.currentBranchId, from, to });
        if (!alive) return;
        setExpenses(Array.isArray(list) ? list : []);
      } catch {
        if (!alive) return;
        setExpenses([]);
      }
    })();
    return () => { alive = false; };
  }, [settings.currentBranchId, roleLower, canUseExpenses]);

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
    const sourceSales = (roleLower === 'superadmin' || roleLower === 'admin') ? sales : sales.filter(s => s.branchId === settings.currentBranchId);
    const today = new Date().toDateString();
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
    const cashierTotals = {};
    const cashierProfit = {};
    const productProfit = new Map();
    for (const sale of sourceSales) {
      const day = new Date(sale.created_at).toISOString().slice(0, 10);
      perDay[day] = (perDay[day] || 0) + sale.total;
      perDayPayments[day] = perDayPayments[day] || {};
      (sale.payment_methods || []).forEach(pm => {
        const t = pm.type || 'other';
        perDayPayments[day][t] = (perDayPayments[day][t] || 0) + (pm.amount || 0);
      });
      if (new Date(sale.created_at).toDateString() === today) todayTotal += sale.total;
      if (new Date(sale.created_at).toDateString() === today) todayProfit += Number(sale.profitTotal || 0);
      const seller = sale.sellerName || 'Unknown';
      cashierTotals[seller] = (cashierTotals[seller] || 0) + (sale.total || 0);
      cashierProfit[seller] = (cashierProfit[seller] || 0) + (Number(sale.profitTotal || 0));
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
      }
    }
    const last7 = [...new Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    const last30 = [...new Array(30)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      return d.toISOString().slice(0, 10);
    });
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
    const last30Sales = sourceSales.filter(s => last30.includes(new Date(s.created_at).toISOString().slice(0, 10)));
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
    const cashierTop = Object.entries(cashierTotals).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const cashierBar = {
      labels: cashierTop.map(x => x[0]),
      datasets: [{ label: 'Revenue', data: cashierTop.map(x => +(x[1]||0).toFixed(2)), backgroundColor: '#16a34a' }]
    };
    const cashierLeaderboard = Object.entries(cashierTotals)
      .map(([seller, revenue]) => ({ seller, revenue: Number(revenue || 0), profit: Number(cashierProfit[seller] || 0) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    const topProfitProducts = Array.from(productProfit.values()).sort((a, b) => b.profit - a.profit).slice(0, 10);

    const daysBack = heatMode === 'day' ? 1 : heatMode === 'month' ? 30 : 7;
    const end = new Date();
    const start = new Date(end.getTime() - daysBack * 24 * 3600 * 1000);
    const days = [];
    const d0 = new Date(start.toISOString().slice(0, 10));
    const d1 = new Date(end.toISOString().slice(0, 10));
    for (let t = d0.getTime(); t <= d1.getTime(); t += 24 * 3600 * 1000) days.push(new Date(t));
    const grid = days.map(d => ({ day: d.toISOString().slice(0, 10), hours: new Array(24).fill(0) }));
    const idxByDay = new Map(grid.map((r, i) => [r.day, i]));
    for (const s of last30Sales) {
      const dt = new Date(s.created_at);
      const day = dt.toISOString().slice(0, 10);
      const i = idxByDay.get(day);
      if (i == null) continue;
      grid[i].hours[dt.getHours()] += Number(s.total) || 0;
    }
    let max = 0;
    for (const r of grid) for (const v of r.hours) max = Math.max(max, v);

    return { todayTotal, todayProfit, itemsSold, lineData, paymentBar, doughData, topBar, stackedOptions, lineOptions, barOptions, cashierBar, last30Revenue, last30Profit, last30Cost, marginPct, cashierLeaderboard, topProfitProducts, heatmap: { grid, max } };
  }, [sales, products, settings.currentBranchId, roleLower, heatMode]);

  const finance = useMemo(() => {
    const expenseTotal = expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const net = metrics.last30Revenue - expenseTotal;
    const projected30 = net;
    return { expenseTotal, net, projected30 };
  }, [expenses, metrics.last30Revenue]);

  function maskMoney(value) {
    return canViewFinancials ? formatCurrency(value, settings) : '******';
  }

  function maskText(value) {
    return canViewFinancials ? value : '***';
  }

  const branchComparison = useMemo(() => {
    if (!(roleLower === 'admin' || roleLower === 'superadmin')) return [];
    const byId = new Map(branches.map(b => [b.id, b.name || b.code || b.id]));
    const fromTs = Date.now() - 30 * 24 * 3600 * 1000;
    const map = new Map();
    for (const s of sales) {
      const ts = new Date(s.created_at).getTime();
      if (ts < fromTs) continue;
      const key = String(s.branchId || '');
      if (!map.has(key)) map.set(key, { branchId: key, name: byId.get(key) || key, revenue: 0, profit: 0, sales: 0 });
      const row = map.get(key);
      row.revenue += Number(s.total) || 0;
      row.profit += Number(s.profitTotal) || 0;
      row.sales += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [sales, branches, roleLower]);

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Today Sales</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{formatCurrency(metrics.todayTotal, settings)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Today Profit</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{maskMoney(metrics.todayProfit)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Items Sold</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{metrics.itemsSold}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Transactions</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{(String(auth.role||'').toLowerCase()==='superadmin'||String(auth.role||'').toLowerCase()==='admin') ? sales.length : sales.filter(s=>s.branchId===settings.currentBranchId).length}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>30d Margin</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{maskText(`${metrics.marginPct}%`)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>30d Net Cashflow</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{maskMoney(finance.net)}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Revenue (Last 30 days)</h2>
          <div style={{ height: 260 }}>
            <Line data={metrics.lineData} options={{
              ...metrics.lineOptions,
              scales: {
                ...(metrics.lineOptions.scales || {}),
                y: { ...((metrics.lineOptions.scales || {}).y || {}), ticks: { callback: (value) => (canViewFinancials ? value : '***') } }
              },
              plugins: {
                ...(metrics.lineOptions.plugins || {}),
                tooltip: {
                  callbacks: {
                    label: (ctx) => (canViewFinancials ? `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y || 0, settings)}` : `${ctx.dataset.label}: ***`)
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>30d Revenue</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{maskMoney(metrics.last30Revenue)}</div>
          <div style={{ marginTop: 6, color: '#64748b' }}>COGS: {maskMoney(metrics.last30Cost)}</div>
          <div style={{ marginTop: 2, color: '#64748b' }}>Profit: {maskMoney(metrics.last30Profit)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>30d Expenses</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{maskMoney(finance.expenseTotal)}</div>
          <div style={{ marginTop: 6, color: '#64748b' }}>Projection (30d): {maskMoney(finance.projected30)}</div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <div style={{ color: '#64748b' }}>Cashflow</div>
          <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Inflow</span><strong>{maskMoney(metrics.last30Revenue)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Outflow</span><strong>{maskMoney(finance.expenseTotal)}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Net</span><strong>{maskMoney(finance.net)}</strong></div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 16, marginTop: 16 }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 16, marginTop: 16 }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Top Products (Units)</h2>
          <div style={{ height: 220 }}>
            <Bar data={metrics.topBar} options={metrics.barOptions} />
          </div>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Payments by Day (7d)</h2>
          <div style={{ height: 220 }}>
            <Bar data={metrics.paymentBar} options={metrics.stackedOptions} />
          </div>
        </div>
      </div>
      <div style={{ background: '#fff', padding: 16, borderRadius: 12, marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Performance Heatmap</h2>
          <select className="select" value={heatMode} onChange={e => setHeatMode(e.target.value)} style={{ width: 160 }}>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th align="left" style={{ position: 'sticky', left: 0, background: '#fff' }}>Day</th>
                {new Array(24).fill(0).map((_, h) => <th key={h} style={{ fontSize: 11, padding: 4 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {metrics.heatmap.grid.map(r => (
                <tr key={r.day}>
                  <td style={{ position: 'sticky', left: 0, background: '#fff', paddingRight: 8, fontSize: 12 }}>{r.day}</td>
                  {r.hours.map((v, i) => {
                    const t = metrics.heatmap.max > 0 ? v / metrics.heatmap.max : 0;
                    const bg = `rgba(14,165,233,${Math.min(0.9, Math.max(0, t))})`;
                    return <td key={i} title={canViewFinancials ? formatCurrency(v, settings) : '***'} style={{ width: 18, height: 18, background: v > 0 ? bg : '#f8fafc', border: '1px solid #eef2f7' }} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ background: '#fff', padding: 16, borderRadius: 12, marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Cashier Performance (30d revenue)</h2>
        <div style={{ height: 240 }}>
          <Bar data={metrics.cashierBar} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => (canViewFinancials ? formatCurrency(ctx.parsed.x ?? ctx.parsed.y ?? 0, settings) : '***') } } }, scales: { x: { ticks: { callback: () => (canViewFinancials ? undefined : '***') } } } }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
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
                  <td>{maskMoney(p.profit)}</td>
                </tr>
              ))}
              {metrics.topProfitProducts.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>No data</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Sales Rep Leaderboard (30d)</h2>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Seller</th>
                <th align="left">Revenue</th>
                <th align="left">Profit</th>
              </tr>
            </thead>
            <tbody>
              {metrics.cashierLeaderboard.map(x => (
                <tr key={x.seller}>
                  <td>{x.seller}</td>
                  <td>{maskMoney(x.revenue)}</td>
                  <td>{maskMoney(x.profit)}</td>
                </tr>
              ))}
              {metrics.cashierLeaderboard.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>No data</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {(roleLower === 'admin' || roleLower === 'superadmin') && (
        <div style={{ background: '#fff', padding: 16, borderRadius: 12, marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Branch Comparison (30d)</h2>
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
                  <td>{maskMoney(b.revenue)}</td>
                  <td>{maskMoney(b.profit)}</td>
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
