import { formatCurrency } from './currency';
import { translateDocumentLanguage } from './localization';

function numToWords(n) {
  const small = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  function chunk(num) {
    const h = Math.floor(num / 100);
    const r = num % 100;
    const parts = [];
    if (h) parts.push(small[h] + ' hundred');
    if (r) {
      if (r < 20) parts.push(small[r]);
      else {
        const t = Math.floor(r / 10);
        const u = r % 10;
        parts.push(tens[t] + (u ? '-' + small[u] : ''));
      }
    }
    return parts.join(' ');
  }
  if (n === 0) return 'zero';
  const units = ['','thousand','million','billion'];
  const words = [];
  let i = 0;
  while (n > 0 && i < units.length) {
    const c = n % 1000;
    if (c) words.unshift(chunk(c) + (units[i] ? ' ' + units[i] : ''));
    n = Math.floor(n / 1000);
    i += 1;
  }
  return words.join(' ').trim();
}

function amountInWords(amount, currencyLabel = '') {
  const v = Math.round(Number(amount) * 100);
  const whole = Math.floor(v / 100);
  const cents = v % 100;
  const a = numToWords(whole);
  const b = cents ? `${cents}/100` : '00/100';
  const curr = currencyLabel ? `${currencyLabel} ` : '';
  return `${curr}${a} ${b} Only`;
}

