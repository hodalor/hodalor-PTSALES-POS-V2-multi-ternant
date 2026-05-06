import { useDispatch, useSelector } from 'react-redux';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { addCustomer, setCustomers, updateCustomer, removeCustomer } from '../store/customersSlice';
import { addAudit } from '../store/auditSlice';
import { useToast } from '../components/ToastProvider';
import { confirmDialog } from '../utils/dialogs';
import * as customersApi from '../api/customers';
import { formatCurrency } from '../utils/currency';
import { isFeatureEnabled } from '../utils/featureFlags';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import Modal from '../components/Modal';
import OfflineQueueIndicator from '../components/OfflineQueueIndicator';
import InlineSpinner from '../components/InlineSpinner';
import { Bar } from 'react-chartjs-2';
import { Chart, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import LoadingDots from '../components/LoadingDots';

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function CustomersPage() {
  const customers = useSelector(s => s.customers.customers);
  const sales = useSelector(s => s.sales.sales);
  const settings = useSelector(s => s.settings);
  const branches = useSelector(s => s.branches.branches);
  const currentBranchId = useSelector(s => s.settings.currentBranchId);
  const auth = useSelector(s => s.auth);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const roleLower = String(auth.role || '').toLowerCase();
  const grants = Array.isArray(auth.grants) ? auth.grants : [];
  function has(g) {
    if (!g) return false;
    if (roleLower === 'superadmin') return true;
    return grants.includes(g);
  }
  const canAddCustomers = roleLower === 'superadmin' || has('add_customers');
  const canEditCustomers = (['admin','manager','cashier'].includes(roleLower)) || has('edit_customers');
  const canRemoveCustomers = (roleLower === 'admin' || roleLower === 'superadmin');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('view'); // view, create
  const [selectedId, setSelectedId] = useState(null);
  const [selectedTab, setSelectedTab] = useState('profile'); // profile, history
  const [savingCreate, setSavingCreate] = useState(false);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [removingId, setRemovingId] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [customerTypeFilter, setCustomerTypeFilter] = useState('all');
  const [pageTab, setPageTab] = useState('customers');
  const [leaderboardMode, setLeaderboardMode] = useState('amount');
  const [leaderboardTypeFilter, setLeaderboardTypeFilter] = useState('all');
  const purchaseHistoryEnabled = isFeatureEnabled(settings, 'tabs.customerPurchaseHistory');

  useEffect(() => {
    if (!modalOpen) return;
    if (selectedTab === 'history' && !purchaseHistoryEnabled) setSelectedTab('profile');
  }, [modalOpen, selectedTab, purchaseHistoryEnabled]);
  const [createForm, setCreateForm] = useState({
    name: '',
    phone: '',
    email: '',
    customerType: 'retail',
    dob: '',
    idType: '',
    idCardNumber: '',
    idFront: '',
    idBack: '',
    businessCertificate: '',
    address: '',
    registrationBranchId: '',
    registrationBranchName: '',
    businessName: '',
    businessAddress: '',
    registrationNumber: '',
    taxId: '',
    businessPhone: '',
    businessEmail: '',
    anniversaryDate: '',
    vip: false,
    photo: ''
  });
  const [editForm, setEditForm] = useState({
    name: '',
    phone: '',
    email: '',
    customerType: 'retail',
    dob: '',
    idType: '',
    idCardNumber: '',
    idFront: '',
    idBack: '',
    businessCertificate: '',
    address: '',
    registrationBranchId: '',
    registrationBranchName: '',
    businessName: '',
    businessAddress: '',
    registrationNumber: '',
    taxId: '',
    businessPhone: '',
    businessEmail: '',
    anniversaryDate: '',
    vip: false,
    photo: ''
  });
  const dispatch = useDispatch();
  const toast = useToast();
  const branchNameById = useMemo(() => new Map((Array.isArray(branches) ? branches : []).map((branch) => [String(branch.id || '').trim(), branch.name || branch.code || branch.id])), [branches]);
  const currentBranchName = useMemo(() => (
    branchNameById.get(String(currentBranchId || '').trim())
    || branchNameById.get(String(auth.user?.branchId || '').trim())
    || ''
  ), [auth.user?.branchId, branchNameById, currentBranchId]);

  const getRegistrationBranchLabel = useCallback((customer = {}) => (
    String(customer.registrationBranchName || '').trim()
      || branchNameById.get(String(customer.registrationBranchId || '').trim())
      || '—'
  ), [branchNameById]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const list = await customersApi.list({ limit: 2000 });
        if (!alive) return;
        dispatch(setCustomers(list));
      } catch (e) {
        if (!alive) return;
        toast.show(String(e?.message || 'Failed to load customers'), { type: 'error' });
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [dispatch, toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter(c => {
      if (customerTypeFilter !== 'all' && String(c.customerType || 'retail') !== customerTypeFilter) return false;
      if (!q) return true;
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        String(c.customerCode || '').toLowerCase().includes(q) ||
        String(c.idCardNumber || '').toLowerCase().includes(q) ||
        String(c.businessName || '').toLowerCase().includes(q) ||
        String(c.registrationNumber || '').toLowerCase().includes(q)
      );
    });
  }, [customers, query, customerTypeFilter]);
  const summary = useMemo(() => ({
    total: filtered.length,
    retail: filtered.filter(c => String(c.customerType || 'retail') !== 'distribution').length,
    distribution: filtered.filter(c => String(c.customerType || 'retail') === 'distribution').length,
    vip: filtered.filter(c => Boolean(c.vip)).length,
    businessProfiles: filtered.filter(c => String(c.businessName || '').trim() || String(c.registrationNumber || '').trim() || String(c.taxId || '').trim()).length
  }), [filtered]);
  const customerMetaMap = useMemo(() => {
    const map = new Map();
    customers.forEach((customer) => {
      const idKey = String(customer.id || customer._id || '').trim();
      const codeKey = String(customer.customerCode || '').trim();
      const nameKey = String(customer.name || '').trim().toLowerCase();
      const payload = {
        id: idKey,
        customerCode: codeKey,
        customerType: String(customer.customerType || 'retail').toLowerCase() === 'distribution' ? 'distribution' : 'retail',
        name: String(customer.name || '').trim(),
        registrationBranchId: String(customer.registrationBranchId || '').trim(),
        registrationBranchName: String(customer.registrationBranchName || '').trim()
      };
      if (idKey) map.set(`id:${idKey}`, payload);
      if (codeKey) map.set(`code:${codeKey}`, payload);
      if (nameKey) map.set(`name:${nameKey}`, payload);
    });
    return map;
  }, [customers]);
  const customerLeaderboardRows = useMemo(() => {
    const rows = new Map();
    sales.forEach((sale) => {
      const customerId = String(sale.customerId || '').trim();
      const customerCode = String(sale.customerCode || '').trim();
      const customerName = String(sale.customerName || '').trim();
      const fallbackName = customerName || customerCode || customerId;
      const normalizedFallbackName = fallbackName.toLowerCase();
      if (!fallbackName || ['walk-in', 'walk in', '-', '—'].includes(normalizedFallbackName)) return;
      const matched = customerMetaMap.get(`id:${customerId}`) || customerMetaMap.get(`code:${customerCode}`) || customerMetaMap.get(`name:${normalizedFallbackName}`) || null;
      const customerType = matched?.customerType || 'retail';
      if (leaderboardTypeFilter !== 'all' && customerType !== leaderboardTypeFilter) return;
      const key = matched?.id || customerId || customerCode || normalizedFallbackName;
      if (!rows.has(key)) {
        rows.set(key, {
          key,
          customerName: matched?.name || fallbackName,
          customerCode: matched?.customerCode || customerCode,
          customerType,
          sales: 0,
          amount: 0,
          products: 0
        });
      }
      const row = rows.get(key);
      row.sales += 1;
      row.amount += Number(sale.total || 0);
      (Array.isArray(sale.items) ? sale.items : []).forEach((item) => {
        row.products += Number(item.qty || 0);
      });
    });
    const list = Array.from(rows.values());
    list.sort((a, b) => (
      leaderboardMode === 'products'
        ? (b.products - a.products || b.amount - a.amount || a.customerName.localeCompare(b.customerName))
        : (b.amount - a.amount || b.products - a.products || a.customerName.localeCompare(b.customerName))
    ));
    return list;
  }, [customerMetaMap, leaderboardMode, leaderboardTypeFilter, sales]);
  const topCustomerLeaderboardRows = useMemo(() => customerLeaderboardRows.slice(0, 10), [customerLeaderboardRows]);
  const customerLeaderboardChart = useMemo(() => {
    const label = leaderboardMode === 'products' ? 'Products Bought' : 'Amount Spent';
    return {
      labels: topCustomerLeaderboardRows.map((row) => row.customerName),
      datasets: [{
        label,
        data: topCustomerLeaderboardRows.map((row) => +(leaderboardMode === 'products' ? row.products : row.amount).toFixed(2)),
        backgroundColor: leaderboardMode === 'products' ? '#0ea5e9' : '#2563eb',
        borderRadius: 6,
        maxBarThickness: 28,
        categoryPercentage: 0.7,
        barPercentage: 0.8
      }]
    };
  }, [leaderboardMode, topCustomerLeaderboardRows]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return customers.find(c => String(c.id) === String(selectedId)) || null;
  }, [customers, selectedId]);

  const history = useMemo(() => {
    if (!selected) return [];
    const sid = String(selected.id);
    const sc = String(selected.customerCode || '');
    return sales.filter(s => String(s.customerId || '') === sid || (sc && String(s.customerCode || '') === sc));
  }, [sales, selected]);
  const paymentSummary = useMemo(() => {
    if (!selected) return { paidCount: 0, creditCount: 0, paidTotal: 0, creditTotal: 0 };
    return history.reduce((acc, sale) => {
      const hasCredit = Array.isArray(sale.payment_methods) && sale.payment_methods.some(p => String(p.type || '').toLowerCase() === 'easybuy');
      const total = Number(sale.total || 0);
      if (hasCredit) {
        acc.creditCount += 1;
        acc.creditTotal += total;
      } else {
        acc.paidCount += 1;
        acc.paidTotal += total;
      }
      return acc;
    }, { paidCount: 0, creditCount: 0, paidTotal: 0, creditTotal: 0 });
  }, [history, selected]);

  const activeProfile = useMemo(() => {
    return modalMode === 'create' ? createForm : editForm;
  }, [modalMode, createForm, editForm]);
  const detailRows = useMemo(() => ([
    ['Customer Type', String(activeProfile.customerType || 'retail') === 'distribution' ? 'Distribution Customer' : 'Retail Customer'],
    ['Phone', activeProfile.phone || '—'],
    ['Email', activeProfile.email || '—'],
    ['DOB', activeProfile.dob || '—'],
    ['Anniversary', activeProfile.anniversaryDate || '—'],
    ['ID Type', activeProfile.idType || '—'],
    ['ID Number', activeProfile.idCardNumber || '—'],
    ['Address', activeProfile.address || '—'],
    ['Registered At Branch', getRegistrationBranchLabel(activeProfile)],
    ['Business Name', activeProfile.businessName || '—'],
    ['Business Address', activeProfile.businessAddress || '—'],
    ['Registration Number', activeProfile.registrationNumber || '—'],
    ['Tax ID', activeProfile.taxId || '—'],
    ['Business Phone', activeProfile.businessPhone || '—'],
    ['Business Email', activeProfile.businessEmail || '—']
  ]), [activeProfile, getRegistrationBranchLabel]);
  const uploadedDocuments = useMemo(() => ([
    { key: 'photo', label: 'Photo', value: activeProfile.photo || '' },
    { key: 'idFront', label: 'ID Front', value: activeProfile.idFront || '' },
    { key: 'idBack', label: 'ID Back', value: activeProfile.idBack || '' },
    { key: 'businessCertificate', label: 'Business Certificate', value: activeProfile.businessCertificate || '' }
  ]).filter((item) => item.value), [activeProfile]);

  function setPhotoFromFile(file, setter, field = 'photo') {
    if (!file) {
      setter(prev => ({ ...prev, [field]: '' }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.show('Upload is too large (max 2MB)', { type: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setter(prev => ({ ...prev, [field]: String(reader.result || '') }));
    reader.readAsDataURL(file);
  }

  function downloadDataUrl(filename, dataUrl) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
  }

  function openCreate() {
    if (!canAddCustomers) { toast.show('Not authorized to add customers', { type: 'error' }); return; }
    setModalMode('create');
    setSelectedId(null);
    setSelectedTab('profile');
    setCreateForm({ name: '', phone: '', email: '', customerType: 'retail', dob: '', idType: '', idCardNumber: '', idFront: '', idBack: '', businessCertificate: '', address: '', registrationBranchId: String(currentBranchId || auth.user?.branchId || '').trim(), registrationBranchName: currentBranchName, businessName: '', businessAddress: '', registrationNumber: '', taxId: '', businessPhone: '', businessEmail: '', anniversaryDate: '', vip: false, photo: '' });
    setModalOpen(true);
  }

  function openCustomer(c) {
    setModalMode('view');
    setSelectedId(c.id);
    setSelectedTab('profile');
    startEditSelected(c);
    setModalOpen(true);
  }

  async function create() {
    if (!canAddCustomers) { toast.show('Not authorized to add customers', { type: 'error' }); return; }
    if (savingCreate) return;
    if (!createForm.name.trim()) { toast.show('Name is required', { type: 'error' }); return; }
    setSavingCreate(true);
    try {
      const payload = {
        name: createForm.name.trim(),
        phone: createForm.phone.trim(),
        email: createForm.email.trim(),
        customerType: createForm.customerType,
        dob: createForm.dob || null,
        idType: createForm.idType.trim(),
        idCardNumber: createForm.idCardNumber.trim(),
        idFront: createForm.idFront || '',
        idBack: createForm.idBack || '',
        businessCertificate: createForm.businessCertificate || '',
        address: createForm.address.trim(),
        registrationBranchId: String(createForm.registrationBranchId || currentBranchId || auth.user?.branchId || '').trim(),
        registrationBranchName: String(createForm.registrationBranchName || currentBranchName || '').trim(),
        businessName: createForm.businessName.trim(),
        businessAddress: createForm.businessAddress.trim(),
        registrationNumber: createForm.registrationNumber.trim(),
        taxId: createForm.taxId.trim(),
        businessPhone: createForm.businessPhone.trim(),
        businessEmail: createForm.businessEmail.trim(),
        anniversaryDate: createForm.anniversaryDate || null,
        vip: Boolean(createForm.vip),
        photo: createForm.photo || ''
      };
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return;
        }
        const clientId = `offline-customer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const offlineRow = { ...payload, id: clientId, clientId, customerCode: `OFF-${String(Date.now()).slice(-6)}`, loyaltyPoints: 0, offline: true };
        dispatch(addCustomer(offlineRow));
        dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'customer_add', details: { id: clientId, name: payload.name }, offline: true }));
        await enqueueHttp({ collection: 'customers', label: 'Customer', path: '/api/customers', method: 'POST', body: { ...payload, clientId } });
        setSelectedId(String(clientId));
        setSelectedTab('profile');
        setModalMode('view');
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
      } else {
        const created = await customersApi.create({ ...payload, clientId: crypto.randomUUID() });
        dispatch(addCustomer(created));
        dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'customer_add', details: { id: created.id || created._id, name: created.name } }));
        setSelectedId(String(created.id || created._id));
        setSelectedTab('profile');
        toast.show('Customer added', { type: 'success' });
        try {
          const list = await customersApi.list({ limit: 2000 });
          dispatch(setCustomers(list));
        } catch {}
        setModalMode('view');
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to add customer'), { type: 'error' });
    } finally {
      setSavingCreate(false);
    }
  }

  function startEditSelected(c) {
    const target = c || selected;
    if (!target) return;
    if (!canEditCustomers) { toast.show('Not authorized to edit customers', { type: 'error' }); return; }
    setEditForm({
      name: target.name || '',
      phone: target.phone || '',
      email: target.email || '',
      customerType: target.customerType || 'retail',
      dob: target.dob ? String(target.dob).slice(0, 10) : '',
      idType: target.idType || '',
      idCardNumber: target.idCardNumber || '',
      idFront: target.idFront || '',
      idBack: target.idBack || '',
      businessCertificate: target.businessCertificate || '',
      address: target.address || '',
      registrationBranchId: target.registrationBranchId || '',
      registrationBranchName: target.registrationBranchName || '',
      businessName: target.businessName || '',
      businessAddress: target.businessAddress || '',
      registrationNumber: target.registrationNumber || '',
      taxId: target.taxId || '',
      businessPhone: target.businessPhone || '',
      businessEmail: target.businessEmail || '',
      anniversaryDate: target.anniversaryDate ? String(target.anniversaryDate).slice(0, 10) : '',
      vip: Boolean(target.vip),
      photo: target.photo || ''
    });
  }

  async function saveEdit() {
    if (!selected) return;
    if (!canEditCustomers) { toast.show('Not authorized to edit customers', { type: 'error' }); return; }
    if (savingUpdate) return;
    if (!editForm.name.trim()) { toast.show('Name is required', { type: 'error' }); return; }
    setSavingUpdate(true);
    try {
      const payload = {
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        email: editForm.email.trim(),
        customerType: editForm.customerType,
        dob: editForm.dob || null,
        idType: editForm.idType.trim(),
        idCardNumber: editForm.idCardNumber.trim(),
        idFront: editForm.idFront || '',
        idBack: editForm.idBack || '',
        businessCertificate: editForm.businessCertificate || '',
        address: editForm.address.trim(),
        businessName: editForm.businessName.trim(),
        businessAddress: editForm.businessAddress.trim(),
        registrationNumber: editForm.registrationNumber.trim(),
        taxId: editForm.taxId.trim(),
        businessPhone: editForm.businessPhone.trim(),
        businessEmail: editForm.businessEmail.trim(),
        anniversaryDate: editForm.anniversaryDate || null,
        vip: Boolean(editForm.vip),
        photo: editForm.photo || ''
      };
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return;
        }
        dispatch(updateCustomer({ id: selected.id, ...payload, offline: true }));
        dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'customer_update', details: { id: selected.id }, offline: true }));
        await enqueueHttp({ collection: 'customers', label: 'Customer update', path: `/api/customers/${encodeURIComponent(selected.id)}`, method: 'PUT', body: payload });
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
      } else {
        const updated = await customersApi.update(selected.id, payload);
        dispatch(updateCustomer({ id: selected.id, ...updated }));
        dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'customer_update', details: { id: selected.id } }));
        toast.show('Customer updated', { type: 'success' });
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to update customer'), { type: 'error' });
    } finally {
      setSavingUpdate(false);
    }
  }
  async function remove(id) {
    if (!canRemoveCustomers) { toast.show('Only Admin can remove customers', { type: 'error' }); return; }
    const ok = await confirmDialog('Remove this customer?');
    if (!ok) return;
    try {
      setRemovingId(String(id));
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return;
        }
        dispatch(removeCustomer(id));
        dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'customer_remove', details: { id }, offline: true }));
        await enqueueHttp({ collection: 'customers', label: 'Customer delete', path: `/api/customers/${encodeURIComponent(id)}`, method: 'DELETE', body: {} });
        if (String(selectedId) === String(id)) setSelectedId(null);
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
      } else {
        await customersApi.remove(id);
        dispatch(removeCustomer(id));
        dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'customer_remove', details: { id } }));
        if (String(selectedId) === String(id)) setSelectedId(null);
        toast.show('Customer removed', { type: 'success' });
      }
    } catch (e) {
      toast.show(String(e?.message || 'Failed to remove customer'), { type: 'error' });
    } finally {
      setRemovingId('');
    }
  }

  async function removeSelected() {
    if (!canRemoveCustomers) { toast.show('Only Admin can remove customers', { type: 'error' }); return; }
    const ids = selectedIds.filter(Boolean);
    if (ids.length === 0) return;
    const ok = await confirmDialog(`Remove ${ids.length} selected customer(s)?`);
    if (!ok) return;
    try {
      setBulkDeleting(true);
      await customersApi.removeMany(ids);
      ids.forEach(id => dispatch(removeCustomer(id)));
      if (selectedId && ids.includes(String(selectedId))) setSelectedId(null);
      setSelectedIds([]);
      setBulkAction('');
      toast.show('Customers removed', { type: 'success' });
    } catch (e) {
      toast.show(String(e?.message || 'Failed to remove selected customers'), { type: 'error' });
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Customers</h1>
          <div className="page-subtitle-compact">Manage customer profiles, business details, loyalty data, and customer rankings from one place.</div>
        </div>
        <div className="page-header-actions">
          <OfflineQueueIndicator collection="customers" label="Customers queued" />
          {canAddCustomers && (
            <button className="btn btn-primary" onClick={openCreate}>
              <svg viewBox="0 0 24 24" fill="none" style={{ marginRight: 6 }}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
              Add Customer
            </button>
          )}
        </div>
      </div>
      <div className="page-tabs">
        <button className={pageTab === 'customers' ? 'btn btn-primary' : 'btn'} onClick={() => setPageTab('customers')}>Customers</button>
        <button className={pageTab === 'leaderboard' ? 'btn btn-primary' : 'btn'} onClick={() => setPageTab('leaderboard')}>Customer Leaderboard</button>
      </div>
      <div className="stats-grid">
        <div className="card stat-card"><div className="stat-label">Customers</div><div className="stat-value">{summary.total}</div></div>
        <div className="card stat-card"><div className="stat-label">Retail</div><div className="stat-value">{summary.retail}</div></div>
        <div className="card stat-card"><div className="stat-label">Distribution</div><div className="stat-value">{summary.distribution}</div></div>
        <div className="card stat-card"><div className="stat-label">VIP</div><div className="stat-value">{summary.vip}</div></div>
        <div className="card stat-card"><div className="stat-label">Business Profiles</div><div className="stat-value">{summary.businessProfiles}</div></div>
      </div>

      {pageTab === 'leaderboard' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>Customer Leaderboard</h2>
                <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
                  Full ranking for all matching customers.
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, minWidth: 'min(100%, 420px)' }}>
                <label>
                  <div className="field-label">Rank By</div>
                  <select className="select" value={leaderboardMode} onChange={e => setLeaderboardMode(e.target.value)}>
                    <option value="amount">Amount Spent</option>
                    <option value="products">Products Bought</option>
                  </select>
                </label>
                <label>
                  <div className="field-label">Customer Type</div>
                  <select className="select" value={leaderboardTypeFilter} onChange={e => setLeaderboardTypeFilter(e.target.value)}>
                    <option value="all">All Customers</option>
                    <option value="retail">Retail Customers</option>
                    <option value="distribution">Distribution Customers</option>
                  </select>
                </label>
              </div>
            </div>
            <div style={{ height: 260 }}>
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
                          if (leaderboardMode === 'products') return `${ctx.label || 'Customer'}: ${raw} products`;
                          return `${ctx.label || 'Customer'}: ${formatCurrency(raw, settings)}`;
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
                      beginAtZero: true
                    }
                  }
                }}
              />
            </div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 10 }}>
              Showing {customerLeaderboardRows.length} ranked customer{customerLeaderboardRows.length === 1 ? '' : 's'}.
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th align="left">Rank</th>
                  <th align="left">Customer</th>
                  <th align="left">Customer ID</th>
                  <th align="left">Type</th>
                  <th align="left">Registered At</th>
                  <th align="left">Sales</th>
                  <th align="left">Products</th>
                  <th align="left">Amount</th>
                </tr>
              </thead>
              <tbody>
                {customerLeaderboardRows.map((row, idx) => (
                  <tr key={row.key}>
                    <td>{idx + 1}</td>
                    <td style={{ fontWeight: 700 }}>{row.customerName}</td>
                    <td>{row.customerCode || '—'}</td>
                    <td>{row.customerType === 'distribution' ? 'Distribution' : 'Retail'}</td>
                    <td>{getRegistrationBranchLabel(row)}</td>
                    <td>{row.sales}</td>
                    <td>{row.products}</td>
                    <td>{formatCurrency(row.amount, settings)}</td>
                  </tr>
                ))}
                {customerLeaderboardRows.length === 0 && <tr><td colSpan="8" style={{ padding: 12, color: '#64748b' }}>No ranked customer data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pageTab === 'customers' && (
      <div className="card">
        <div className="toolbar-inline" style={{ marginBottom: 8 }}>
          <input className="input" placeholder="Search by name, phone, email, ID" value={query} onChange={e => setQuery(e.target.value)} />
          <select className="select" value={customerTypeFilter} onChange={e => setCustomerTypeFilter(e.target.value)} style={{ minWidth: 220 }}>
            <option value="all">All Customer Types</option>
            <option value="retail">Retail Customers</option>
            <option value="distribution">Distribution Customers</option>
          </select>
          {canRemoveCustomers && (
            <>
              <select className="select" value={bulkAction} onChange={e => setBulkAction(e.target.value)} disabled={bulkDeleting}>
                <option value="">Actions</option>
                <option value="delete">Delete Selected</option>
              </select>
              <button className="btn" disabled={bulkDeleting || bulkAction !== 'delete' || selectedIds.length === 0} onClick={() => void removeSelected()}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {bulkDeleting && <InlineSpinner />}
                  {bulkDeleting ? 'Deleting…' : 'Apply'}
                </span>
              </button>
            </>
          )}
        </div>
        <table className="table">
          <thead>
            <tr>
              {canRemoveCustomers && (
                <th align="left">
                  <input
                    type="checkbox"
                    disabled={bulkDeleting}
                    checked={filtered.length > 0 && filtered.every(c => selectedIds.includes(String(c.id)))}
                    onChange={e => setSelectedIds(e.target.checked ? filtered.map(c => String(c.id)).filter(Boolean) : [])}
                  />
                </th>
              )}
              <th align="left">Customer</th>
              <th align="left">Customer ID</th>
              <th align="left">Type</th>
              <th align="left">Registered At</th>
              <th align="left">Phone</th>
              <th align="left">Email</th>
              <th align="left">Business</th>
              <th align="left">Points</th>
              <th align="left">VIP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} style={{ cursor: bulkDeleting ? 'default' : 'pointer', opacity: bulkDeleting && selectedIds.includes(String(c.id)) ? 0.55 : 1 }} onClick={() => { if (!bulkDeleting) openCustomer(c); }}>
                {canRemoveCustomers && (
                  <td onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      disabled={bulkDeleting}
                      checked={selectedIds.includes(String(c.id))}
                      onChange={e => setSelectedIds(prev => e.target.checked ? [...new Set([...prev, String(c.id)])] : prev.filter(id => id !== String(c.id)))}
                    />
                  </td>
                )}
                <td style={{ fontWeight: 700 }}>{c.name}</td>
                <td>{c.customerCode || '—'}</td>
                <td>{String(c.customerType || 'retail') === 'distribution' ? 'Distribution' : 'Retail'}</td>
                <td>{getRegistrationBranchLabel(c)}</td>
                <td>{c.phone || '—'}</td>
                <td>{c.email || '—'}</td>
                <td>{c.businessName || '—'}</td>
                <td>{Number(c.loyaltyPoints || 0)}</td>
                <td>{c.vip ? 'Yes' : 'No'}</td>
              </tr>
            ))}
            {loading && <tr><td colSpan={canRemoveCustomers ? 10 : 9} style={{ padding: 12, color: '#64748b' }}><LoadingDots label="Loading customers" /></td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={canRemoveCustomers ? 10 : 9} style={{ padding: 12, color: '#64748b' }}>No customers</td></tr>}
          </tbody>
        </table>
      </div>
      )}

      {modalOpen && (
        <Modal
          title={modalMode === 'create' ? 'Add Customer' : (selected ? `${selected.name} (${selected.customerCode || '—'})` : 'Customer')}
          onClose={() => setModalOpen(false)}
          footer={
            modalMode === 'create' ? (
              <>
                <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={create} disabled={savingCreate}>
                  {savingCreate ? 'Saving…' : 'Save Customer'}
                </button>
              </>
            ) : (
              <>
                {selected && canRemoveCustomers && (
                  <button className="btn" onClick={() => remove(selected.id)} disabled={removingId === String(selected.id)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {removingId === String(selected.id) && <InlineSpinner />}
                      {removingId === String(selected.id) ? 'Removing…' : 'Remove'}
                    </span>
                  </button>
                )}
                <button className="btn" onClick={() => setModalOpen(false)}>Close</button>
                {selected && (
                  <button className="btn btn-primary" onClick={saveEdit} disabled={!canEditCustomers || savingUpdate}>
                    {savingUpdate ? 'Saving…' : 'Save Changes'}
                  </button>
                )}
              </>
            )
          }
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className={selectedTab === 'profile' ? 'btn btn-primary' : 'btn'} onClick={() => setSelectedTab('profile')}>Profile</button>
            {modalMode !== 'create' && purchaseHistoryEnabled && (
              <button className={selectedTab === 'history' ? 'btn btn-primary' : 'btn'} onClick={() => setSelectedTab('history')}>Purchase History</button>
            )}
          </div>

          {selectedTab === 'profile' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="card" style={{ padding: 12, color: '#0f172a' }}>
                <div style={{ fontWeight: 800, marginBottom: 10, color: '#0f172a' }}>Profile</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, alignItems: 'start' }}>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Name</div>
                    <input className="input" value={activeProfile.name} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, name: e.target.value })) : setEditForm(p => ({ ...p, name: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Phone</div>
                    <input className="input" value={activeProfile.phone} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, phone: e.target.value })) : setEditForm(p => ({ ...p, phone: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Email</div>
                    <input className="input" value={activeProfile.email} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, email: e.target.value })) : setEditForm(p => ({ ...p, email: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Customer Type</div>
                    <select className="select" value={activeProfile.customerType || 'retail'} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, customerType: e.target.value })) : setEditForm(p => ({ ...p, customerType: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers}>
                      <option value="retail">Retail Customer</option>
                      <option value="distribution">Distribution Customer</option>
                    </select>
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>DOB</div>
                    <input className="input" type="date" value={activeProfile.dob} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, dob: e.target.value })) : setEditForm(p => ({ ...p, dob: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Anniversary</div>
                    <input className="input" type="date" value={activeProfile.anniversaryDate} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, anniversaryDate: e.target.value })) : setEditForm(p => ({ ...p, anniversaryDate: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>ID Type</div>
                    <select className="select" value={activeProfile.idType || ''} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, idType: e.target.value })) : setEditForm(p => ({ ...p, idType: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers}>
                      <option value="">Select ID Type</option>
                      <option value="voter_id">Voter ID</option>
                      <option value="passport">Passport</option>
                      <option value="drivers_license">Driver's License</option>
                      <option value="national_id">National ID</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>ID Number</div>
                    <input className="input" value={activeProfile.idCardNumber} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, idCardNumber: e.target.value })) : setEditForm(p => ({ ...p, idCardNumber: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24 }}>
                    <input type="checkbox" checked={!!activeProfile.vip} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, vip: e.target.checked })) : setEditForm(p => ({ ...p, vip: e.target.checked })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                    VIP
                  </label>
                  <label style={{ gridColumn: '1 / span 2' }}>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Address</div>
                    <input className="input" value={activeProfile.address} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, address: e.target.value })) : setEditForm(p => ({ ...p, address: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                </div>
              </div>

              <div className="card" style={{ padding: 12, color: '#0f172a' }}>
                <div style={{ fontWeight: 800, marginBottom: 10, color: '#0f172a' }}>Business Details</div>
                <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>Optional information for business customers.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Business Name</div>
                    <input className="input" value={activeProfile.businessName || ''} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, businessName: e.target.value })) : setEditForm(p => ({ ...p, businessName: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Registration Number</div>
                    <input className="input" value={activeProfile.registrationNumber || ''} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, registrationNumber: e.target.value })) : setEditForm(p => ({ ...p, registrationNumber: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Tax ID</div>
                    <input className="input" value={activeProfile.taxId || ''} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, taxId: e.target.value })) : setEditForm(p => ({ ...p, taxId: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Business Phone</div>
                    <input className="input" value={activeProfile.businessPhone || ''} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, businessPhone: e.target.value })) : setEditForm(p => ({ ...p, businessPhone: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Business Email</div>
                    <input className="input" value={activeProfile.businessEmail || ''} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, businessEmail: e.target.value })) : setEditForm(p => ({ ...p, businessEmail: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label style={{ gridColumn: '1 / span 2' }}>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Business Address</div>
                    <input className="input" value={activeProfile.businessAddress || ''} onChange={e => (modalMode === 'create' ? setCreateForm(p => ({ ...p, businessAddress: e.target.value })) : setEditForm(p => ({ ...p, businessAddress: e.target.value })))} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                </div>
              </div>

              <div className="card" style={{ padding: 12, color: '#0f172a' }}>
                <div style={{ fontWeight: 800, marginBottom: 10, color: '#0f172a' }}>Documents & Images</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Photo</div>
                    <input className="input" type="file" accept="image/*" onChange={e => setPhotoFromFile(e.target.files?.[0], modalMode === 'create' ? setCreateForm : setEditForm, 'photo')} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>ID Front</div>
                    <input className="input" type="file" accept="image/*" onChange={e => setPhotoFromFile(e.target.files?.[0], modalMode === 'create' ? setCreateForm : setEditForm, 'idFront')} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>ID Back</div>
                    <input className="input" type="file" accept="image/*" onChange={e => setPhotoFromFile(e.target.files?.[0], modalMode === 'create' ? setCreateForm : setEditForm, 'idBack')} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                  <label>
                    <div style={{ marginBottom: 6, color: '#0f172a', fontSize: 12, fontWeight: 600 }}>Business Certificate</div>
                    <input className="input" type="file" accept="image/*,.pdf" onChange={e => setPhotoFromFile(e.target.files?.[0], modalMode === 'create' ? setCreateForm : setEditForm, 'businessCertificate')} disabled={modalMode !== 'create' && !canEditCustomers} />
                  </label>
                </div>
                {modalMode !== 'create' && (
                  <div className="card" style={{ padding: 12, marginTop: 12 }}>
                    <div style={{ fontWeight: 800, marginBottom: 8, color: '#0f172a' }}>Collected Details</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                      {detailRows.map(([label, value]) => (
                        <div key={label} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, background: '#fff' }}>
                          <div style={{ color: '#475569', fontSize: 12 }}>{label}</div>
                          <div style={{ color: '#0f172a', fontWeight: 700, wordBreak: 'break-word' }}>{value || '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
                  {uploadedDocuments.map((doc) => (
                    <div key={doc.key} className="card" style={{ padding: 10 }}>
                      <div style={{ fontSize: 12, color: '#475569', marginBottom: 6 }}>{doc.label}</div>
                      {String(doc.value).startsWith('data:application/pdf')
                        ? <iframe title={doc.label} src={doc.value} style={{ width: '100%', height: 180, border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 8, background: '#fff' }} />
                        : <img src={doc.value} alt={doc.label} style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 8, marginBottom: 8 }} />}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <a className="btn" href={doc.value} target="_blank" rel="noreferrer">Preview</a>
                        <button className="btn" type="button" onClick={() => downloadDataUrl(`${doc.key}-${activeProfile.name || 'customer'}`, doc.value)}>Download</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {modalMode !== 'create' && selected?.loyaltyPoints != null && (
                <div style={{ color: '#94a3b8' }}>
                  Loyalty points: {Number(selected.loyaltyPoints || 0)}
                </div>
              )}
              {modalMode !== 'create' && selected && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 8 }}>
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ color: '#64748b', fontSize: 12 }}>Outstanding Credit</div>
                    <strong>{formatCurrency(Number(selected.outstandingBalance || 0), settings)}</strong>
                  </div>
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ color: '#64748b', fontSize: 12 }}>Credit Purchases</div>
                    <strong>{paymentSummary.creditCount} sale(s)</strong>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>{formatCurrency(paymentSummary.creditTotal, settings)}</div>
                  </div>
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ color: '#64748b', fontSize: 12 }}>Paid Purchases</div>
                    <strong>{paymentSummary.paidCount} sale(s)</strong>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>{formatCurrency(paymentSummary.paidTotal, settings)}</div>
                  </div>
                  <div className="card" style={{ padding: 12 }}>
                    <div style={{ color: '#64748b', fontSize: 12 }}>Credit Rank</div>
                    <strong style={{ color: Number(selected.overdueDays || 0) > 0 ? '#b91c1c' : '#15803d' }}>{selected.creditRank || 'Bronze'}</strong>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>Score {Number(selected.creditScore || 0)}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedTab === 'history' && (
            <table className="table">
              <thead>
                <tr>
                  <th align="left">Date</th>
                  <th align="left">Invoice</th>
                  <th align="left">Payment Type</th>
                  <th align="left">Items</th>
                  <th align="left">Total</th>
                </tr>
              </thead>
              <tbody>
                {history.map(s => (
                  <tr key={s.id || s._id}>
                    <td>{new Date(s.created_at).toLocaleString()}</td>
                    <td>{s.invoiceSerial || '—'}</td>
                    <td>{Array.isArray(s.payment_methods) && s.payment_methods.some(p => String(p.type || '').toLowerCase() === 'easybuy') ? 'Credit' : 'Paid'}</td>
                    <td>{(s.items || []).map(i => `${i.name}x${i.qty}`).join(', ')}</td>
                    <td>{formatCurrency(Number(s.total) || 0, settings)}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr><td colSpan="5" style={{ padding: 12, color: '#94a3b8' }}>No purchases</td></tr>
                )}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  );
}

export default CustomersPage;
