import { useDispatch, useSelector } from 'react-redux';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { productSpec } from '../utils/productSpec';
import { formatCurrency } from '../utils/currency';
import { useToast } from '../components/ToastProvider';
import { addCustomer } from '../store/customersSlice';
import { addInvoice } from '../store/invoicesSlice';
import { setNextInvoiceNumber, setNextWarehouseInvoiceNumber, setNextWholesaleInvoiceNumber } from '../store/settingsSlice';
import { buildInvoiceA4Html, printInvoiceA4 } from '../utils/invoicePrint';
import * as invoicesApi from '../api/invoices';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import { isFeatureEnabled } from '../utils/featureFlags';
import { getAllowedPriceTiers, getDisplayPrice, getPreferredPriceTier, getPriceTierLabel } from '../utils/priceVisibility';

const MANUAL_INVOICE_PRICE_TIERS = ['retail', 'wholesale', 'agent'];

function InvoicesPage({ mode = 'retail' }) {
  const dispatch = useDispatch();
  const toast = useToast();
  const settings = useSelector(s => s.settings);
  const products = useSelector(s => s.products.products);
  const customers = useSelector(s => s.customers.customers);
  const invoices = useSelector(s => s.invoices.invoices);
  const auth = useSelector(s => s.auth);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('new');
  const [invoiceKind, setInvoiceKind] = useState(mode === 'retail' ? 'all' : mode); // all, retail, wholesale, warehouse
  const showNewTab = isFeatureEnabled(settings, 'tabs.invoiceNew');
  const showRecordsTab = isFeatureEnabled(settings, 'tabs.invoiceRecords');
  useEffect(() => {
    if (tab === 'new' && !showNewTab) {
      if (showRecordsTab) setTab('records');
    }
    if (tab === 'records' && !showRecordsTab) {
      if (showNewTab) setTab('new');
    }
  }, [showNewTab, showRecordsTab, tab]);
  const [searchTerm, setSearchTerm] = useState('');
  const [items, setItems] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [adhocName, setAdhocName] = useState('');
  const [adhocBusinessName, setAdhocBusinessName] = useState('');
  const [adhocContact, setAdhocContact] = useState('');
  const [adhocAddress, setAdhocAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [otherRef, setOtherRef] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [buyerOrderNo, setBuyerOrderNo] = useState('');
  const [despatchDocNo, setDespatchDocNo] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [despatchedThrough, setDespatchedThrough] = useState('In person');
  const [despatchCustom, setDespatchCustom] = useState('');
  const [destination, setDestination] = useState('');
  const [termsOfDelivery, setTermsOfDelivery] = useState('');
  const [saving, setSaving] = useState(false);
  const offlineBackupAllowed = isOfflineBackupEnabled(settings);
  const modeLower = String(mode || 'retail').toLowerCase();
  const allowedPriceTiers = useMemo(() => getAllowedPriceTiers(auth), [auth]);
  const preferredModeTier = modeLower === 'retail' ? 'retail' : 'wholesale';
  const activeInvoiceTier = useMemo(() => getPreferredPriceTier(allowedPriceTiers, preferredModeTier), [allowedPriceTiers, preferredModeTier]);
  const selectableInvoiceTiers = useMemo(() => (
    modeLower === 'retail'
      ? allowedPriceTiers.filter((tier) => tier !== 'warehouse')
      : MANUAL_INVOICE_PRICE_TIERS.slice()
  ), [allowedPriceTiers, modeLower]);
  const [selectedInvoiceTier, setSelectedInvoiceTier] = useState(activeInvoiceTier);
  const pageTitle = modeLower === 'wholesale' ? 'Distribution Invoices' : modeLower === 'warehouse' ? 'Warehouse Invoices' : 'Invoices';
  const invoiceSource = modeLower === 'wholesale' ? 'wholesale-manual' : modeLower === 'warehouse' ? 'warehouse-manual' : 'manual';
  const invoicePrefix = modeLower === 'wholesale'
    ? (settings.wholesaleInvoicePrefix || 'WINV')
    : modeLower === 'warehouse'
      ? (settings.warehouseInvoicePrefix || 'WHINV')
      : (settings.invoicePrefix || 'INV');
  const nextInvoiceNumberValue = modeLower === 'wholesale'
    ? Number(settings.nextWholesaleInvoiceNumber || 1)
    : modeLower === 'warehouse'
      ? Number(settings.nextWarehouseInvoiceNumber || 1)
      : Number(settings.nextInvoiceNumber || 1);
  useEffect(() => {
    const fallbackTier = selectableInvoiceTiers.includes(selectedInvoiceTier)
      ? selectedInvoiceTier
      : (selectableInvoiceTiers[0] || activeInvoiceTier);
    if (fallbackTier !== selectedInvoiceTier) setSelectedInvoiceTier(fallbackTier);
  }, [activeInvoiceTier, selectableInvoiceTiers, selectedInvoiceTier]);

  const defaultRateFor = useCallback((p) => (
    getDisplayPrice(p, selectedInvoiceTier)
  ), [selectedInvoiceTier]);

  const resolveSellableRate = useCallback((productId, variantId = '') => {
    const source = products.find((product) => String(product.id) === String(productId));
    if (!source) return 0;
    const variant = variantId && Array.isArray(source.variants)
      ? source.variants.find((item) => String(item.id) === String(variantId))
      : null;
    const priceSource = variant
      ? { ...source, ...variant, price: variant.price != null ? variant.price : source.price }
      : source;
    return getDisplayPrice(priceSource, selectedInvoiceTier);
  }, [products, selectedInvoiceTier]);
  const bumpInvoiceSequence = useCallback(() => {
    if (modeLower === 'wholesale') dispatch(setNextWholesaleInvoiceNumber(nextInvoiceNumberValue + 1));
    else if (modeLower === 'warehouse') dispatch(setNextWarehouseInvoiceNumber(nextInvoiceNumberValue + 1));
    else dispatch(setNextInvoiceNumber(nextInvoiceNumberValue + 1));
  }, [dispatch, modeLower, nextInvoiceNumberValue]);

  const sellables = useMemo(() => {
    const out = [];
    products.forEach(p => {
      if (Array.isArray(p.variants) && p.variants.length > 0) {
        p.variants.forEach(v => {
          out.push({
            id: `${p.id}:${v.id}`,
            productId: p.id,
            variantId: v.id,
            name: `${p.name} (${v.label})`,
            sku: v.sku || `${p.sku}-${v.label}`,
            price: defaultRateFor({ ...p, ...v, price: v.price != null ? v.price : p.price }),
            image: p.image,
            unitSymbol: p.unitSymbol || 'pcs',
            attributes: p.attributes
          });
        });
      } else {
        out.push({ ...p, price: defaultRateFor(p), unitSymbol: p.unitSymbol || 'pcs' });
      }
    });
    return out;
  }, [products, defaultRateFor]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sellables;
    return sellables.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q) ||
      productSpec(p).toLowerCase().includes(q)
    );
  }, [sellables, query]);

  const selectedCustomer = useMemo(() => {
    if (!customerId) return null;
    return customers.find(c => String(c.id) === String(customerId)) || null;
  }, [customerId, customers]);

  const customerMatches = useMemo(() => {
    const q = String(adhocName || '').trim().toLowerCase();
    if (customerId || !q) return [];
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
      .slice(0, 8);
  }, [adhocName, customerId, customers]);

  const registerLocalCustomer = useCallback((payload) => {
    const row = payload && typeof payload === 'object' ? payload : null;
    const name = String(row?.name || '').trim();
    if (!name) return;
    const normalizedPhone = String(row?.phone || row?.businessPhone || '').trim();
    const exists = customers.some((customerRow) => (
      (row?.customerId && String(customerRow.id || '') === String(row.customerId))
      || (row?.clientId && String(customerRow.clientId || '') === String(row.clientId))
      || (
        String(customerRow.name || '').trim().toLowerCase() === name.toLowerCase()
        && String(customerRow.phone || customerRow.businessPhone || '').trim() === normalizedPhone
      )
    ));
    if (exists) return;
    dispatch(addCustomer({
      id: String(row.customerId || row.clientId || `invoice-customer-${Date.now()}`),
      clientId: row.clientId || undefined,
      customerCode: row.customerCode || '',
      name,
      phone: String(row.phone || '').trim(),
      address: String(row.address || '').trim(),
      businessName: String(row.businessName || '').trim(),
      businessAddress: String(row.businessAddress || '').trim(),
      businessPhone: String(row.businessPhone || '').trim(),
      customerType: row.customerType || (modeLower === 'wholesale' ? 'distribution' : 'retail'),
      offline: !row.customerId
    }));
  }, [customers, dispatch, modeLower]);

  function selectExistingCustomer(row) {
    if (!row) return;
    setCustomerId(String(row.id || row._id || ''));
    setAdhocName(String(row.name || ''));
    setAdhocBusinessName(String(row.businessName || ''));
    setAdhocContact(String(row.phone || row.businessPhone || ''));
    setAdhocAddress(String(row.address || row.businessAddress || ''));
  }

  function clearSelectedCustomer() {
    setCustomerId('');
  }

  function addItem(p) {
    setItems(list => {
      const ex = list.find(i => i.sku === p.sku);
      if (ex) return list.map(i => i.sku === p.sku ? { ...i, qty: i.qty + 1 } : i);
      const spec = productSpec(p);
      return [...list, {
        id: `${p.id}:${Math.random()}`,
        sourceProductId: p.productId || p.id,
        sourceVariantId: p.variantId || '',
        name: p.name,
        sku: p.sku,
        spec,
        qty: 1,
        rate: p.price || 0,
        per: p.unitSymbol || 'pcs'
      }];
    });
  }
  function setQty(id, v) {
    setItems(list => list.map(i => i.id === id ? { ...i, qty: Math.max(1, Number(v) || 1) } : i));
  }
  function setRate(id, v) {
    setItems(list => list.map(i => i.id === id ? { ...i, rate: Math.max(0, Number(v) || 0) } : i));
  }
  function remove(id) {
    setItems(list => list.filter(i => i.id !== id));
  }

  useEffect(() => {
    setItems((list) => list.map((item) => {
      if (!item.sourceProductId) return item;
      return {
        ...item,
        rate: resolveSellableRate(item.sourceProductId, item.sourceVariantId)
      };
    }));
  }, [resolveSellableRate]);

  const subtotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const tax = Math.max(0, subtotal * Number(settings.taxRate || 0));
  const total = Math.max(0, subtotal + tax);

  async function generateInvoice() {
    if (saving) return;
    if (items.length === 0) {
      toast.show('Select at least one product to invoice', { type: 'error' });
      return;
    }
    const digits = Number(settings.invoiceNumberDigits || 6);
    const number = `${invoicePrefix}-${String(nextInvoiceNumberValue || 1).padStart(digits, '0')}`;
    const customerClientId = !selectedCustomer && adhocName.trim()
      ? `invoice-customer-${Date.now()}-${Math.random().toString(16).slice(2)}`
      : '';
    const invoiceCustomer = selectedCustomer ? {
      name: selectedCustomer.name || '',
      phone: selectedCustomer.phone || '',
      email: selectedCustomer.email || '',
      address: selectedCustomer.address || '',
      businessName: selectedCustomer.businessName || '',
      businessAddress: selectedCustomer.businessAddress || '',
      taxId: selectedCustomer.taxId || '',
      customerCode: selectedCustomer.customerCode || '',
      customerId: selectedCustomer.id
    } : adhocName.trim() ? {
      clientId: customerClientId,
      name: adhocName.trim(),
      phone: adhocContact.trim(),
      address: adhocAddress.trim(),
      businessName: adhocBusinessName.trim(),
      businessAddress: adhocAddress.trim(),
      businessPhone: adhocContact.trim(),
      customerType: modeLower === 'wholesale' ? 'distribution' : 'retail'
    } : null;
    const inv = {
      number,
      date: new Date().toISOString(),
      clientId: crypto.randomUUID ? crypto.randomUUID() : `manual-inv-${Date.now()}`,
      customer: invoiceCustomer ? {
        name: invoiceCustomer.name || '',
        phone: invoiceCustomer.phone || invoiceCustomer.contact || '',
        email: invoiceCustomer.email || '',
        address: invoiceCustomer.address || '',
        businessName: invoiceCustomer.businessName || '',
        businessAddress: invoiceCustomer.businessAddress || '',
        taxId: invoiceCustomer.taxId || '',
        customerCode: invoiceCustomer.customerCode || '',
        customerId: invoiceCustomer.customerId,
        clientId: invoiceCustomer.clientId || undefined,
        businessPhone: invoiceCustomer.businessPhone || ''
      } : {
        name: adhocName || '—',
        phone: adhocContact || '',
        address: adhocAddress || '',
        businessName: adhocBusinessName || '',
        businessAddress: adhocAddress || '',
        clientId: customerClientId || undefined
      },
      items: items.map(i => ({ name: i.name, spec: i.spec, qty: i.qty, rate: i.rate, per: i.per })),
      subtotal,
      tax,
      total,
      notes,
      deliveryNote,
      paymentTerms,
      otherRef,
      supplierRef,
      buyerOrderNo,
      paymentStatus: 'unpaid',
      source: invoiceSource,
      despatchDocNo,
      deliveryDate,
      despatchedThrough: despatchedThrough === 'Other' ? despatchCustom : despatchedThrough,
      destination,
      termsOfDelivery
    };
    setSaving(true);
    try {
      let savedServer = null;
      if (!navigator.onLine) {
        if (!offlineBackupAllowed) {
          toast.show('Offline: connect internet and try again.', { type: 'error' });
          return;
        }
        await enqueueHttp({ collection: 'invoices', label: 'Invoice', path: '/api/invoices', method: 'POST', body: inv });
        dispatch(addInvoice(inv));
        if (!selectedCustomer && invoiceCustomer) registerLocalCustomer(inv.customer);
        bumpInvoiceSequence();
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
      } else {
        try {
          savedServer = await invoicesApi.create(inv);
          dispatch(addInvoice(savedServer || inv));
          if (savedServer?.customer && savedServer.customer.customerId) registerLocalCustomer(savedServer.customer);
          bumpInvoiceSequence();
          toast.show('Invoice generated', { type: 'success' });
        } catch (e) {
          const msg = String(e?.message || '');
          if (/401|Unauthorized/i.test(msg)) {
            try {
              const { ensureOnlineJwt } = await import('../offline/reAuth');
              const ok = await ensureOnlineJwt();
              if (ok) {
                savedServer = await invoicesApi.create(inv);
                dispatch(addInvoice(savedServer || inv));
                if (savedServer?.customer && savedServer.customer.customerId) registerLocalCustomer(savedServer.customer);
                bumpInvoiceSequence();
                toast.show('Invoice generated', { type: 'success' });
                savedServer = savedServer || null;
              } else {
                throw e;
              }
            } catch (err) {
              throw err;
            }
          } else if (/404|Not found/i.test(msg)) {
            if (offlineBackupAllowed) {
              await enqueueHttp({ collection: 'invoices', label: 'Invoice', path: '/api/invoices', method: 'POST', body: inv });
              dispatch(addInvoice(inv));
              if (!selectedCustomer && invoiceCustomer) registerLocalCustomer(inv.customer);
              bumpInvoiceSequence();
              toast.show('Server not ready. Saved invoice locally for backup.', { type: 'warning' });
            } else {
              throw e;
            }
          } else {
            throw e;
          }
        }
      }
      const html = buildInvoiceA4Html({ settings, invoice: savedServer || inv });
      printInvoiceA4(html);
      setItems([]);
      setCustomerId('');
      setAdhocName('');
      setAdhocBusinessName('');
      setAdhocContact('');
      setAdhocAddress('');
      setNotes('');
      setDeliveryNote('');
      setPaymentTerms('');
      setOtherRef('');
      setSupplierRef('');
      setBuyerOrderNo('');
      setDespatchDocNo('');
      setDeliveryDate('');
      setDespatchedThrough('In person');
      setDespatchCustom('');
      setDestination('');
      setTermsOfDelivery('');
      setQuery('');
    } catch (e) {
      toast.show(String(e?.message || 'Failed to generate invoice'), { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{pageTitle}</h1>
        <div style={{ color: '#64748b', fontSize: 13 }}>
          {modeLower === 'retail' ? 'Create retail A4 invoices and reprint invoice records.' : modeLower === 'wholesale' ? 'Create distribution A4 invoices using the assigned visible pricing tier.' : 'Create warehouse A4 invoices using the assigned visible pricing tier.'}
        </div>
      </div>
      <div className="filter-actions" style={{ marginBottom: 12 }}>
        {showNewTab && (<button className={`btn ${tab === 'new' ? 'btn-primary' : ''}`} onClick={() => setTab('new')}>New Invoice</button>)}
        {showRecordsTab && (<button className={`btn ${tab === 'records' ? 'btn-primary' : ''}`} onClick={() => setTab('records')}>Invoice Records</button>)}
      </div>
      {(tab === 'new' && showNewTab) ? (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div>
          <h2>Products</h2>
          {modeLower !== 'retail' && (
            <div className="card" style={{ marginBottom: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontWeight: 700 }}>Invoice Price Tier</div>
                <select className="select" value={selectedInvoiceTier} onChange={e => setSelectedInvoiceTier(e.target.value)}>
                  {selectableInvoiceTiers.map((tier) => (
                    <option key={tier} value={tier}>
                      {getPriceTierLabel(tier)}
                    </option>
                  ))}
                </select>
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  All listed products and invoice item rates use the selected price tier.
                </div>
              </label>
            </div>
          )}
          <div className="toolbar">
            <input className="input" placeholder="Search name, SKU or scan barcode" value={query} onChange={e => setQuery(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div className="product-list">
            {filtered.map(p => (
              <button key={p.id} onClick={() => addItem(p)} className="product-list-item">
                {p.image && <img src={p.image} alt={p.name} className="thumb" />}
                <div className="meta">
                  <div>
                    <div className="title">{p.name}</div>
                    {productSpec(p) && <div className="sku" style={{ color: '#64748b' }}>{productSpec(p)}</div>}
                    <div className="sku">{p.sku}</div>
                  </div>
                </div>
                <div style={{ fontWeight: 700 }}>{formatCurrency(p.price, settings)}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h2>Invoice</h2>
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Customer</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                placeholder="Name"
                value={adhocName}
                onChange={e => {
                  const nextValue = e.target.value;
                  if (customerId && nextValue !== String(selectedCustomer?.name || '')) setCustomerId('');
                  setAdhocName(nextValue);
                }}
              />
              {!customerId && customerMatches.length > 0 && (
                <div style={{ position: 'absolute', top: 44, left: 0, right: 0, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', zIndex: 20 }}>
                  {customerMatches.map((row) => (
                    <button
                      key={row.id}
                      className="btn"
                      onClick={() => selectExistingCustomer(row)}
                      style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0 }}
                    >
                      <span style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: 700 }}>{row.name}</div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>
                          {row.businessName || '—'} {(row.phone || row.businessPhone) ? `• ${row.phone || row.businessPhone}` : ''}
                        </div>
                      </span>
                      <span>Select</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!customerId && (
              <>
                <input className="input" placeholder="Business name" value={adhocBusinessName} onChange={e => setAdhocBusinessName(e.target.value)} />
                <input className="input" placeholder="Contact" value={adhocContact} onChange={e => setAdhocContact(e.target.value)} />
                <input className="input" placeholder="Address" value={adhocAddress} onChange={e => setAdhocAddress(e.target.value)} />
              </>
            )}
              {customerId && selectedCustomer && (
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                    <strong style={{ color: '#0f172a' }}>Existing customer selected</strong>
                    <button className="btn" onClick={clearSelectedCustomer}>Use new customer</button>
                  </div>
                  <div>Name: {selectedCustomer.name || ''}</div>
                  <div>Business: {selectedCustomer.businessName || '—'}</div>
                  <div>Phone: {selectedCustomer.phone || selectedCustomer.businessPhone || ''}</div>
                  <div>Customer ID: {selectedCustomer.customerCode || selectedCustomer.id || ''}</div>
                  <div>Address: {selectedCustomer.address || selectedCustomer.businessAddress || ''}</div>
                </div>
              )}
          </div>
        </div>
        <ul className="cart-list">
          {items.map(item => (
            <li key={item.id} className="cart-item">
              <div className="cart-title">
                <div>{item.name}</div>
                {item.spec && <small style={{ color: '#64748b' }}>{item.spec}</small>}
                <small>{item.sku}</small>
              </div>
              <input className="input" type="number" min="1" value={item.qty} onChange={e => setQty(item.id, e.target.value)} style={{ width: 70 }} />
              <div style={{ display: 'grid', gap: 4 }}>
                <input className="input" type="number" min="0" step="0.01" value={item.rate} onChange={e => setRate(item.id, e.target.value)} style={{ width: 110 }} />
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  Unit: {formatCurrency(item.rate, settings)}
                </span>
              </div>
              <span style={{ width: 50, textAlign: 'center' }}>{item.per}</span>
              <div style={{ minWidth: 120, textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>Line Total</div>
                <strong>{formatCurrency((Number(item.qty) || 0) * (Number(item.rate) || 0), settings)}</strong>
              </div>
              <button className="btn" onClick={() => remove(item.id)}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="totals-box">
          <div style={{ marginTop: 8 }}>
            <div>Subtotal: {formatCurrency(subtotal, settings)}</div>
            <div>Tax ({Math.round((settings.taxRate || 0) * 100)}%): {formatCurrency(tax, settings)}</div>
            <div><strong>Total: {formatCurrency(total, settings)}</strong></div>
          </div>
        </div>
          <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <input className="input" placeholder="Delivery Note" value={deliveryNote} onChange={e => setDeliveryNote(e.target.value)} />
            <input className="input" placeholder="Payment Terms" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} />
              <input className="input" placeholder="Supplier's Ref." value={supplierRef} onChange={e => setSupplierRef(e.target.value)} />
              <input className="input" placeholder="Other Reference(s)" value={otherRef} onChange={e => setOtherRef(e.target.value)} />
            <input className="input" placeholder="Buyer’s Order No." value={buyerOrderNo} onChange={e => setBuyerOrderNo(e.target.value)} />
              <input className="input" placeholder="Despatch Document No." value={despatchDocNo} onChange={e => setDespatchDocNo(e.target.value)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input className="input" type="date" placeholder="Delivery Note Date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
                <select className="select" value={despatchedThrough} onChange={e => setDespatchedThrough(e.target.value)}>
                  <option>In person</option>
                  <option>Courier</option>
                  <option>WhatsApp</option>
                  <option>Email</option>
                  <option>Other</option>
                </select>
              </div>
              {despatchedThrough === 'Other' && (
                <input className="input" placeholder="Specify despatched method" value={despatchCustom} onChange={e => setDespatchCustom(e.target.value)} />
              )}
              <input className="input" placeholder="Destination" value={destination} onChange={e => setDestination(e.target.value)} />
              <input className="input" placeholder="Terms of Delivery" value={termsOfDelivery} onChange={e => setTermsOfDelivery(e.target.value)} />
            <textarea className="input" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} rows="3" />
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={generateInvoice} disabled={saving || items.length === 0}>
            {saving ? 'Generating…' : 'Generate Invoice (A4)'}
          </button>
        </div>
        </div>
      </div>
      ) : (tab === 'records' && showRecordsTab) ? (
      <div className="card">
        <h2 className="section-title" style={{ margin: '8px 0' }}>Invoice Records</h2>
        <div className="toolbar" style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Search by number, customer, order no., supplier/other refs" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ width: '100%' }} />
          {modeLower === 'retail' && (
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button className={invoiceKind === 'all' ? 'btn btn-primary' : 'btn'} onClick={() => setInvoiceKind('all')}>All</button>
              <button className={invoiceKind === 'retail' ? 'btn btn-primary' : 'btn'} onClick={() => setInvoiceKind('retail')}>Retail</button>
              <button className={invoiceKind === 'wholesale' ? 'btn btn-primary' : 'btn'} onClick={() => setInvoiceKind('wholesale')}>Distribution</button>
              <button className={invoiceKind === 'warehouse' ? 'btn btn-primary' : 'btn'} onClick={() => setInvoiceKind('warehouse')}>Warehouse</button>
            </div>
          )}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th align="left">Number</th>
              <th align="left">Customer</th>
              <th align="left">Date</th>
              <th align="left">Total</th>
              <th align="left">Status</th>
              <th align="left">Order No.</th>
              <th align="left"></th>
            </tr>
          </thead>
          <tbody>
            {invoices
              .filter(inv => {
                if (invoiceKind === 'retail') {
                  if (inv.source && !['manual', 'pos'].includes(inv.source)) return false;
                } else if (invoiceKind === 'wholesale') {
                  if (inv.source && !['wholesale-pos', 'wholesale-manual'].includes(inv.source)) return false;
                } else if (invoiceKind === 'warehouse') {
                  if (inv.source && !['warehouse-manual'].includes(inv.source)) return false;
                }
                const q = searchTerm.trim().toLowerCase();
                if (!q) return true;
                const fields = [
                  String(inv.number || ''),
                  String(inv.customer?.name || ''),
                  String(inv.buyerOrderNo || ''),
                  String(inv.supplierRef || ''),
                  String(inv.otherRef || '')
                ].join(' ').toLowerCase();
                return fields.includes(q);
              })
              .map(inv => (
                <tr key={inv.id}>
                  <td>{inv.number}</td>
                  <td>{inv.customer?.name || '—'}</td>
                  <td>{new Date(inv.date || inv.created_at).toLocaleString()}</td>
                  <td>{formatCurrency(inv.total || 0, settings)}</td>
                  <td>{inv.paymentStatus ? inv.paymentStatus.toUpperCase() : ''}</td>
                  <td>{inv.buyerOrderNo || ''}</td>
                  <td>
                    <button
                      className="btn"
                      onClick={() => {
                        const html = buildInvoiceA4Html({ settings, invoice: inv });
                        printInvoiceA4(html);
                      }}
                    >
                      Print
                    </button>
                  </td>
                </tr>
              ))}
            {invoices.length === 0 && (
              <tr><td colSpan="7" style={{ color: '#64748b' }}>No invoices yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      ) : null}
    </div>
  );
}

export default InvoicesPage;