export function buildInvoiceA4Html({ settings, invoice }) {
  const t = translateDocumentLanguage;
  const logoSrc = settings?.clientLogoUrl || '/clientlogo512.png';
  const addr = String(settings?.invoiceCompanyAddress || '').split('\n').map(s => s.trim()).filter(Boolean).join('<br/>');
  const footer = settings?.invoiceFooter || settings?.footerText || '';
  const decl = settings?.invoiceDeclaration || t('We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.');
  const signLbl = settings?.invoiceSignatoryLabel || t('Authorised Signatory');
  const buyer = invoice.customer || {};
  const items = invoice.items || [];
  const buyerBusinessFields = [
    { label: t('Business Name'), value: buyer.businessName || '' },
    { label: t('TIN/TPIN'), value: buyer.taxId || '' },
    { label: t('Business Address'), value: buyer.businessAddress || '' }
  ].filter((field) => String(field.value || '').trim());
  const buyerBusinessRows = buyerBusinessFields.map((field) => `
        <tr>
          <td class="label">${field.label}</td><td class="value">${field.value}</td>
          <td class="label"></td><td class="value"></td>
        </tr>
  `).join('');
  const rows = items.map((it, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${it.name}${it.spec ? ` (${it.spec})` : ''}${Array.isArray(it.soldUnits) && it.soldUnits.length > 0 ? `<div style="font-size:11px;color:#555;margin-top:4px">${it.soldUnits.map(unit => unit.imei || unit.serialNumber || unit.unitId).filter(Boolean).join(', ')}</div>` : ''}</td>
      <td class="right">${Number(it.qty || 0)}</td>
      <td class="right">${formatCurrency(it.rate || 0, settings)}</td>
      <td>${it.per || 'pcs'}</td>
      <td class="right">${formatCurrency((Number(it.qty || 0) * Number(it.rate || 0)), settings)}</td>
    </tr>
  `).join('');
  const subtotal = Number(invoice.subtotal || 0);
  const discount = Number(invoice.discount || 0);
  const tax = Number(invoice.tax || 0);
  const total = Number(invoice.total || 0);
  const words = amountInWords(total, '');
  const today = new Date(invoice.date || Date.now()).toLocaleDateString();
  const title = settings?.invoiceTitle || t('Invoice');
  const wordsLabel = settings?.invoiceWordsLabel || t('Amount Chargeable (in words)');
  const generatedNote = settings?.invoiceGeneratedNote || t('This is a Computer Generated Invoice');
  const paidStampEnabled = !!settings?.invoicePaidStampEnabled;
  const paidStampColor = settings?.invoicePaidStampColor || '#cc0000';
  const paidStampLabel = settings?.invoicePaidStampLabel || t('PAID');
  const paidStampThanks = settings?.invoicePaidStampThankYou || t('THANK YOU!');
  const paidStampShowDate = settings?.invoicePaidStampShowDate !== false;
  const showPaidStamp = paidStampEnabled && String(invoice?.source || '').toLowerCase() === 'pos' && String(invoice?.paymentStatus || '').toLowerCase() === 'paid';
  const brandName = settings?.clientAppName || settings?.appName || '';
  const phone = settings?.businessPhone || '';
  const website = settings?.businessWebsite || '';
  const tpin = settings?.businessTpin || '';
  const extra = [phone ? `Phone: ${phone}` : '', website ? `Website: ${website}` : '', tpin ? `TIN/TPIN: ${tpin}` : ''].filter(Boolean).join(' • ');
  return `
  <div class="sheet">
    ${showPaidStamp ? `
      <div class="paid-stamp" style="color:${paidStampColor}">
        <div class="circle">
          <div class="top">${brandName}</div>
          <div class="middle">${paidStampLabel}</div>
          <div class="bottom">${paidStampThanks}</div>
          ${paidStampShowDate ? `<div class="date">Date: ${today}</div>` : ''}
        </div>
      </div>
    ` : ''}
    <div class="doc-title">${title}</div>
    <div class="head">
      <div class="brand">
        <img src="${logoSrc}" alt="${t('Logo')}" onerror="if(this.src.endsWith('/clientlogo512.png')) this.src='/logo512.png'; else this.src='/clientlogo512.png';"/>
        <div class="brand-text">
          <div class="title">${settings.clientAppName || settings.appName}</div>
          <div class="addr">${addr}</div>
          ${extra ? `<div class="extra">${extra}</div>` : ''}
        </div>
      </div>
      <table class="kv meta-table">
        <tbody>
          <tr>
            <td class="label">${t('Invoice No.')}</td><td class="value">${invoice.number}</td>
            <td class="label">${t('Dated')}</td><td class="value">${today}</td>
          </tr>
          <tr>
            <td class="label">${t('Delivery Note')}</td><td class="value">${invoice.deliveryNote || ''}</td>
            <td class="label">${t('Mode/Terms of Payment')}</td><td class="value">${invoice.paymentTerms || ''}</td>
          </tr>
          <tr>
            <td class="label">${t("Supplier's Ref.")}</td><td class="value">${invoice.supplierRef || ''}</td>
            <td class="label">${t('Other Reference(s)')}</td><td class="value">${invoice.otherRef || ''}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <table class="kv buyer-table">
      <tbody>
        <tr>
          <td class="label">${t('Buyer')}</td><td class="value">${buyer.name || '-'}</td>
          <td class="label">${t("Buyer's Order No.")}</td><td class="value">${invoice.buyerOrderNo || ''}</td>
        </tr>
        <tr>
          <td class="label">${t('Phone')}</td><td class="value">${buyer.phone || buyer.contact || ''}</td>
          <td class="label">${t('Despatch Document No.')}</td><td class="value">${invoice.despatchDocNo || ''}</td>
        </tr>
        ${String(buyer.address || '').trim() ? `
        <tr>
          <td class="label">${t('Address')}</td><td class="value">${buyer.address || ''}</td>
          <td class="label">${t('Delivery Note Date')}</td><td class="value">${invoice.deliveryDate || ''}</td>
        </tr>
        ` : `
        <tr>
          <td class="label"></td><td class="value"></td>
          <td class="label">${t('Delivery Note Date')}</td><td class="value">${invoice.deliveryDate || ''}</td>
        </tr>
        `}
        ${buyerBusinessRows}
        <tr>
          <td class="label">${t('Despatched through')}</td><td class="value">${invoice.despatchedThrough || ''}</td>
          <td class="label">${t('Destination')}</td><td class="value">${invoice.destination || ''}</td>
        </tr>
        <tr>
          <td class="label">${t('Customer ID')}</td><td class="value">${buyer.customerCode || buyer.customerId || ''}</td>
          <td class="label">${t('Email')}</td><td class="value">${buyer.email || ''}</td>
        </tr>
        <tr>
          <td class="label">${t('Terms of Delivery')}</td><td class="value" colspan="3">${invoice.termsOfDelivery || ''}</td>
        </tr>
      </tbody>
    </table>
    <table class="items">
      <thead>
        <tr>
          <th>${t('Sl No.')}</th>
          <th>${t('Description of Goods')}</th>
          <th>${t('Quantity')}</th>
          <th>${t('Rate')}</th>
          <th>${t('per')}</th>
          <th>${t('Amount')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td colspan="5" class="right strong">${t('Total')}</td>
          <td class="right strong">${formatCurrency(subtotal, settings)}</td>
        </tr>
        <tr>
          <td colspan="5" class="right">${t('Discount')}</td>
          <td class="right">-${formatCurrency(discount, settings)}</td>
        </tr>
        <tr>
          <td colspan="5" class="right">${t('Tax')}</td>
          <td class="right">${formatCurrency(tax, settings)}</td>
        </tr>
        <tr>
          <td colspan="5" class="right strong">${t('Grand Total')}</td>
          <td class="right strong">${formatCurrency(total, settings)}</td>
        </tr>
      </tbody>
    </table>
    <div class="words">
      <div>${wordsLabel}</div>
      <div class="strong">${words}</div>
    </div>
    <div class="declaration">
      <div>${t('Declaration')}</div>
      <div>${decl}</div>
      <table class="signatures">
        <tr>
          <td>
            <div class="sign-line"></div>
            <div>${t('Customer Signature')}</div>
          </td>
          <td style="text-align:right">
            <div class="brand-sig">${settings.clientAppName || settings.appName}</div>
            <div class="sig-space"></div>
            <div class="sig-label">${signLbl}</div>
          </td>
        </tr>
      </table>
    </div>
    <div class="footer">${footer || ''}</div>
    <div class="generated">${generatedNote}</div>
  </div>
  `;
}

export function printInvoiceA4(html) {
  const t = translateDocumentLanguage;
  const w = window.open('', 'PRINT', 'width=1000,height=800');
  if (!w) return;
  w.document.open();
  w.document.write(`
  <html>
  <head>
    <title>${t('Invoice')}</title>
    <style>
      @page { size: A4; margin: 18mm; }
      body { font-family: Arial, sans-serif; color:#000; }
      .sheet { width: 100%; position: relative; }
      .paid-stamp { position: absolute; top: 8px; right: 8px; pointer-events: none; }
      .paid-stamp .circle {
        width: 160px; height: 160px; border: 6px solid currentColor;
        border-radius: 50%; display:flex; flex-direction:column; align-items:center; justify-content:center;
        color: currentColor; opacity: 0.18; text-align:center; line-height:1.05;
      }
      .paid-stamp .top { font-size: 12px; font-weight: 700; text-transform: uppercase; }
      .paid-stamp .middle { font-size: 40px; font-weight: 900; letter-spacing: 2px; margin: 4px 0; }
      .paid-stamp .bottom { font-size: 12px; font-weight: 700; text-transform: uppercase; }
      .paid-stamp .date { font-size: 10px; margin-top: 6px; }
      .doc-title { text-align:center; font-weight:700; margin: 4px 0 8px; }
      .head { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; padding-bottom:8px; border-bottom:1px solid #000; }
      .brand { display:flex; gap:12px; align-items:center; }
      .brand img { width:64px; height:64px; object-fit:contain; }
      .brand .title { font-size:18px; font-weight:700; }
      .brand .addr { font-size:12px; color:#111; }
      .brand .extra { font-size:11px; color:#222; margin-top:2px; }
      table.kv { width:100%; border-collapse: collapse; font-size:12px; }
      table.kv td { border:1px solid #000; padding:6px; vertical-align:top; }
      table.kv td.label { width:22%; color:#444; }
      table.kv td.value { width:28%; font-weight:700; }
      .meta-table { margin-left:auto; min-width:420px; }
      .buyer-table { width:100%; margin:8px 0; }
      table.items { width:100%; border-collapse: collapse; margin-top:8px; font-size:12px; }
      table.items th, table.items td { border:1px solid #000; padding:6px; }
      .right { text-align:right; }
      .strong { font-weight:700; }
      .words { padding:8px 0; font-size:12px; }
      .declaration { border-top:1px solid #000; padding-top:8px; font-size:12px; min-height:80px; }
      .signatures { width:100%; margin-top:8px; }
      .signatures td { vertical-align:bottom; }
      .sign-line { margin:24px 0 6px; border-top:1px solid #000; width:220px; }
      .brand-sig { font-weight:700; margin-top:2px; }
      .sig-space { height: 25mm; }
      .sig-label { }
      .footer { text-align:right; font-size:12px; margin-top:6px; color:#333; }
      .generated { text-align:center; font-size:11px; margin-top:10px; color:#555; }
      @media print { img { max-width:none } }
    </style>
  </head>
  <body>${html}
    <script>
      (function() {
        function doPrint(){ try{ window.focus(); }catch(e){} try{ window.print(); }catch(e){} }
        if (document.readyState === 'complete') setTimeout(doPrint, 300);
        else window.addEventListener('load', function(){ setTimeout(doPrint, 300); });
        window.addEventListener('afterprint', function(){ setTimeout(function(){ window.close(); }, 200); });
      })();
    </script>
  </body>
  </html>
  `);
  w.document.close();
}
