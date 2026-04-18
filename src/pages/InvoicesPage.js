import { useDispatch, useSelector } from 'react-redux';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { productSpec } from '../utils/productSpec';
import { formatCurrency } from '../utils/currency';
import { useToast } from '../components/ToastProvider';
import { addInvoice } from '../store/invoicesSlice';
import { setNextInvoiceNumber, setNextWarehouseInvoiceNumber, setNextWholesaleInvoiceNumber } from '../store/settingsSlice';
import { buildInvoiceA4Html, printInvoiceA4 } from '../utils/invoicePrint';
import * as invoicesApi from '../api/invoices';
import { enqueueHttp, isOfflineBackupEnabled } from '../offline/offlineBackup';
import { isFeatureEnabled } from '../utils/featureFlags';
import { getAllowedPriceTiers, getDisplayPrice, getPreferredPriceTier } from '../utils/priceVisibility';

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
  const defaultRateFor = useCallback((p) => (
    getDisplayPrice(p, activeInvoiceTier)
  ), [activeInvoiceTier]);
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

  function addItem(p) {
    setItems(list => {
      const ex = list.find(i => i.sku === p.sku);
      if (ex) return list.map(i => i.sku === p.sku ? { ...i, qty: i.qty + 1 } : i);
      const spec = productSpec(p);
      return [...list, { id: `${p.id}:${Math.random()}`, name: p.name, sku: p.sku, spec, qty: 1, rate: p.price || 0, per: p.unitSymbol || 'pcs' }];
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

  const customer = useMemo(() => {
    if (customerId) return customers.find(c => String(c.id) === String(customerId)) || null;
    if (adhocName.trim()) return { name: adhocName.trim(), contact: adhocContact.trim(), address: adhocAddress.trim() };
    return null;
  }, [customers, customerId, adhocName, adhocContact, adhocAddress]);
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
    const inv = {
      number,
      date: new Date().toISOString(),
      clientId: crypto.randomUUID ? crypto.randomUUID() : `manual-inv-${Date.now()}`,
      customer: customer ? {
        name: customer.name || '',
        phone: customer.phone || customer.contact || '',
        email: customer.email || '',
        address: customer.address || '',
        customerCode: customer.customerCode || '',
        customerId: customer.id
      } : {
        name: adhocName || '—',
        phone: adhocContact || '',
        address: adhocAddress || ''
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
        bumpInvoiceSequence();
        toast.show('Saved offline. Will backup when online.', { type: 'success' });
      } else {
        try {
          savedServer = await invoicesApi.create(inv);
          dispatch(addInvoice(savedServer || inv));
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
            <select className="select" value={customerId} onChange={e => setCustomerId(e.target.value)}>
              <option value="">Ad-hoc</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!customerId && (
              <>
                <input className="input" placeholder="Name" value={adhocName} onChange={e => setAdhocName(e.target.value)} />
                <input className="input" placeholder="Contact" value={adhocContact} onChange={e => setAdhocContact(e.target.value)} />
                <input className="input" placeholder="Address" value={adhocAddress} onChange={e => setAdhocAddress(e.target.value)} />
              </>
            )}
              {customerId && (
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  <div>Name: {customer?.name || ''}</div>
                  <div>Phone: {customer?.phone || ''}</div>
                  <div>Customer ID: {customer?.customerCode || customer?.id || ''}</div>
                  <div>Address: {customer?.address || ''}</div>
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
              <input className="input" type="number" min="0" step="0.01" value={item.rate} onChange={e => setRate(item.id, e.target.value)} style={{ width: 110 }} />
              <span style={{ width: 50, textAlign: 'center' }}>{item.per}</span>
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
