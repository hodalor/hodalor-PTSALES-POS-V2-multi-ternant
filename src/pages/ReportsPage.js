import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import BranchSelect from '../components/BranchSelect';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Chart, BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { useToast } from '../components/ToastProvider';
import * as expensesApi from '../api/expenses';
import { formatCurrency } from '../utils/currency';
import { listOperations } from '../api/wholesale';
import { isFeatureEnabled } from '../utils/featureFlags';
import { useAppLanguage } from '../utils/localization';

Chart.register(BarElement, ArcElement, CategoryScale, LinearScale, Tooltip, Legend);

function ReportsPage() {
  const { t } = useAppLanguage();
  const sales = useSelector(s => s.sales.sales);
  const audit = useSelector(s => s.audit.entries);
  const refunds = useSelector(s => s.refunds.requests);
  const products = useSelector(s => s.products.products);
  const branches = useSelector(s => s.branches.branches);
  const settings = useSelector(s => s.settings);
  const auth = useSelector(s => s.auth);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const canViewRevenue = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_revenue') || grants.includes('view_financials');
  const canViewProfit = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_profit') || grants.includes('view_financials');
  const canViewFinancials = canViewRevenue || canViewProfit;
  const canUseExpenses = isFeatureEnabled(settings, 'modules.expenses') && (
    roleLower === 'superadmin' ||
    roleLower === 'admin' ||
    (Array.isArray(auth.grants) && ['view_expenses', 'see_expenses', 'add_expenses'].some((key) => auth.grants.includes(key)))
  );

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodMode, setPeriodMode] = useState('range');
  const [branchId, setBranchId] = useState(settings.currentBranchId);
  const [reportType, setReportType] = useState('all');
  const [expenses, setExpenses] = useState([]);
  const [heatMode, setHeatMode] = useState('week');
  const [warehouseOperations, setWarehouseOperations] = useState([]);
  const toast = useToast();
  const selectedBranch = useMemo(() => branches.find(branch => String(branch.id) === String(branchId)) || null, [branchId, branches]);

  useEffect(() => setBranchId(settings.currentBranchId), [settings.currentBranchId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!canUseExpenses) {
        if (alive) setExpenses([]);
        return;
      }
      try {
        const list = await expensesApi.list({ branchId, from: periodMode === 'all_time' ? undefined : (dateFrom || undefined), to: periodMode === 'all_time' ? undefined : (dateTo || undefined) });
        if (!alive) return;
        setExpenses(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!alive) return;
        setExpenses([]);
        toast.show(String(e?.message || t('Failed to load expenses')), { type: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [branchId, dateFrom, dateTo, toast, canUseExpenses, periodMode, t]);

  const byId = useMemo(() => {
    const map = new Map();
    branches.forEach(b => map.set(b.id, b.name || b.code || b.id));
    return map;
  }, [branches]);
  const inRange = useCallback((iso) => {
    if (periodMode === 'all_time') return true;
    const ts = new Date(iso).getTime();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toTs = dateTo ? new Date(dateTo).getTime() : Number.MAX_SAFE_INTEGER;
    return ts >= fromTs && ts <= toTs;
  }, [dateFrom, dateTo, periodMode]);
  const matchBranch = useCallback((id) => !branchId || id === branchId, [branchId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const groups = await Promise.all([
          listOperations({ operationArea: 'warehouse', operationType: 'purchase', status: 'approved' }).catch(() => []),
          listOperations({ operationArea: 'warehouse', operationType: 'transfer', status: 'approved' }).catch(() => []),
          listOperations({ operationArea: 'warehouse', operationType: 'adjustment', status: 'approved' }).catch(() => [])
        ]);
        if (!alive) return;
        const merged = groups.flat().filter(row => inRange(row.createdAt || row.updatedAt) && matchBranch(row.branchId || row.fromBranchId || row.toBranchId));
        setWarehouseOperations(merged);
      } catch {
        if (!alive) return;
        setWarehouseOperations([]);
      }
    })();
    return () => { alive = false; };
  }, [branchId, dateFrom, dateTo, inRange, matchBranch]);

  const filteredSales = useMemo(() => sales.filter(s => inRange(s.created_at) && matchBranch(s.branchId)), [sales, inRange, matchBranch]);
  const analytics = useMemo(() => {
    const productUnits = {};
    const categoryUnits = {};
    const cashierRevenue = {};
    const skuTo = new Map(products.map(p => [p.sku, { name: p.name, category: p.category || t('Uncategorized') }]));
    for (const s of filteredSales) {
      const seller = s.sellerName || t('Unknown');
      cashierRevenue[seller] = (cashierRevenue[seller] || 0) + (Number(s.total) || 0);
      for (const it of s.items || []) {
        const sku = it.sku || it.name || 'unknown';
        productUnits[sku] = (productUnits[sku] || 0) + (Number(it.qty) || 0);
        const meta = skuTo.get(sku);
        const cat = meta?.category || t('Uncategorized');
        categoryUnits[cat] = (categoryUnits[cat] || 0) + (Number(it.qty) || 0);
      }
    }
    const topEntries = Object.entries(productUnits).sort((a,b) => b[1]-a[1]).slice(0,10);
    const topLabels = topEntries.map(([sku]) => skuTo.get(sku)?.name || sku);
    const topBar = { labels: topLabels, datasets: [{ label: t('Units'), data: topEntries.map(x=>x[1]), backgroundColor: '#0ea5e9' }] };
    const catLabels = Object.keys(categoryUnits);
    const catDoughnut = { labels: catLabels, datasets: [{ data: catLabels.map(c=>categoryUnits[c]), backgroundColor: ['#0ea5e9','#16a34a','#f59e0b','#ef4444','#8b5cf6','#14b8a6'] }] };
    const cashEntries = Object.entries(cashierRevenue).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const cashierBar = { labels: cashEntries.map(x=>x[0]), datasets: [{ label: t('Revenue'), data: cashEntries.map(x=>+(x[1]||0).toFixed(2)), backgroundColor: '#16a34a' }] };
    return { topEntries, topBar, categoryUnits, catDoughnut, cashierRevenue, cashierBar };
  }, [filteredSales, products, t]);

  const money = useMemo(() => {
    const revenue = filteredSales.reduce((s, x) => s + (Number(x.total) || 0), 0);
    const profit = filteredSales.reduce((s, x) => s + (Number(x.profitTotal) || 0), 0);
    const cost = filteredSales.reduce((s, x) => s + (Number(x.costTotal) || 0), 0);
    const marginPct = revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0;
    const expenseTotal = expenses.reduce((s, x) => s + (Number(x.amount) || 0), 0);
    const net = profit - expenseTotal;
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : (Date.now() - 30 * 24 * 3600 * 1000);
    const toTs = dateTo ? new Date(dateTo).getTime() : Date.now();
    const days = Math.max(1, Math.floor((toTs - fromTs) / (24 * 3600 * 1000)) + 1);
    const projected30 = (net / days) * 30;
    return { revenue, cost, profit, marginPct, expenseTotal, net, days, projected30 };
  }, [filteredSales, expenses, dateFrom, dateTo]);

  const heatmap = useMemo(() => {
    const end = dateTo ? new Date(dateTo) : new Date();
    const daysBack = heatMode === 'day' ? 1 : heatMode === 'month' ? 30 : 7;
    const start = dateFrom ? new Date(dateFrom) : new Date(end.getTime() - daysBack * 24 * 3600 * 1000);
    const days = [];
    const d0 = new Date(start.toISOString().slice(0, 10));
    const d1 = new Date(end.toISOString().slice(0, 10));
    for (let t = d0.getTime(); t <= d1.getTime(); t += 24 * 3600 * 1000) days.push(new Date(t));
    const grid = days.map(d => ({ day: d.toISOString().slice(0, 10), hours: new Array(24).fill(0) }));
    const idxByDay = new Map(grid.map((r, i) => [r.day, i]));
    for (const s of filteredSales) {
      const dt = new Date(s.created_at);
      const day = dt.toISOString().slice(0, 10);
      const i = idxByDay.get(day);
      if (i == null) continue;
      grid[i].hours[dt.getHours()] += Number(s.total) || 0;
    }
    let max = 0;
    for (const r of grid) for (const v of r.hours) max = Math.max(max, v);
    return { grid, max };
  }, [filteredSales, dateFrom, dateTo, heatMode]);

  const show = (key) => reportType === 'all' || reportType === key;

  function maskRevenue(value) {
    return canViewRevenue ? formatCurrency(value, settings) : '******';
  }

  function maskProfit(value) {
    return canViewProfit ? formatCurrency(value, settings) : '******';
  }

  function maskProfitText(value) {
    return canViewProfit ? value : '***';
  }

  function ensureRevenueExport() {
    if (canViewRevenue) return true;
    toast.show(t('You are not allowed to export revenue figures'), { type: 'error' });
    return false;
  }
  function ensureProfitExport() {
    if (canViewProfit) return true;
    toast.show(t('You are not allowed to export profit figures'), { type: 'error' });
    return false;
  }

  function exportTopProducts(type) {
    const rows = analytics.topEntries.map(([sku, units]) => {
      const p = products.find(pp => pp.sku === sku);
      return { name: p?.name || sku, sku, units };
    });
    const headers = [
      { key: 'name', label: t('Product') },
      { key: 'sku', label: t('SKU') },
      { key: 'units', label: t('Units') }
    ];
    if (type === 'csv') exportCsv('top-products.csv', headers, rows);
    else exportTablePdf(t('Top Products'), headers, rows);
  }
  function exportCategories(type) {
    const rows = Object.keys(analytics.categoryUnits).map(cat => ({ category: cat, units: analytics.categoryUnits[cat] }));
    const headers = [
      { key: 'category', label: t('Category') },
      { key: 'units', label: t('Units') }
    ];
    if (type === 'csv') exportCsv('category-performance.csv', headers, rows);
    else exportTablePdf(t('Category Performance'), headers, rows);
  }
  function exportCashiers(type) {
    if (!ensureRevenueExport()) return;
    const rows = Object.keys(analytics.cashierRevenue).map(name => ({ cashier: name, revenue: +(analytics.cashierRevenue[name]||0).toFixed(2) }))
      .sort((a,b)=>b.revenue-a.revenue);
    const headers = [
      { key: 'cashier', label: t('Cashier') },
      { key: 'revenue', label: t('Revenue') }
    ];
    if (type === 'csv') exportCsv('cashier-performance.csv', headers, rows);
    else exportTablePdf(t('Cashier Performance'), headers, rows);
  }

  function exportSales(type) {
    if (!ensureRevenueExport()) return;
    const rows = sales.filter(s => inRange(s.created_at) && matchBranch(s.branchId));
    const headers = [
      { key: 'id', label: t('Sale ID') },
      { key: 'created_at', label: t('Date'), value: r => new Date(r.created_at).toLocaleString() },
      { key: 'branch', label: t('Branch'), value: r => byId.get(r.branchId) || r.branchId || '' },
      { key: 'seller', label: t('Seller'), value: r => r.sellerName || '' },
      { key: 'items', label: t('Items'), value: r => (r.items || []).map(i => `${i.name}x${i.qty}`).join('; ') },
      { key: 'subtotal', label: t('Subtotal') },
      { key: 'discount', label: t('Discount') },
      { key: 'tax', label: t('Tax') },
      { key: 'total', label: t('Total') }
    ];
    if (type === 'csv') exportCsv('sales.csv', headers, rows);
    else exportTablePdf(t('Sales'), headers, rows);
  }

  function exportTransfers(type) {
    const list = audit.filter(e => e.actionType === 'stock_transfer' && inRange(e.ts) && matchBranch((e.details || {}).from || e.branchId));
    const headers = [
      { key: 'ts', label: t('Timestamp'), value: e => new Date(e.ts).toLocaleString() },
      { key: 'actor', label: t('Actor') },
      { key: 'product', label: t('Product'), value: e => (e.details || {}).product || '' },
      { key: 'from', label: t('From'), value: e => byId.get((e.details || {}).from) || (e.details || {}).from || '' },
      { key: 'to', label: t('To'), value: e => byId.get((e.details || {}).to) || (e.details || {}).to || '' },
      { key: 'qty', label: t('Qty'), value: e => (e.details || {}).qty ?? '' },
      { key: 'remark', label: t('Remark'), value: e => e.remark || '' }
    ];
    if (type === 'csv') exportCsv('transfers.csv', headers, list);
    else exportTablePdf(t('Transfers'), headers, list);
  }

  function exportPurchases(type) {
    if (!ensureProfitExport()) return;
    const list = audit.filter(e => e.actionType === 'stock_receive' && inRange(e.ts) && matchBranch(e.branchId));
    const headers = [
      { key: 'ts', label: t('Timestamp'), value: e => new Date(e.ts).toLocaleString() },
      { key: 'actor', label: t('Actor') },
      { key: 'product', label: t('Product'), value: e => (e.details || {}).product || '' },
      { key: 'branch', label: t('Branch'), value: e => byId.get(e.branchId) || e.branchId || '' },
      { key: 'qty', label: t('Qty'), value: e => (e.details || {}).qty ?? '' },
      { key: 'pack', label: t('Pack'), value: e => (e.details || {}).pack || t('Base Unit') },
      { key: 'baseUnits', label: t('Base Units'), value: e => (e.details || {}).baseUnits ?? '' },
      { key: 'supplier', label: t('Supplier'), value: e => (e.details || {}).supplier || '' },
      { key: 'cost', label: t('Cost'), value: e => (e.details || {}).cost ?? '' },
      { key: 'remark', label: t('Remark'), value: e => e.remark || '' }
    ];
    if (type === 'csv') exportCsv('purchases.csv', headers, list);
    else exportTablePdf(t('Purchases'), headers, list);
  }

  function exportAdjustments(type) {
    const source = audit.filter(e => (e.actionType === 'stock_adjust' || e.actionType === 'stock_damage_remove') && inRange(e.ts));
    const list = source.filter(e => matchBranch(e.branchId || (e.details || {}).branchId));
    const headers = [
      { key: 'ts', label: t('Timestamp'), value: e => new Date(e.ts).toLocaleString() },
      { key: 'actor', label: t('Actor') },
      { key: 'product', label: t('Product'), value: e => (e.details || {}).product || '' },
      { key: 'variant', label: t('Variant'), value: e => (e.details || {}).variant || '' },
      { key: 'branch', label: t('Branch'), value: e => byId.get(e.branchId || (e.details || {}).branchId) || e.branchId || (e.details || {}).branchId || '' },
      { key: 'delta', label: t('Delta'), value: e => e.actionType === 'stock_adjust' ? (e.details || {}).delta : -Math.abs((e.details || {}).qty || 0) },
      { key: 'type', label: t('Type'), value: e => e.actionType === 'stock_adjust' ? t('Adjust') : t('Damage/Expired') },
      { key: 'remark', label: t('Remark'), value: e => e.remark || '' }
    ];
    if (type === 'csv') exportCsv('adjustments.csv', headers, list);
    else exportTablePdf(t('Adjustments'), headers, list);
  }

  function exportStockRecords(type) {
    function normalize(e) {
      const actionType = e.actionType;
      const d = e.details || {};
      const b = e.branchId || d.branchId || null;
      if (actionType === 'stock_adjust') {
        return { ts: e.ts, actor: e.actor, branchId: b, source: t('Adjustments'), action: d.delta > 0 ? t('Add') : t('Remove'), product: d.product || '', variant: d.variant || '', qty: d.delta, remark: e.remark || '' };
      }
      if (actionType === 'stock_damage_remove') {
        return { ts: e.ts, actor: e.actor, branchId: b, source: t('Adjustments'), action: t('Remove'), product: d.product || '', variant: d.variant || '', qty: -Math.abs(d.qty || 0), remark: e.remark || '' };
      }
      if (actionType === 'stock_transfer') {
        return { ts: e.ts, actor: e.actor, branchId: d.from || b, source: t('Transfers'), action: t('Transfer {from} -> {to}', { from: d.from, to: d.to }), product: d.product || '', variant: d.variant || '', qty: d.qty || 0, remark: e.remark || '' };
      }
      if (actionType === 'stock_receive') {
        return { ts: e.ts, actor: e.actor, branchId: b, source: t('Purchases'), action: t('Add'), product: d.product || '', variant: d.variant || '', qty: d.baseUnits ?? d.qty ?? 0, remark: e.remark || '' };
      }
      if (actionType === 'stock_set_initial') {
        return { ts: e.ts, actor: e.actor, branchId: b, source: t('Products'), action: t('Set'), product: d.product || '', variant: d.variant || '', qty: d.quantity ?? 0, remark: e.remark || '' };
      }
      if (actionType === 'stock_set_manual') {
        return { ts: e.ts, actor: e.actor, branchId: b, source: t('Inventory'), action: t('Set'), product: d.product || '', variant: d.variant || '', qty: d.delta ?? 0, remark: e.remark || '' };
      }
      if (actionType === 'stock_sale_deduct') {
        const totalUnits = Array.isArray(d.items) ? d.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0;
        return { ts: e.ts, actor: e.actor, branchId: b, source: t('POS'), action: t('Remove (Sale)'), product: t('{units} unit(s) across {count} item(s)', { units: totalUnits, count: d.items?.length || 0 }), variant: '', qty: -Math.abs(totalUnits), remark: e.remark || '' };
      }
      if (actionType === 'stock_restock_refund') {
        const totalUnits = Array.isArray(d.items) ? d.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0;
        return { ts: e.ts, actor: e.actor, branchId: b, source: t('Refund Approvals'), action: t('Add (Restock)'), product: t('{units} unit(s) across {count} item(s)', { units: totalUnits, count: d.items?.length || 0 }), variant: '', qty: totalUnits, remark: e.remark || '' };
      }
      return null;
    }
    const base = audit.map(normalize).filter(Boolean).filter(r => inRange(r.ts) && matchBranch(r.branchId));
    const headers = [
      { key: 'ts', label: t('Timestamp'), value: r => new Date(r.ts).toLocaleString() },
      { key: 'actor', label: t('Actor') },
      { key: 'branch', label: t('Branch'), value: r => byId.get(r.branchId) || r.branchId || '' },
      { key: 'source', label: t('Source') },
      { key: 'action', label: t('Action') },
      { key: 'product', label: t('Product') },
      { key: 'variant', label: t('Variant') },
      { key: 'qty', label: t('Delta') },
      { key: 'remark', label: t('Remark') }
    ];
    if (type === 'csv') exportCsv('stock-records.csv', headers, base);
    else exportTablePdf(t('Stock Records'), headers, base);
  }

  function exportRefunds(type) {
    if (!ensureRevenueExport()) return;
    const list = refunds.filter(r => inRange(r.created_at) && matchBranch(r.branchId));
    const headers = [
      { key: 'ref', label: t('Ref'), value: r => r.invoiceSerial || r.receiptNumber || r.saleId },
      { key: 'initiator', label: t('Initiator'), value: r => r.initiatorName || '' },
      { key: 'branch', label: t('Branch'), value: r => byId.get(r.branchId) || r.branchId || '' },
      { key: 'type', label: t('Type'), value: r => String(r.type || '').toUpperCase() },
      { key: 'amount', label: t('Amount'), value: r => String(r.requestedAmount || 0) },
      { key: 'created', label: t('Created'), value: r => new Date(r.created_at).toLocaleString() },
      { key: 'status', label: t('Status'), value: r => (r.status || '').replace('_',' ') },
      { key: 'approver', label: t('Approver'), value: r => r.approverName || '' }
    ];
    if (type === 'csv') exportCsv('refunds.csv', headers, list);
    else exportTablePdf(t('Refunds'), headers, list);
  }

  function exportWarehouseOperations(type) {
    if (!ensureProfitExport()) return;
    const rows = warehouseOperations.map(row => ({
      type: row.operationType,
      status: row.status,
      source: byId.get(row.fromBranchId || row.branchId) || row.fromBranchId || row.branchId || '',
      sourceInventory: row.fromInventoryType || '',
      destination: byId.get(row.toBranchId) || row.toBranchId || '',
      destinationInventory: row.toInventoryType || '',
      qty: Number(row.qty || 0),
      value: Number(row.cost || row.requestedAmount || 0),
      created: row.createdAt ? new Date(row.createdAt).toLocaleString() : ''
    }));
    const headers = [
      { key: 'type', label: t('Type') },
      { key: 'status', label: t('Status') },
      { key: 'source', label: t('Source') },
      { key: 'sourceInventory', label: t('Source Inventory') },
      { key: 'destination', label: t('Destination') },
      { key: 'destinationInventory', label: t('Destination Inventory') },
      { key: 'qty', label: t('Qty') },
      { key: 'value', label: t('Value') },
      { key: 'created', label: t('Created') }
    ];
    if (type === 'csv') exportCsv('warehouse-operations.csv', headers, rows);
    else exportTablePdf(t('Warehouse Operations'), headers, rows);
  }

  function exportWarehouseStock(type) {
    const rows = products.map(product => ({
      product: product.name,
      sku: product.sku || '',
      warehouseUnits: branchId
        ? Number((product.warehouseStockByBranch || {})[branchId] || 0)
        : Object.values(product.warehouseStockByBranch || {}).reduce((s, qty) => s + (Number(qty) || 0), 0),
      lowStock: Number(product.lowStock || 0)
    }));
    const headers = [
      { key: 'product', label: t('Product') },
      { key: 'sku', label: t('SKU') },
      { key: 'warehouseUnits', label: t('Warehouse Units') },
      { key: 'lowStock', label: t('Low Stock Threshold') }
    ];
    if (type === 'csv') exportCsv('warehouse-stock.csv', headers, rows);
    else exportTablePdf(
      selectedBranch
        ? t('Warehouse Stock Snapshot - {branch}', { branch: selectedBranch.name || selectedBranch.code || selectedBranch.id })
        : t('Warehouse Stock Snapshot - All Branches'),
      headers,
      rows
    );
  }

  function exportRetailStock(type) {
    const rows = products.map(product => ({
      product: product.name,
      sku: product.sku || '',
      retailUnits: branchId
        ? Number((product.stockByBranch || {})[branchId] || 0)
        : Object.values(product.stockByBranch || {}).reduce((s, qty) => s + (Number(qty) || 0), 0),
      lowStock: Number(product.lowStock || 0)
    }));
    const headers = [
      { key: 'product', label: t('Product') },
      { key: 'sku', label: t('SKU') },
      { key: 'retailUnits', label: t('Retail Units') },
      { key: 'lowStock', label: t('Low Stock Threshold') }
    ];
    if (type === 'csv') exportCsv('retail-stock.csv', headers, rows);
    else exportTablePdf(
      selectedBranch
        ? t('Retail Stock Snapshot - {branch}', { branch: selectedBranch.name || selectedBranch.code || selectedBranch.id })
        : t('Retail Stock Snapshot - All Branches'),
      headers,
      rows
    );
  }

  function exportDistributionStock(type) {
    const rows = products.map(product => ({
      product: product.name,
      sku: product.sku || '',
      distributionUnits: branchId
        ? Number((product.wholesaleStockByBranch || {})[branchId] || 0)
        : Object.values(product.wholesaleStockByBranch || {}).reduce((s, qty) => s + (Number(qty) || 0), 0),
      lowStock: Number(product.wholesaleLowStock != null ? product.wholesaleLowStock : (product.lowStock || 0))
    }));
    const headers = [
      { key: 'product', label: t('Product') },
      { key: 'sku', label: t('SKU') },
      { key: 'distributionUnits', label: t('Distribution Units') },
      { key: 'lowStock', label: t('Low Stock Threshold') }
    ];
    if (type === 'csv') exportCsv('distribution-stock.csv', headers, rows);
    else exportTablePdf(
      selectedBranch
        ? t('Distribution Stock Snapshot - {branch}', { branch: selectedBranch.name || selectedBranch.code || selectedBranch.id })
        : t('Distribution Stock Snapshot - All Branches'),
      headers,
      rows
    );
  }

  function exportPriceList(type) {
    const rows = products.map(product => ({
      product: product.name,
      sku: product.sku || '',
      category: product.category || '',
      retailPrice: Number(product.retailPrice != null ? product.retailPrice : product.price || 0),
      distributionPrice: Number(product.wholesalePrice != null ? product.wholesalePrice : product.price || 0),
      warehousePrice: Number(product.warehousePrice != null ? product.warehousePrice : 0),
      agentPrice: Number(product.agentPrice != null ? product.agentPrice : product.price || 0)
    }));
    const headers = [
      { key: 'product', label: t('Product') },
      { key: 'sku', label: t('SKU') },
      { key: 'category', label: t('Category') },
      { key: 'retailPrice', label: t('Retail Price') },
      { key: 'distributionPrice', label: t('Distribution Price') },
      { key: 'warehousePrice', label: t('Warehouse Price') },
      { key: 'agentPrice', label: t('Agent Price') }
    ];
    if (type === 'csv') exportCsv('price-list.csv', headers, rows);
    else exportTablePdf(t('Price List'), headers, rows);
  }

  return (
    <div className="page-shell">
      <div className="card">
        <h1 style={{ margin: 0 }}>{t('Reports')}</h1>
        <div className="page-subtitle-compact">{t('Export sales, stock, operations, analytics, and finance views with cleaner controls and summaries.')}</div>
      </div>
      <div className="card record-filters">
        <label>
          <div className="field-label">{t('Period')}</div>
          <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
            <option value="range">{t('Custom Range')}</option>
            <option value="all_time">{t('All Time')}</option>
          </select>
        </label>
        <label>
          <div className="field-label">{t('From')}</div>
          <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
        </label>
        <label>
          <div className="field-label">{t('To')}</div>
          <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
        </label>
        <label>
          <div className="field-label">{t('Branch')}</div>
          <BranchSelect value={branchId} onChange={setBranchId} includeAll allLabel={t('All Branches')} />
        </label>
      </div>
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <div className="record-filters" style={{ gridColumn: '1 / span 2' }}>
          <label>
            <div className="field-label">{t('Report')}</div>
            <select className="select" value={reportType} onChange={e => setReportType(e.target.value)}>
              <option value="all">{t('All Sections')}</option>
              <option value="sales">{t('Sales')}</option>
              <option value="purchases">{t('Purchases')}</option>
              <option value="transfers">{t('Transfers')}</option>
              <option value="adjustments">{t('Adjustments')}</option>
              <option value="stock">{t('Stock Records')}</option>
              <option value="refunds">{t('Refunds')}</option>
              <option value="analytics-top">{t('Top Products')}</option>
              <option value="analytics-cat">{t('Category Performance')}</option>
              <option value="analytics-cashier">{t('Cashier Performance')}</option>
              <option value="warehouse-ops">{t('Warehouse Operations')}</option>
              <option value="retail-stock">{t('Retail Stock')}</option>
              <option value="distribution-stock">{t('Distribution Stock')}</option>
              <option value="warehouse-stock">{t('Warehouse Stock')}</option>
              <option value="price-list">{t('Price List')}</option>
              <option value="finance">{t('Finance')}</option>
            </select>
          </label>
          <label>
            <div className="field-label">{t('Heatmap')}</div>
            <select className="select" value={heatMode} onChange={e => setHeatMode(e.target.value)}>
              <option value="day">{t('Daily')}</option>
              <option value="week">{t('Weekly')}</option>
              <option value="month">{t('Monthly')}</option>
            </select>
          </label>
        </div>
        {show('sales') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Sales')}</h2>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportSales('csv')} disabled={!canViewRevenue}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportSales('pdf')} disabled={!canViewRevenue}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('purchases') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Purchases')}</h2>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportPurchases('csv')} disabled={!canViewProfit}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportPurchases('pdf')} disabled={!canViewProfit}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('transfers') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Transfers')}</h2>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportTransfers('csv')}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportTransfers('pdf')}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('adjustments') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Adjustments')}</h2>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportAdjustments('csv')}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportAdjustments('pdf')}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('stock') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Stock Records')}</h2>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportStockRecords('csv')}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportStockRecords('pdf')}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('refunds') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Refunds')}</h2>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportRefunds('csv')} disabled={!canViewRevenue}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportRefunds('pdf')} disabled={!canViewRevenue}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('warehouse-ops') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Warehouse Operations')}</h2>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportWarehouseOperations('csv')} disabled={!canViewProfit}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportWarehouseOperations('pdf')} disabled={!canViewProfit}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('retail-stock') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Retail Stock')}</h2>
          <div className="section-note" style={{ marginBottom: 8 }}>
            {t('Scope')}: {selectedBranch ? t('Selected branch ({branch})', { branch: selectedBranch.name || selectedBranch.code || selectedBranch.id }) : t('All branches')}
          </div>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportRetailStock('csv')}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportRetailStock('pdf')}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('distribution-stock') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Distribution Stock')}</h2>
          <div className="section-note" style={{ marginBottom: 8 }}>
            {t('Scope')}: {selectedBranch ? t('Selected branch ({branch})', { branch: selectedBranch.name || selectedBranch.code || selectedBranch.id }) : t('All branches')}
          </div>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportDistributionStock('csv')}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportDistributionStock('pdf')}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('warehouse-stock') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Warehouse Stock')}</h2>
          <div className="section-note" style={{ marginBottom: 8 }}>
            {t('Scope')}: {selectedBranch ? t('Selected branch ({branch})', { branch: selectedBranch.name || selectedBranch.code || selectedBranch.id }) : t('All branches')}
          </div>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportWarehouseStock('csv')}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportWarehouseStock('pdf')}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
        {show('price-list') && (
        <div className="surface-panel">
          <h2 className="section-title">{t('Price List')}</h2>
          <div className="section-note" style={{ marginBottom: 8 }}>
            {t('Scope')}: {t('All products with retail, distribution, and agent prices')}
          </div>
          <div className="inline-actions">
            <button className="btn" onClick={() => exportPriceList('csv')}>{t('Export CSV')}</button>
            <button className="btn" onClick={() => exportPriceList('pdf')}>{t('Export PDF')}</button>
          </div>
        </div>
        )}
      </div>
      {(show('analytics-top') || show('analytics-cat') || show('analytics-cashier')) && (
      <div className="card" style={{ marginTop: 12 }}>
        <h2 className="section-title">{t('Analytics')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {show('analytics-top') && (
          <div className="surface-panel">
            <div className="section-header">
              <div style={{ fontWeight: 600 }}>{t('Top Products')}</div>
              <div className="inline-actions">
                <button className="btn" onClick={() => exportTopProducts('csv')}>{t('CSV')}</button>
                <button className="btn" onClick={() => exportTopProducts('pdf')}>{t('PDF')}</button>
              </div>
            </div>
            <div style={{ height: 220, marginTop: 8 }}>
              <Bar data={analytics.topBar} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, indexAxis: 'y' }} />
            </div>
          </div>
          )}
          {show('analytics-cat') && (
          <div className="surface-panel">
            <div className="section-header">
              <div style={{ fontWeight: 600 }}>{t('Category Performance')}</div>
              <div className="inline-actions">
                <button className="btn" onClick={() => exportCategories('csv')}>{t('CSV')}</button>
                <button className="btn" onClick={() => exportCategories('pdf')}>{t('PDF')}</button>
              </div>
            </div>
            <div style={{ height: 220, marginTop: 8 }}>
              <Doughnut data={analytics.catDoughnut} />
            </div>
          </div>
          )}
          {show('analytics-cashier') && (
          <div className="surface-panel">
            <div className="section-header">
              <div style={{ fontWeight: 600 }}>{t('Cashier Performance')}</div>
              <div className="inline-actions">
                <button className="btn" onClick={() => exportCashiers('csv')} disabled={!canViewRevenue}>{t('CSV')}</button>
                <button className="btn" onClick={() => exportCashiers('pdf')} disabled={!canViewRevenue}>{t('PDF')}</button>
              </div>
            </div>
            <div style={{ height: 220, marginTop: 8 }}>
              <Bar data={analytics.cashierBar} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => (canViewRevenue ? formatCurrency(ctx.parsed.x ?? ctx.parsed.y ?? 0, settings) : '***') } } }, indexAxis: 'y', scales: { x: { ticks: { callback: (value) => (canViewRevenue ? value : '***') } } } }} />
            </div>
          </div>
          )}
        </div>
      </div>
      )}
      {show('finance') && (
      <div className="card" style={{ marginTop: 12 }}>
        <h2 className="section-title">{t('Finance')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('Summary')}</div>
            <div className="sp"><span className="muted">{t('Revenue')}</span><span>{maskRevenue(money.revenue)}</span></div>
            <div className="sp"><span className="muted">{t('COGS')}</span><span>{maskProfit(money.cost)}</span></div>
            <div className="sp"><span className="muted">{t('Profit')}</span><span>{maskProfit(money.profit)}</span></div>
            <div className="sp"><span className="muted">{t('Margin')}</span><span>{maskProfitText(`${money.marginPct}%`)}</span></div>
            <div className="sp"><span className="muted">{t('Expenses')}</span><span>{maskProfit(money.expenseTotal)}</span></div>
            <div className="sp"><strong>{t('Net')}</strong><strong>{maskProfit(money.net)}</strong></div>
            <div className="sp"><span className="muted">{t('Projected (30d)')}</span><span>{maskProfit(money.projected30)}</span></div>
          </div>

          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('Expenses')}</div>
            <table className="table">
              <thead>
                <tr>
                  <th align="left">{t('Date')}</th>
                  <th align="left">{t('Category')}</th>
                  <th align="left">{t('Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.slice(0, 20).map(r => (
                  <tr key={String(r._id || r.id)}>
                    <td>{new Date(r.date).toLocaleDateString()}</td>
                    <td>{r.category}</td>
                    <td>{maskProfit(Number(r.amount) || 0)}</td>
                  </tr>
                ))}
                {expenses.length === 0 && <tr><td colSpan="3" style={{ padding: 12, color: '#64748b' }}>{t('No expenses in range')}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ gridColumn: '1 / span 2' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{t('Performance Heatmap')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th align="left" style={{ position: 'sticky', left: 0, background: '#fff' }}>{t('Day')}</th>
                    {new Array(24).fill(0).map((_, h) => <th key={h} style={{ fontSize: 11, padding: 4 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.grid.map(r => (
                    <tr key={r.day}>
                      <td style={{ position: 'sticky', left: 0, background: '#fff', paddingRight: 8, fontSize: 12 }}>{r.day}</td>
                      {r.hours.map((v, i) => {
                        const t = heatmap.max > 0 ? v / heatmap.max : 0;
                        const bg = `rgba(14,165,233,${Math.min(0.9, Math.max(0, t))})`;
                        return <td key={i} title={canViewFinancials ? formatCurrency(v, settings) : '***'} style={{ width: 18, height: 18, background: v > 0 ? bg : '#f8fafc', border: '1px solid #eef2f7' }} />;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

export default ReportsPage;
