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

function CreditControlPage({ initialSection = 'clients', clientFilter = 'all', title = 'Credit Sale Control', description = 'Credit sale balances, overdue tracking, customer rank, and repayment initiation.' }) {
  const settings = useSelector(s => s.settings);
  const saleRows = useSelector(s => s.sales.sales || []);
  const toast = useToast();
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const roleLower = String(useSelector(s => s.auth.role || '') || '').toLowerCase();
  const canDeleteCredit = roleLower === 'superadmin';
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [repayments, setRepayments] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
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
  const [branchFilter, setBranchFilter] = useState('');
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultFromIso = new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [periodMode, setPeriodMode] = useState('range');
  const [dateFrom, setDateFrom] = useState(defaultFromIso);
  const [dateTo, setDateTo] = useState(todayIso);

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
      byId.set(key, row);
    });
    return Array.from(byId.values());
  }, [deletedSaleKeys, fallbackCreditSales, sales]);
  const filteredSales = useMemo(() => (
    sourceFilter === 'all' ? mergedSales : mergedSales.filter((row) => String(row.posType || 'retail') === sourceFilter)
  ), [mergedSales, sourceFilter]);
  const branchFilteredSales = useMemo(() => filteredSales.filter((row) => {
    if (branchFilter && String(row.branchId || '') !== String(branchFilter)) return false;
    const dateValue = row.createdAt || row.created_at || row.saleDate || row.due_date;
    if (!dateValue) return true;
    return inRange(dateValue);
  }), [filteredSales, branchFilter, inRange]);
  const salesById = useMemo(() => new Map(mergedSales.map((row) => [String(row._id || row.saleId || ''), row])), [mergedSales]);
  const shownActiveSales = useMemo(() => branchFilteredSales.filter(row => row.status !== 'completed'), [branchFilteredSales]);
  const overdueSales = useMemo(() => branchFilteredSales.filter(row => row.status === 'overdue'), [branchFilteredSales]);
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
      if (branchFilter && String(sale?.branchId || '') !== String(branchFilter)) return false;
      const dateValue = row.createdAt || row.created_at || row.paymentDate || row.date;
      if (dateValue && !inRange(dateValue)) return false;
      return true;
    });
  }, [repayments, salesById, sourceFilter, branchFilter, inRange]);
  const creditSummary = useMemo(() => {
    const easybuyRows = branchFilteredSales.filter((row) => String(row.posType || 'retail') === 'retail');
    const wholesaleRows = branchFilteredSales.filter((row) => String(row.posType || 'retail') === 'wholesale');
    const pendingRepayments = shownRepayments.filter((row) => row.status !== 'approved' && row.status !== 'rejected');
    return {
      activeCount: shownActiveSales.length,
      overdueCount: overdueSales.length,
      dueTodayCount: dueTodaySales.length,
      easybuyOutstanding: easybuyRows.reduce((sum, row) => sum + (Number(row.balance || 0) + Number(row.accumulated_penalty || 0)), 0),
      wholesaleOutstanding: wholesaleRows.reduce((sum, row) => sum + (Number(row.balance || 0) + Number(row.accumulated_penalty || 0)), 0),
      pendingRepaymentAmount: pendingRepayments.reduce((sum, row) => sum + (Number(row.amount || row.repayment_amount || 0) || 0), 0),
      pendingRepaymentCount: pendingRepayments.length
    };
  }, [branchFilteredSales, shownRepayments, shownActiveSales.length, overdueSales.length, dueTodaySales.length]);

  async function startRepayment(row) {
    const amount = await promptDialog('Repayment amount');
    if (!amount || Number(amount) <= 0) {
      toast.show('Enter a valid repayment amount', { type: 'error' });
      return;
    }
    const remark = await promptDialog('Repayment remark');
    setWorkingId(row._id || '');
    try {
      const payload = { creditSaleId: row._id, amount: Number(amount), remark: String(remark || '') };
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
    const ok = await confirmDialog('Delete this credit sale record?');
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
      toast.show('Credit sale deleted', { type: 'success' });
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
    const ok = await confirmDialog('Delete this repayment record?');
    if (!ok) return;
    setDeletingId(id);
    try {
      await removeRepayment(id);
      setRepayments(prev => prev.filter(item => String(item._id || '') !== id));
      toast.show('Repayment deleted', { type: 'success' });
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
    const ok = await confirmDialog(`Delete ${ids.length} selected credit sale record(s)?`);
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const result = await removeManyCreditSales(ids);
      const deletedCount = Number(result?.count || 0);
      if (deletedCount <= 0) {
        toast.show('No matching credit sale records were deleted', { type: 'error' });
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
      toast.show(`Deleted ${deletedCount} credit sale record(s)`, { type: 'success' });
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
    const ok = await confirmDialog(`Delete ${ids.length} selected repayment record(s)?`);
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const result = await removeManyRepayments(ids);
      const deletedCount = Number(result?.count || 0);
      if (deletedCount <= 0) {
        toast.show('No matching repayment records were deleted', { type: 'error' });
        return;
      }
      setRepayments(prev => prev.filter(item => !ids.includes(String(item._id || ''))));
      setSelectedRepaymentIds([]);
      setBulkActionRepayments('');
      toast.show(`Deleted ${deletedCount} repayment record(s)`, { type: 'success' });
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
              <option value="retail">Retail EasyBuy</option>
              <option value="wholesale">Distribution Credit Sale</option>
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
          <div style={{ color: '#64748b', fontSize: 12 }}>Retail EasyBuy Balance</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(creditSummary.easybuyOutstanding, settings)}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Distribution Credit Balance</div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{formatCurrency(creditSummary.wholesaleOutstanding, settings)}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Pending Repayments</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{creditSummary.pendingRepaymentCount}</div>
          <div style={{ color: '#64748b', fontSize: 12 }}>{formatCurrency(creditSummary.pendingRepaymentAmount, settings)}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Due Today</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: creditSummary.dueTodayCount > 0 ? '#b45309' : undefined }}>{creditSummary.dueTodayCount}</div>
          <div style={{ color: '#64748b', fontSize: 12 }}>Good {goodClients.length} • Flagged {riskyClients.length}</div>
        </div>
      </div>
      </div>

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
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Credit Purchases</div><strong>{formatCurrency(Number(summary.summary?.totalCreditPurchases || 0), settings)}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Total Paid</div><strong>{formatCurrency(Number(summary.summary?.totalCreditPaid || 0), settings)}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Outstanding</div><strong>{formatCurrency(Number(summary.summary?.outstandingBalance || 0), settings)}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Rank</div><strong>{summary.summary?.creditRank || 'Bronze'}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Overdue Days</div><strong>{Number(summary.summary?.overdueDays || 0)}</strong></div>
            <div><div style={{ color: '#64748b', fontSize: 12 }}>Behaviour</div><strong style={{ color: Number(summary.summary?.latePayments || 0) > 0 || Number(summary.summary?.overdueDays || 0) > 0 ? '#b91c1c' : '#15803d' }}>{Number(summary.summary?.latePayments || 0) > 0 || Number(summary.summary?.overdueDays || 0) > 0 ? 'Bad / Risky' : 'Good Client'}</strong></div>
          </div>
        </div>
      )}

      {section === 'sales' && <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Active Credit Sales</h2>
          <div style={{ color: '#64748b', fontSize: 12 }}>Filtered by {branchFilter ? 'selected branch' : 'all branches'} and {sourceFilter === 'all' ? 'all sources' : sourceFilter === 'retail' ? 'Retail EasyBuy' : 'Distribution Credit Sale'}</div>
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
                    checked={shownActiveSales.length > 0 && shownActiveSales.every(row => selectedSaleIds.includes(String(row._id || row.saleId || '')))}
                    onChange={e => setSelectedSaleIds(e.target.checked ? shownActiveSales.map(row => String(row._id || row.saleId || '')).filter(Boolean) : [])}
                  />
                </th>
              )}
              <th align="left">Customer</th>
              <th align="left">Type</th>
              <th align="left">Items</th>
              <th align="left">Total</th>
              <th align="left">Paid</th>
              <th align="left">Balance</th>
              <th align="left">Penalty</th>
              <th align="left">Due Date</th>
              <th align="left">Status</th>
              <th align="left"></th>
              {canDeleteCredit && <th align="left"></th>}
            </tr>
          </thead>
          <tbody>
            {shownActiveSales.map(row => (
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
                <td>{customerMap.get(String(row.customer_id))?.name || row.customer_id}</td>
                <td>{String(row.posType || 'retail') === 'wholesale' ? 'Distribution Credit Sale' : 'Retail EasyBuy'}</td>
                <td>{Array.isArray(row.items) ? row.items.map(item => `${item.name} × ${item.qty}`).join(', ') : '—'}</td>
                <td>{formatCurrency(Number(row.total_amount || 0), settings)}</td>
                <td>{formatCurrency(Number(row.amount_paid || 0), settings)}</td>
                <td>{formatCurrency(Number(row.balance || 0), settings)}</td>
                <td>{formatCurrency(Number(row.accumulated_penalty || 0), settings)}</td>
                <td>{row.due_date ? new Date(row.due_date).toLocaleDateString() : '—'} {row.status === 'overdue' ? `• ${row.overdue_days || 0} day(s)` : ''}</td>
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
            {!loading && shownActiveSales.length === 0 && <tr><td colSpan={canDeleteCredit ? 12 : 10} style={{ padding: 12, color: '#64748b' }}>No active credit sales</td></tr>}
          </tbody>
        </table>
        </div>
      </div>}

      {section === 'repayments' && <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Repayment History</h2>
          <div style={{ color: '#64748b', fontSize: 12 }}>Filtered by {branchFilter ? 'selected branch' : 'all branches'} and {sourceFilter === 'all' ? 'all sources' : sourceFilter === 'retail' ? 'Retail EasyBuy' : 'Distribution Credit Sale'}</div>
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
                    checked={shownRepayments.length > 0 && shownRepayments.every(row => selectedRepaymentIds.includes(String(row._id || '')))}
                    onChange={e => setSelectedRepaymentIds(e.target.checked ? shownRepayments.map(row => String(row._id || '')).filter(Boolean) : [])}
                  />
                </th>
              )}
              <th align="left">Customer</th>
              <th align="left">Amount</th>
              <th align="left">Status</th>
              <th align="left">Remark</th>
              <th align="left">Created</th>
              {canDeleteCredit && <th align="left"></th>}
            </tr>
          </thead>
          <tbody>
            {shownRepayments.map(row => (
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
                <td>{customerMap.get(String(row.customerId))?.name || row.customerId}</td>
                <td>{formatCurrency(Number(row.amount || 0), settings)}</td>
                <td>{row.status}</td>
                <td>{row.remark || '—'}</td>
                <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
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
            {!loading && shownRepayments.length === 0 && <tr><td colSpan={canDeleteCredit ? 7 : 5} style={{ padding: 12, color: '#64748b' }}>No repayments recorded yet</td></tr>}
          </tbody>
        </table>
        </div>
      </div>}
    </div>
  );
}

export default CreditControlPage;
