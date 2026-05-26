import { useDispatch, useSelector } from 'react-redux';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildBrandedReceiptHtml, printReceiptHtml } from '../utils/print';
import { escposReceipt, downloadText } from '../utils/escpos';
import { formatCurrency } from '../utils/currency';
import { exportCsv, exportTablePdf } from '../utils/exporters';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import * as salesApi from '../api/sales';
import { removeSales, setSales } from '../store/salesSlice';
import { useToast } from '../components/ToastProvider';
import InlineSpinner from '../components/InlineSpinner';
import BranchSelect from '../components/BranchSelect';
import { getProductBrand } from '../utils/productSearch';
import Modal from '../components/Modal';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getLocalDateTimeParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return {
    date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  };
}

function buildLocalDateTime(dateValue, timeValue) {
  const date = String(dateValue || '').trim();
  const time = String(timeValue || '').trim();
  if (!date) return null;
  const parsed = new Date(`${date}T${time || '00:00'}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function SalesPage() {
  const dispatch = useDispatch();
  const sales = useSelector(s => s.sales.sales);
  const products = useSelector(s => s.products.products);
  const settings = useSelector(s => s.settings);
  const branches = useSelector(s => s.branches.branches);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const auth = useSelector(s => s.auth);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  const canViewRevenue = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_revenue') || grants.includes('view_financials');
  const canViewProfit = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_profit') || grants.includes('view_financials');
  const canBackdateSales = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('backdate_sales');
  const canViewCashierCompetitionAll = roleLower === 'superadmin' || roleLower === 'admin' || grants.includes('view_dashboard_cashier_all') || grants.includes('view_dashboard_branch_comparison_all');
  const canViewCashierCompetitionAssigned = canViewCashierCompetitionAll || grants.includes('view_dashboard_cashier_assigned') || grants.includes('view_dashboard_branch_comparison_assigned');
  const toast = useToast();
  const canSeeAll = roleLower === 'admin' || roleLower === 'superadmin';
  const canDeleteSales = roleLower === 'superadmin';
  const assigned = auth.user?.assignedBranches || 'all';
  const allowedBranches = useMemo(() => {
    if (canSeeAll || assigned === 'all') return branches;
    const ids = new Set(Array.isArray(assigned) ? assigned.map(String) : [String(assigned)]);
    return (branches || []).filter(branch => ids.has(String(branch.id)));
  }, [assigned, branches, canSeeAll]);
  const effectiveBranchId = useMemo(() => {
    if ((branches || []).some(branch => String(branch.id) === String(currentBranchId || ''))) return currentBranchId;
    return allowedBranches[0]?.id || branches[0]?.id || '';
  }, [allowedBranches, branches, currentBranchId]);
  const [showAll, setShowAll] = useState(false);
  const [saleKind, setSaleKind] = useState('all'); // all, retail, wholesale
  const [creditKind, setCreditKind] = useState('all'); // all, non_credit, retail_easybuy, wholesale_credit
  const [tab, setTab] = useState('sales'); // sales, leaderboard, branches
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [periodMode, setPeriodMode] = useState('range');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedSaleIds, setSelectedSaleIds] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [loadingSales, setLoadingSales] = useState(false);
  const [editingSale, setEditingSale] = useState(null);
  const [editingSaleDate, setEditingSaleDate] = useState('');
  const [editingSaleTime, setEditingSaleTime] = useState('');
  const [editingSaleSaving, setEditingSaleSaving] = useState(false);
  const productBrandById = useMemo(() => {
    const map = new Map();
    (products || []).forEach((product) => {
      map.set(String(product.id || ''), getProductBrand(product));
    });
    return map;
  }, [products]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const branchScope = selectedBranchId ? selectedBranchId : '';
      try {
        setLoadingSales(true);
        const rows = await salesApi.list(branchScope ? { branchId: branchScope, limit: 1000 } : { limit: 1000 });
        if (!alive) return;
        dispatch(setSales(Array.isArray(rows) ? rows : []));
      } catch (e) {
        if (!alive) return;
        toast.show(String(e?.message || 'Failed to load sales'), { type: 'error' });
      } finally {
        if (alive) setLoadingSales(false);
      }
    })();
    return () => { alive = false; };
  }, [canSeeAll, dispatch, effectiveBranchId, selectedBranchId, showAll, toast]);
  const branchLabel = useCallback((sale) => (
    sale.branchName || (branches.find(b => b.id === sale.branchId)?.name || sale.branchId || '-')
  ), [branches]);
  const canUseCompetitionScope = canViewCashierCompetitionAssigned;
  const competitionAllowedBranchIds = useMemo(() => {
    if (canViewCashierCompetitionAll) return (branches || []).map((branch) => String(branch.id || '')).filter(Boolean);
    return allowedBranches.map((branch) => String(branch.id || '')).filter(Boolean);
  }, [allowedBranches, branches, canViewCashierCompetitionAll]);
  const competitionAllowedBranchIdSet = useMemo(() => new Set(competitionAllowedBranchIds), [competitionAllowedBranchIds]);
  const filteredByBranch = useMemo(() => {
    let list = sales;
    if (tab === 'leaderboard' || tab === 'branches') {
      if (selectedBranchId) {
        list = list.filter(sale => String(sale.branchId || '') === String(selectedBranchId));
      } else if (canUseCompetitionScope) {
        list = list.filter(sale => competitionAllowedBranchIdSet.has(String(sale.branchId || '')));
      } else {
        const scoped = sales.filter(sale => String(sale.branchId || '') === String(effectiveBranchId || ''));
        list = scoped.length > 0 ? scoped : sales;
      }
      return list;
    }
    if (!(canSeeAll && showAll)) {
      const scoped = sales.filter(sale => String(sale.branchId || '') === String(effectiveBranchId || ''));
      list = scoped.length > 0 ? scoped : sales;
    }
    if (selectedBranchId) list = list.filter(sale => String(sale.branchId || '') === String(selectedBranchId));
    return list;
  }, [canSeeAll, canUseCompetitionScope, competitionAllowedBranchIdSet, effectiveBranchId, sales, selectedBranchId, showAll, tab]);
  const filteredSales = useMemo(() => {
    let list = filteredByBranch;
    if (roleLower === 'cashier' && !canUseCompetitionScope) {
      const me = String(auth.user?.name || '').trim().toLowerCase();
      list = list.filter(s => String(s.sellerName || '').trim().toLowerCase() === me);
    }
    if (periodMode !== 'all_time' && dateFrom) {
      const start = new Date(`${dateFrom}T00:00:00`);
      list = list.filter(s => new Date(s.created_at || s.createdAt || 0) >= start);
    }
    if (periodMode !== 'all_time' && dateTo) {
      const end = new Date(`${dateTo}T23:59:59.999`);
      list = list.filter(s => new Date(s.created_at || s.createdAt || 0) <= end);
    }
    if (saleKind === 'retail') {
      list = list.filter(s => String(s.posType || 'retail') === 'retail');
    } else if (saleKind === 'wholesale') {
      list = list.filter(s => String(s.posType || 'retail') === 'wholesale');
    }
    if (creditKind === 'non_credit') {
      list = list.filter(s => !(Array.isArray(s.payment_methods) && s.payment_methods.some(p => String(p.type || '').toLowerCase() === 'easybuy')));
    } else if (creditKind === 'retail_easybuy') {
      list = list.filter(s => String(s.posType || 'retail') === 'retail' && Array.isArray(s.payment_methods) && s.payment_methods.some(p => String(p.type || '').toLowerCase() === 'easybuy'));
    } else if (creditKind === 'wholesale_credit') {
      list = list.filter(s => String(s.posType || 'retail') === 'wholesale' && Array.isArray(s.payment_methods) && s.payment_methods.some(p => String(p.type || '').toLowerCase() === 'easybuy'));
    }
    const q = String(searchTerm || '').trim().toLowerCase();
    if (q) {
      list = list.filter((sale) => {
        const itemText = Array.isArray(sale.items)
          ? sale.items.map((item) => [
              String(item.name || ''),
              String(item.spec || ''),
              String(item.sku || ''),
              String(item.brand || ''),
              String(productBrandById.get(String(item.productId || '')) || '')
            ].join(' ')).join(' ')
          : '';
        const fields = [
          String(sale.invoiceSerial || ''),
          String(sale.receiptNumber || ''),
          String(sale.sellerName || ''),
          String(sale.customerName || ''),
          String(sale.customerBusinessName || ''),
          String(sale.customerCode || ''),
          String(branchLabel(sale) || ''),
          itemText
        ].join(' ').toLowerCase();
        return fields.includes(q);
      });
    }
    return list;
  }, [auth.user?.name, branchLabel, canUseCompetitionScope, creditKind, dateFrom, dateTo, filteredByBranch, periodMode, productBrandById, roleLower, saleKind, searchTerm]);

  const summary = useMemo(() => {
    const totalRevenue = filteredSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
    const totalProfit = filteredSales.reduce((sum, sale) => sum + (Number(sale.profitTotal) || 0), 0);
    const itemsSold = filteredSales.reduce((sum, sale) => sum + (Array.isArray(sale.items) ? sale.items.reduce((acc, item) => acc + (Number(item.qty) || 0), 0) : 0), 0);
    const easybuyCount = filteredSales.filter(sale => String(sale.posType || 'retail') === 'retail' && Array.isArray(sale.payment_methods) && sale.payment_methods.some(p => String(p.type || '').toLowerCase() === 'easybuy')).length;
    const wholesaleCreditCount = filteredSales.filter(sale => String(sale.posType || 'retail') === 'wholesale' && Array.isArray(sale.payment_methods) && sale.payment_methods.some(p => String(p.type || '').toLowerCase() === 'easybuy')).length;
    return {
      totalSales: filteredSales.length,
      totalRevenue,
      totalProfit,
      itemsSold,
      easybuyCount,
      wholesaleCreditCount
    };
  }, [filteredSales]);

  const leaderboard = useMemo(() => {
    const map = new Map();
    for (const s of filteredSales) {
      const name = s.sellerName || 'Unknown';
      if (!map.has(name)) map.set(name, { seller: name, revenue: 0, profit: 0, sales: 0 });
      const row = map.get(name);
      row.revenue += Number(s.total) || 0;
      row.profit += Number(s.profitTotal) || 0;
      row.sales += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales]);

  const byId = useMemo(() => {
    const map = new Map();
    branches.forEach(b => map.set(b.id, b.name || b.code || b.id));
    return map;
  }, [branches]);

  const branchComparison = useMemo(() => {
    const map = new Map();
    for (const s of filteredSales) {
      const key = String(s.branchId || '');
      if (!map.has(key)) map.set(key, { branchId: key, name: byId.get(key) || key, revenue: 0, profit: 0, sales: 0 });
      const row = map.get(key);
      row.revenue += Number(s.total) || 0;
      row.profit += Number(s.profitTotal) || 0;
      row.sales += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales, byId]);
  function reprint(sale, escpos = false) {
    if (escpos) {
      const text = escposReceipt({
        header: { title: settings.appName, store: settings.receiptHeader, branch: branchLabel(sale), phone: settings.businessPhone || '', cashier: sale.sellerName, customer: sale.customerName ? `${sale.customerName}${sale.customerCode ? ` (${sale.customerCode})` : ''}` : '', receiptId: sale.id, receiptNumber: sale.receiptNumber, invoiceSerial: sale.invoiceSerial },
        items: sale.items,
        totals: { subtotal: sale.subtotal, discount: sale.discount, tax: sale.tax, total: sale.total },
        footer: { note: settings.receiptFooter },
        settings
      });
      downloadText(`receipt-${sale.id}.txt`, text);
      return;
    }
    const html = buildBrandedReceiptHtml({ settings, sale: { ...sale, branchName: branchLabel(sale) } });
    printReceiptHtml(html);
  }

  function openSaleDateEditor(sale) {
    const parts = getLocalDateTimeParts(sale?.created_at || new Date());
    setEditingSale(sale || null);
    setEditingSaleDate(parts.date);
    setEditingSaleTime(parts.time);
  }

  function closeSaleDateEditor() {
    if (editingSaleSaving) return;
    setEditingSale(null);
    setEditingSaleDate('');
    setEditingSaleTime('');
  }

  async function saveSaleDateEdit() {
    if (!editingSale) return;
    const nextDate = buildLocalDateTime(editingSaleDate, editingSaleTime);
    if (!nextDate) {
      toast.show('Enter a valid sale date and time', { type: 'error' });
      return;
    }
    if (nextDate.getTime() > Date.now()) {
      toast.show('Sale date/time cannot be in the future', { type: 'error' });
      return;
    }
    try {
      setEditingSaleSaving(true);
      const saleId = String(editingSale.id || editingSale._id || editingSale.clientId || '');
      await salesApi.updateSaleDate(saleId, { saleDateTime: nextDate.toISOString() });
      const branchScope = selectedBranchId ? { branchId: selectedBranchId, limit: 1000 } : { limit: 1000 };
      const rows = await salesApi.list(branchScope);
      dispatch(setSales(Array.isArray(rows) ? rows : []));
      toast.show('Sale date updated', { type: 'success' });
      closeSaleDateEditor();
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update sale date'), { type: 'error' });
    } finally {
      setEditingSaleSaving(false);
    }
  }

  async function deleteSelectedSales() {
    const ids = selectedSaleIds.filter(Boolean);
    if (ids.length === 0) return;
    const { confirmDialog } = await import('../utils/dialogs');
    const ok = await confirmDialog(`Delete ${ids.length} selected sale record(s)? They will go to Super Bin without changing stock quantities.`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await salesApi.removeMany(ids);
      dispatch(removeSales(ids));
      setSelectedSaleIds([]);
      setBulkAction('');
      toast.show('Sale records moved to Super Bin', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to delete sale records'), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }
  function onExportCsv() {
    const headers = [
      { key: 'date', label: 'Date', value: s => new Date(s.created_at).toLocaleString() },
      { key: 'branch', label: 'Branch', value: s => branchLabel(s) },
      { key: 'seller', label: 'Seller', value: s => s.sellerName || '' },
      { key: 'invoice', label: 'Invoice', value: s => s.invoiceSerial || '' },
      { key: 'items', label: 'Items', value: s => s.items.map(i => `${i.name}${i.brand ? ` (${i.brand})` : ''}x${i.qty}`).join('; ') },
      { key: 'total', label: 'Total', value: s => s.total }
    ];
    exportCsv('sales.csv', headers, filteredSales);
  }
  function onExportPdf() {
    const headers = [
      { key: 'date', label: 'Date', value: s => new Date(s.created_at).toLocaleString() },
      { key: 'branch', label: 'Branch', value: s => branchLabel(s) },
      { key: 'seller', label: 'Seller', value: s => s.sellerName || '' },
      { key: 'invoice', label: 'Invoice', value: s => s.invoiceSerial || '' },
      { key: 'items', label: 'Items', value: s => s.items.map(i => `${i.name}${i.brand ? ` (${i.brand})` : ''}x${i.qty}`).join('; ') },
      { key: 'total', label: 'Total', value: s => formatCurrency(s.total, settings) }
    ];
    exportTablePdf('Sales', headers, filteredSales);
  }
  function maskRevenue(value) {
    return canViewRevenue ? formatCurrency(value, settings) : '***';
  }
  function maskProfit(value) {
    return canViewProfit ? formatCurrency(value, settings) : '***';
  }
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Sales</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <OfflineQueueIndicator collection="sales" label="Sales queued" />
          {canSeeAll && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
              <span>All branches</span>
            </label>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <button className={tab === 'sales' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('sales')}>Sales</button>
        <button className={tab === 'leaderboard' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('leaderboard')}>Sales Rep Leaderboard</button>
        <button className={tab === 'branches' ? 'btn btn-primary' : 'btn'} onClick={() => setTab('branches')}>Branch Comparison</button>
      </div>
      {tab === 'sales' && (
        <>
          {loadingSales ? (
            <div className="card" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <InlineSpinner />
              <span>Loading sales...</span>
            </div>
          ) : null}
          <div className="card" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <label>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Search</div>
              <input className="input" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(1); }} placeholder="Invoice, customer, product, brand, SKU" />
            </label>
            <label>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Period</div>
              <select className="select" value={periodMode} onChange={e => { setPeriodMode(e.target.value); setPage(1); }}>
                <option value="range">Custom Range</option>
                <option value="all_time">All Time</option>
              </select>
            </label>
            <label>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Period From</div>
              <input className="input" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} disabled={periodMode === 'all_time'} />
            </label>
            <label>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Period To</div>
              <input className="input" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} disabled={periodMode === 'all_time'} />
            </label>
            <label>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Branch</div>
              <BranchSelect value={selectedBranchId} onChange={(value) => { setSelectedBranchId(value || ''); setPage(1); }} includeAll allLabel="All Branches" />
            </label>
            <label>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Inventory Type</div>
              <select className="select" value={saleKind} onChange={e => { setSaleKind(e.target.value); setPage(1); }}>
                <option value="all">All Types</option>
                <option value="retail">Retail</option>
                <option value="wholesale">Distribution</option>
              </select>
            </label>
            <label>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Credit Filter</div>
              <select className="select" value={creditKind} onChange={e => { setCreditKind(e.target.value); setPage(1); }}>
                <option value="all">All Payment Types</option>
                <option value="non_credit">Non Credit</option>
                <option value="retail_easybuy">Retail EasyBuy</option>
                <option value="wholesale_credit">Distribution Credit Sale</option>
              </select>
            </label>
          </div>
          <div className="summary-grid" style={{ marginTop: 12 }}>
            <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Sales Count</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.totalSales}</div></div>
            <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Revenue</div><div className="price-accent" style={{ fontSize: 24, fontWeight: 800 }}>{maskRevenue(summary.totalRevenue)}</div></div>
            <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Profit</div><div className="price-accent" style={{ fontSize: 24, fontWeight: 800 }}>{maskProfit(summary.totalProfit)}</div></div>
            <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Items Sold</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.itemsSold}</div></div>
            <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Retail EasyBuy</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.easybuyCount}</div></div>
            <div className="card" style={{ padding: 16 }}><div style={{ color: '#64748b', fontSize: 12 }}>Distribution Credit</div><div style={{ fontSize: 28, fontWeight: 800 }}>{summary.wholesaleCreditCount}</div></div>
          </div>
        </>
      )}
      {(tab === 'leaderboard' || tab === 'branches') && (
        <div className="card" style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Period</div>
            <select className="select" value={periodMode} onChange={e => setPeriodMode(e.target.value)}>
              <option value="range">Custom Range</option>
              <option value="all_time">All Time</option>
            </select>
          </label>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Date From</div>
            <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Date To</div>
            <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} disabled={periodMode === 'all_time'} />
          </label>
          <label>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Branch</div>
            <select className="select" value={selectedBranchId} onChange={e => setSelectedBranchId(e.target.value)}>
              <option value="">{canViewCashierCompetitionAll ? 'All Branches' : 'Assigned Branches'}</option>
              {(canViewCashierCompetitionAll ? branches : (canUseCompetitionScope ? allowedBranches : branches)).map(branch => <option key={branch.id} value={branch.id}>{branch.name || branch.code || branch.id}</option>)}
            </select>
          </label>
        </div>
      )}
      {tab === 'sales' && (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, margin: '8px 0' }}>
        <button className="btn" onClick={onExportCsv}>Export CSV</button>
        <button className="btn" onClick={onExportPdf}>Export PDF</button>
      </div>
      )}
      {tab === 'leaderboard' && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2 className="section-title">Sales Rep Leaderboard</h2>
          <table className="table">
            <thead>
              <tr>
                <th align="left">Seller</th>
                <th align="left">Sales</th>
                <th align="left">Revenue</th>
                <th align="left">Profit</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map(x => (
                <tr key={x.seller}>
                  <td>{x.seller}</td>
                  <td>{x.sales}</td>
                  <td><span className="price-accent">{maskRevenue(x.revenue)}</span></td>
                  <td><span className="price-accent">{maskProfit(x.profit)}</span></td>
                </tr>
              ))}
              {leaderboard.length === 0 && <tr><td colSpan="4" style={{ padding: 12, color: '#64748b' }}>No sales found</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'branches' && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2 className="section-title">Branch Comparison</h2>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
            {canSeeAll && showAll ? 'Showing all branches' : 'Enable “All branches” to compare branches'}
          </div>
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
                  <td><span className="price-accent">{maskRevenue(b.revenue)}</span></td>
                  <td><span className="price-accent">{maskProfit(b.profit)}</span></td>
                </tr>
              ))}
              {branchComparison.length === 0 && <tr><td colSpan="4" style={{ padding: 12, color: '#64748b' }}>No sales found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'sales' && (
      <>
      {canDeleteSales && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select" value={bulkAction} onChange={e => setBulkAction(e.target.value)} style={{ width: 180 }} disabled={bulkDeleting}>
            <option value="">Actions</option>
            <option value="delete">Delete Selected</option>
          </select>
          <button className="btn" disabled={bulkDeleting || bulkAction !== 'delete' || selectedSaleIds.length === 0} onClick={() => void deleteSelectedSales()}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {bulkDeleting && <InlineSpinner />}
              {bulkDeleting ? 'Deleting…' : 'Apply'}
            </span>
          </button>
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            {canDeleteSales && (
              <th>
                <input
                  type="checkbox"
                  disabled={bulkDeleting}
                  checked={filteredSales.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).length > 0 && filteredSales.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).every(sale => selectedSaleIds.includes(String(sale.id || sale._id || sale.clientId || '')))}
                  onChange={e => {
                    const pageIds = filteredSales.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(sale => String(sale.id || sale._id || sale.clientId || '')).filter(Boolean);
                    setSelectedSaleIds(prev => e.target.checked ? [...new Set([...prev, ...pageIds])] : prev.filter(id => !pageIds.includes(id)));
                  }}
                />
              </th>
            )}
            <th align="left">Date</th>
            <th align="left">Branch</th>
            <th align="left">Type</th>
            <th align="left">Credit Mode</th>
            <th align="left">Seller</th>
            <th align="left">Invoice</th>
            <th align="left">Items</th>
            <th align="left">Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filteredSales.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(sale => (
            <tr key={sale.id} style={bulkDeleting && selectedSaleIds.includes(String(sale.id || sale._id || sale.clientId || '')) ? { opacity: 0.55 } : undefined}>
              {canDeleteSales && (
                <td>
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={selectedSaleIds.includes(String(sale.id || sale._id || sale.clientId || ''))}
                    onChange={e => setSelectedSaleIds(prev => e.target.checked ? [...new Set([...prev, String(sale.id || sale._id || sale.clientId || '')])] : prev.filter(id => id !== String(sale.id || sale._id || sale.clientId || '')))}
                  />
                </td>
              )}
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{new Date(sale.created_at).toLocaleString()}</span>
                  {canBackdateSales && (
                    <button className="btn" type="button" onClick={() => openSaleDateEditor(sale)} title="Edit sale date/time" style={{ padding: '6px 8px' }}>
                      <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" strokeWidth="2"/><path d="M13 7l4 4" stroke="currentColor" strokeWidth="2"/></svg>
                    </button>
                  )}
                </div>
              </td>
              <td>{branchLabel(sale)}</td>
              <td>{String(sale.posType || 'retail') === 'wholesale' ? 'Distribution' : 'Retail'}</td>
              <td>
                {Array.isArray(sale.payment_methods) && sale.payment_methods.some(p => String(p.type || '').toLowerCase() === 'easybuy')
                  ? (String(sale.posType || 'retail') === 'wholesale' ? 'Credit Sale' : 'EasyBuy')
                  : 'Non Credit'}
              </td>
              <td>{sale.sellerName || '-'}</td>
              <td>{sale.invoiceSerial || '—'}</td>
              <td>{sale.items.map(i => `${i.name}${i.brand ? ` (${i.brand})` : ''}${i.spec ? ' ['+i.spec+']' : ''}x${i.qty}`).join(', ')}</td>
              <td><span className="price-accent">{formatCurrency(sale.total, settings)}</span></td>
              <td>
                <button className="btn btn-primary" onClick={() => reprint(sale, false)} disabled={bulkDeleting && selectedSaleIds.includes(String(sale.id || sale._id || sale.clientId || ''))}>
                  <svg viewBox="0 0 24 24" fill="none"><path d="M6 9V3h12v6" stroke="currentColor" strokeWidth="2"/><path d="M6 17h12v4H6z" stroke="currentColor" strokeWidth="2"/><path d="M4 9h16a2 2 0 012 2v2H2v-2a2 2 0 012-2z" stroke="currentColor" strokeWidth="2"/></svg>
                  Reprint
                </button>
                <button className="btn" onClick={() => reprint(sale, true)} style={{ marginLeft: 6 }} disabled={bulkDeleting && selectedSaleIds.includes(String(sale.id || sale._id || sale.clientId || ''))}>
                  <svg viewBox="0 0 24 24" fill="none"><path d="M6 9V3h12v6" stroke="currentColor" strokeWidth="2"/><path d="M6 17h12v4H6z" stroke="currentColor" strokeWidth="2"/><path d="M4 9h16a2 2 0 012 2v2H2v-2a2 2 0 012-2z" stroke="currentColor" strokeWidth="2"/></svg>
                  ESC/POS
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <button className="btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(filteredSales.length / pageSize))}</span>
          <button className="btn" onClick={() => setPage(p => Math.min(Math.max(1, Math.ceil(filteredSales.length / pageSize)), p + 1))} disabled={page >= Math.max(1, Math.ceil(filteredSales.length / pageSize))}>Next</button>
        </div>
        <label>
          <span style={{ marginRight: 6 }}>Rows</span>
          <select className="select" value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>
      </>
      )}
      {editingSale && (
        <Modal
          title="Edit Sale Date"
          onClose={closeSaleDateEditor}
          footer={(
            <>
              <button className="btn" onClick={closeSaleDateEditor} disabled={editingSaleSaving}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void saveSaleDateEdit()} disabled={editingSaleSaving} style={{ marginLeft: 8 }}>
                {editingSaleSaving ? 'Saving...' : 'Save Date'}
              </button>
            </>
          )}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ color: '#64748b', fontSize: 13 }}>
              {editingSale.invoiceSerial || editingSale.receiptNumber || editingSale.id || editingSale._id}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label>
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Sale Date</div>
                <input className="input" type="date" max={getLocalDateTimeParts().date} value={editingSaleDate} onChange={e => setEditingSaleDate(e.target.value)} />
              </label>
              <label>
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>Sale Time</div>
                <input className="input" type="time" value={editingSaleTime} onChange={e => setEditingSaleTime(e.target.value)} />
              </label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default SalesPage;
