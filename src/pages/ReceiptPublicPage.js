import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useParams, useLocation } from 'react-router-dom';
import { buildBrandedReceiptHtml, printReceiptHtml } from '../utils/print';
import { formatCurrency } from '../utils/currency';

function decodeQueryData(search) {
  try {
    const params = new URLSearchParams(search || '');
    const d = params.get('d');
    if (!d) return null;
    const json = decodeURIComponent(escape(window.atob(d)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function fromQueryToSale(d) {
  if (!d) return null;
  const items = Array.isArray(d.items) ? d.items.map(i => ({ name: i[0], qty: Number(i[1]) || 0, price: Number(i[2]) || 0 })) : [];
  return {
    id: d.id,
    created_at: d.ts,
    branchName: d.br,
    sellerName: d.ca,
    invoiceSerial: d.inv || '',
    items,
    subtotal: Number(d.t?.[0]) || 0,
    discount: Number(d.t?.[1]) || 0,
    tax: Number(d.t?.[2]) || 0,
    total: Number(d.t?.[3]) || 0,
    payment_methods: d.pay || []
  };
}

export default function ReceiptPublicPage() {
  const { id } = useParams();
  const location = useLocation();
  const settings = useSelector(s => s.settings);
  const sales = useSelector(s => s.sales.sales);
  const sale = useMemo(() => {
    const s = sales.find(x => String(x.id) === String(id));
    if (s) return s;
    const q = decodeQueryData(location.search);
    return fromQueryToSale(q);
  }, [id, sales, location.search]);

  if (!sale) {
    return (
      <div style={{ padding: 16 }}>
        <h1>Receipt</h1>
        <div className="card">Receipt not found. The link may be invalid or expired.</div>
      </div>
    );
  }

  const qtySum = sale.items.reduce((s, it) => s + (Number(it.qty)||0), 0);

  return (
    <div style={{ padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Receipt</h1>
        <button className="btn btn-primary" onClick={() => printReceiptHtml(buildBrandedReceiptHtml({ settings, sale }))}>
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M6 9V3h12v6" stroke="currentColor" strokeWidth="2"/><path d="M6 17h12v4H6z" stroke="currentColor" strokeWidth="2"/><path d="M4 9h16a2 2 0 012 2v2H2v-2a2 2 0 012-2z" stroke="currentColor" strokeWidth="2"/></svg>
          Print
        </button>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="center"><img src="/logo512.png" alt="logo" style={{ maxHeight: 60 }} /></div>
        <div className="center" style={{ fontWeight: 700 }}>{sale.branchName || sale.branchId || '-'}</div>
        {settings.businessPhone && <div className="center" style={{ color: '#64748b' }}>{settings.businessPhone}</div>}
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr auto', gap: 4 }}>
          <div>Cashier: {sale.sellerName || '—'}</div>
          <div style={{ textAlign: 'right' }}>{new Date(sale.created_at).toLocaleString()}</div>
        </div>
        {sale.receiptNumber && <div style={{ marginTop: 4, color: '#64748b' }}>Receipt: {sale.receiptNumber}</div>}
        {sale.invoiceSerial && <div style={{ marginTop: 4, color: '#64748b' }}>Invoice: {sale.invoiceSerial}</div>}
        <hr />
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {sale.items.map((it, i) => (
              <tr key={i}>
                <td>{it.name}{it.spec ? ` [${it.spec}]` : ''} x{it.qty}</td>
                <td style={{ textAlign: 'right' }}>{formatCurrency((Number(it.price)||0)*(Number(it.qty)||1), settings)}</td>
              </tr>
            ))}
            <tr><td style={{ color: '#64748b' }}>Subtotal</td><td style={{ textAlign: 'right' }}>{formatCurrency(sale.subtotal || 0, settings)}</td></tr>
            <tr><td style={{ color: '#64748b' }}>Discount</td><td style={{ textAlign: 'right' }}>-{formatCurrency(sale.discount || 0, settings)}</td></tr>
            <tr><td style={{ color: '#64748b' }}>Tax</td><td style={{ textAlign: 'right' }}>{formatCurrency(sale.tax || 0, settings)}</td></tr>
            <tr><td style={{ fontWeight: 700 }}>DUE (VAT INCL)</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{formatCurrency(sale.total || 0, settings)}</td></tr>
          </tbody>
        </table>
        <hr />
        <div style={{ color: '#64748b' }}>Total items: {qtySum}</div>
      </div>
    </div>
  );
}
