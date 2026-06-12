import { formatCurrency } from './currency';
import { generateQrSvg } from './qr';
import { translateDocumentLanguage } from './localization';
import { formatDateTime as formatSharedDateTime } from './dateFormat';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  return formatSharedDateTime(value, '');
}

function paymentMethodLabel(value, t) {
  const method = String(value || '').trim().toLowerCase();
  if (method === 'card') return t('Card');
  if (method === 'mobile') return t('Mobile Money');
  if (method === 'wallet') return t('Wallet');
  return t('Cash');
}

function repaymentStatusLabel(value, t) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'approved') return t('Approved');
  if (status === 'rejected') return t('Rejected');
  if (status === 'pending_manager') return t('Pending Manager');
  return t('Pending Director');
}

function actorLabel(name, role) {
  const person = String(name || '').trim();
  const personRole = String(role || '').trim();
  if (person && personRole) return `${person} (${personRole})`;
  return person || personRole || '';
}

function getReceiptCreditLabel(sale, t) {
  const packageName = String(sale?.creditPackageName || sale?.creditSale?.creditPackageName || '').trim();
  if (packageName) return packageName;
  const creditMode = String(sale?.creditMode || '').trim().toLowerCase();
  return creditMode === 'distribution_credit' ? t('Distribution Credit') : t('EasyBuy');
}

export function printReceiptHtml(html) {
  const w = window.open('', 'PRINT', 'width=400,height=600');
  if (!w) return;
  const t = translateDocumentLanguage;
  w.document.open();
  w.document.write(`
    <html>
    <head>
      <title>${t('Receipt')}</title>
      <style>
        body { font-family: monospace; padding: 12px; color:#111; }
        .root { position: relative; }
        .paid-stamp { position: absolute; top: 4px; right: 4px; pointer-events: none; }
        .paid-stamp .circle {
          width: 110px; height: 110px; border: 4px solid currentColor;
          border-radius: 50%; display:flex; flex-direction:column; align-items:center; justify-content:center;
          color: currentColor; opacity: 0.18; text-align:center; line-height:1.05;
        }
        .paid-stamp .top { font-size: 10px; font-weight: 700; text-transform: uppercase; }
        .paid-stamp .middle { font-size: 28px; font-weight: 900; letter-spacing: 1px; margin: 2px 0; }
        .paid-stamp .bottom { font-size: 10px; font-weight: 700; text-transform: uppercase; }
        .paid-stamp .date { font-size: 9px; margin-top: 4px; }
        .center { text-align: center; }
        .muted { color:#64748b; }
        .sp { display:flex; justify-content:space-between; }
        .hr { border-top:1px dashed #d1d5db; margin:8px 0; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 2px 0; vertical-align: top; }
        .right { text-align:right; }
        .title { font-weight:700; }
        .small { font-size: 12px; }
        .qr svg { width: 160px; height: 160px; }
        @media print {
          img, svg { max-width: none; }
        }
      </style>
    </head>
    <body>
      ${html}
      <script>
        (function() {
          function doPrint() {
            try { window.focus(); } catch(e) {}
            try { window.print(); } catch(e) {}
          }
          if (document.readyState === 'complete') {
            setTimeout(doPrint, 300);
          } else {
            window.addEventListener('load', function() { setTimeout(doPrint, 300); });
          }
          window.addEventListener('afterprint', function() { setTimeout(function(){ window.close(); }, 200); });
        })();
      </script>
    </body></html>
  `);
  w.document.close();
}

export function buildBrandedReceiptHtml({ settings, sale }) {
  const t = translateDocumentLanguage;
  const formatSerializedLine = (item) => {
    const units = Array.isArray(item?.soldUnits) ? item.soldUnits : [];
    if (units.length === 0) return '';
    return `<div class="small muted">${units.map(unit => unit.imei || unit.serialNumber || unit.unitId).filter(Boolean).join(', ')}</div>`;
  };
  const logoSrc = settings?.clientLogoUrl || settings?.receiptLogoUrl || '/clientlogo512.png';
  const branch = sale.branchName || sale.branchId || '-';
  const phone = settings?.businessPhone || '';
  const website = settings?.businessWebsite || '';
  const cashier = sale.sellerName || '-';
  const brandName = settings?.receiptBrandName || settings?.clientAppName || settings?.appName || '';
  const stampEnabled = !!settings?.invoicePaidStampEnabled;
  const stampColor = settings?.invoicePaidStampColor || '#cc0000';
  const stampLabel = settings?.invoicePaidStampLabel || t('PAID');
  const stampThanks = settings?.invoicePaidStampThankYou || t('THANK YOU!');
  const stampShowDate = settings?.invoicePaidStampShowDate !== false;
  const customerLine = (() => {
    const name = String(sale.customerName || '').trim();
    const code = String(sale.customerCode || '').trim();
    if (!name && !code) return '';
    return `<div class="small">${t('Customer').toUpperCase()}: ${[name, code ? `(${code})` : ''].filter(Boolean).join(' ')}</div>`;
  })();
  const customerBusinessLines = [
    { label: t('Business Name').toUpperCase(), value: sale.customerBusinessName || '' },
    { label: t('TIN/TPIN').toUpperCase(), value: sale.customerTaxId || '' },
    { label: t('Address').toUpperCase(), value: sale.customerBusinessAddress || sale.customerAddress || '' }
  ]
    .filter((field) => String(field.value || '').trim())
    .map((field) => `<div class="small">${field.label}: ${field.value}</div>`)
    .join('');
  const qtySum = (sale.items || []).reduce((s, it) => s + (Number(it.qty)||0), 0);
  const paid = (sale.payment_methods || []).reduce((s, p) => s + (Number(p.amount)||0), 0);
  const change = Math.max(0, paid - (Number(sale.total)||0));
  const easyBuyDueDate = sale?.creditDueDate || sale?.creditSale?.due_date || sale?.creditSale?.dueDate || null;
  const easyBuyPaidNow = Number(sale?.creditAmountPaidNow ?? sale?.creditSale?.amount_paid ?? sale?.creditSale?.amountPaidNow ?? 0);
  const easyBuyBalance = Number(sale?.creditBalance ?? sale?.creditSale?.balance ?? Math.max(0, Number(sale.total || 0) - easyBuyPaidNow));
  const repaymentHistory = Array.isArray(sale?.repaymentHistory) ? sale.repaymentHistory : [];
  const hasEasyBuy = (sale.payment_methods || []).some(p => String(p.type || '').toLowerCase() === 'easybuy') || !!easyBuyDueDate || repaymentHistory.length > 0;
  const creditLabel = getReceiptCreditLabel(sale, t);
  const isPaid = paid >= (Number(sale.total) || 0) - 0.005;
  const showPaidStamp = stampEnabled && isPaid;
  const today = new Date(sale.created_at || Date.now()).toLocaleDateString();
  const rate = (() => {
    if (Number(sale.subtotal) - Number(sale.discount) > 0) {
      const r = Number(sale.tax || 0) / Math.max(1e-6, Number(sale.subtotal) - Number(sale.discount));
      return Math.round(r * 10000) / 100;
    }
    return Math.round((Number(settings?.taxRate || 0) * 10000)) / 100;
  })();
  const taxableVal = Math.max(0, Number(sale.subtotal) - Number(sale.discount));
  const vatVal = Number(sale.tax) || 0;
  const head = settings?.receiptHeader ? `<div class="center small">${settings.receiptHeader}</div>` : '';
  const foot = (settings?.receiptFooter || website) ? `<div class="center small" style="margin-top:8px">${[website, settings?.receiptFooter].filter(Boolean).join(' • ')}</div>` : '';
  const payments = (sale.payment_methods || []).map(p => {
    const label = String(p.type || 'cash').toUpperCase();
    return `<div class="sp"><span>${label}</span><span>${formatCurrency(p.amount || 0, settings)}</span></div>`;
  }).join('');
  const repaymentSection = hasEasyBuy ? `
    <div class="hr"></div>
    <div class="title">${t('Credit Ledger').toUpperCase()}</div>
    <div class="sp"><span>${t('Sale Date').toUpperCase()}</span><span>${escapeHtml(formatDateTime(sale.created_at))}</span></div>
    <div class="sp"><span>${creditLabel.toUpperCase()} ${t('Total').toUpperCase()}</span><span>${formatCurrency(sale.total || 0, settings)}</span></div>
    <div class="sp"><span>${creditLabel.toUpperCase()} ${t('Upfront Paid').toUpperCase()}</span><span>${formatCurrency(easyBuyPaidNow, settings)}</span></div>
    <div class="sp"><span>${creditLabel.toUpperCase()} ${t('Outstanding').toUpperCase()}</span><span>${formatCurrency(easyBuyBalance, settings)}</span></div>
    ${easyBuyDueDate ? `<div class="sp"><span>${creditLabel.toUpperCase()} ${t('Due Date').toUpperCase()}</span><span>${escapeHtml(new Date(easyBuyDueDate).toLocaleDateString())}</span></div>` : ''}
    ${repaymentHistory.length > 0 ? repaymentHistory.map((entry, index) => {
      const initiatedBy = actorLabel(entry?.initiatedByName, entry?.initiatedByRole);
      const approvedBy = actorLabel(entry?.approvedByName, entry?.approvedByRole);
      const initiatedAt = formatDateTime(entry?.initiatedAt);
      const approvedAt = formatDateTime(entry?.approvedAt);
      const rejectedAt = formatDateTime(entry?.rejectedAt);
      const remark = String(entry?.remark || '').trim();
      return `
        <div class="hr"></div>
        <div class="title">${t('Repayment').toUpperCase()} ${index + 1}</div>
        <div class="sp"><span>${t('Amount').toUpperCase()}</span><span>${formatCurrency(entry?.amount || 0, settings)}</span></div>
        <div class="sp"><span>${t('Method').toUpperCase()}</span><span>${escapeHtml(paymentMethodLabel(entry?.paymentMethod, t).toUpperCase())}</span></div>
        <div class="sp"><span>${t('Status').toUpperCase()}</span><span>${escapeHtml(repaymentStatusLabel(entry?.status, t).toUpperCase())}</span></div>
        ${initiatedAt ? `<div class="small">${t('Initiated').toUpperCase()}: ${escapeHtml(initiatedAt)}</div>` : ''}
        ${initiatedBy ? `<div class="small">${t('Initiated By').toUpperCase()}: ${escapeHtml(initiatedBy)}</div>` : ''}
        ${approvedAt ? `<div class="small">${t('Approved').toUpperCase()}: ${escapeHtml(approvedAt)}</div>` : ''}
        ${approvedBy ? `<div class="small">${t('Approved By').toUpperCase()}: ${escapeHtml(approvedBy)}</div>` : ''}
        ${rejectedAt ? `<div class="small">${t('Rejected').toUpperCase()}: ${escapeHtml(rejectedAt)}</div>` : ''}
        ${remark ? `<div class="small">${t('Remark').toUpperCase()}: ${escapeHtml(remark)}</div>` : ''}
      `;
    }).join('') : `<div class="small muted">${t('No repayments recorded yet')}</div>`}
  ` : '';
  const base = (settings?.receiptQrBaseUrl && settings.receiptQrBaseUrl.trim()) ? settings.receiptQrBaseUrl.trim().replace(/\/+$/,'') : (typeof window !== 'undefined' ? window.location.origin : '');
  const saleId = sale?.id || sale?._id || '';
  const compact = {
    id: saleId,
    ts: sale.created_at,
    br: branch,
    ca: cashier,
    inv: sale.invoiceSerial || '',
    items: (sale.items || []).map(i => [i.name, i.qty, i.price]),
    t: [sale.subtotal, sale.discount, sale.tax, sale.total],
    pay: (sale.payment_methods || []).map(p => ({ type: p.type, amount: p.amount }))
  };
  let encoded = '';
  try { encoded = btoa(unescape(encodeURIComponent(JSON.stringify(compact)))); } catch(e) {}
  let shareUrl = saleId ? `${base}/r/${encodeURIComponent(String(saleId))}` : '';
  if (saleId && encoded && (shareUrl.length + encoded.length + 3) <= 150) {
    shareUrl = `${shareUrl}?d=${encoded}`;
  }
  const qrSvgStr = shareUrl ? generateQrSvg(shareUrl, 160) : '';
  return `
    <div class="root">
    ${showPaidStamp ? `
      <div class="paid-stamp" style="color:${stampColor}">
        <div class="circle">
          <div class="top">${brandName}</div>
          <div class="middle">${stampLabel}</div>
          <div class="bottom">${stampThanks}</div>
          ${stampShowDate ? `<div class="date">${t('Date')}: ${today}</div>` : ''}
        </div>
      </div>
    ` : ''}
    <div class="center"><img src="${logoSrc}" alt="${t('Logo')}" style="max-height:60px" onerror="if(this.src.endsWith('/clientlogo512.png')) this.src='/logo512.png'; else this.src='/clientlogo512.png';"/></div>
    <div class="center title">${brandName}</div>
    <div class="center small">${t('Branch').toUpperCase()}: ${branch}</div>
    ${phone ? `<div class="center small">${phone}</div>` : ''}
    <div class="hr"></div>
    <div class="title">${t('Sale Info').toUpperCase()}</div>
    <div class="small">${t('Cashier').toUpperCase()}: ${cashier}</div>
    ${customerLine}
    ${customerBusinessLines}
    <div class="hr"></div>
    <div class="title">${t('Items').toUpperCase()}</div>
    <table>
      <tbody>
        ${sale.items.map(it => `
          <tr>
            <td>${it.name}${it.spec ? ` [${it.spec}]` : ''} ${it.qty ? `x${it.qty}` : ''}${formatSerializedLine(it)}</td>
            <td class="right">${formatCurrency((Number(it.price)||0) * (Number(it.qty)||1), settings)}</td>
          </tr>`).join('')}
        <tr><td class="muted">${t('Subtotal')}</td><td class="right">${formatCurrency(sale.subtotal || 0, settings)}</td></tr>
        <tr><td class="muted">${t('Discount')}</td><td class="right">-${formatCurrency(sale.discount || 0, settings)}</td></tr>
        <tr><td class="muted">${t('Tax')}</td><td class="right">${formatCurrency(sale.tax || 0, settings)}</td></tr>
        <tr><td class="title">${t('Amount Due (VAT Incl)').toUpperCase()}</td><td class="right title">${formatCurrency(sale.total || 0, settings)}</td></tr>
      </tbody>
    </table>
    <div class="hr"></div>
    <div class="title">${t('Payments').toUpperCase()}</div>
    ${payments}
    ${hasEasyBuy ? `<div class="sp"><span>${escapeHtml(`${creditLabel} ${t('Paid')}`.toUpperCase())}</span><span>${formatCurrency(easyBuyPaidNow, settings)}</span></div>` : ''}
    ${hasEasyBuy ? `<div class="sp"><span>${escapeHtml(`${creditLabel} ${t('Balance')}`.toUpperCase())}</span><span>${formatCurrency(easyBuyBalance, settings)}</span></div>` : ''}
    ${hasEasyBuy && easyBuyDueDate ? `<div class="sp"><span>${escapeHtml(`${creditLabel} ${t('Due Date')}`.toUpperCase())}</span><span>${escapeHtml(new Date(easyBuyDueDate).toLocaleDateString())}</span></div>` : ''}
    <div class="sp"><span>${t('Rounding').toUpperCase()}</span><span>${formatCurrency(0, settings)}</span></div>
    <div class="sp"><span>${t('Change').toUpperCase()}</span><span>${formatCurrency(change, settings)}</span></div>
    <div class="sp"><span class="muted">${t('Total Items').toUpperCase()}:</span><span class="muted">${qtySum}</span></div>
    ${repaymentSection}
    <div class="hr"></div>
    <div class="title">${t('Tax Invoice').toUpperCase()}</div>
    <div class="sp"><span>${t('VAT Incl @ {rate}%', { rate })}</span><span></span></div>
    <div class="sp"><span class="muted">${t('Taxable Value').toUpperCase()}</span><span>${formatCurrency(taxableVal, settings)}</span></div>
    <div class="sp"><span class="muted">${t('VAT Value').toUpperCase()}</span><span>${formatCurrency(vatVal, settings)}</span></div>
    ${settings?.businessTpin ? `<div class="sp"><span class="muted">${t('TIN/TPIN').toUpperCase()}</span><span>${settings.businessTpin}</span></div>` : ''}
    ${sale?.receiptNumber ? `<div class="sp"><span class="muted">${t('Receipt').toUpperCase()}</span><span>${sale.receiptNumber}</span></div>` : ''}
    ${sale?.invoiceSerial ? `<div class="sp"><span class="muted">${t('Invoice').toUpperCase()}</span><span>${sale.invoiceSerial}</span></div>` : ''}
    <div class="hr"></div>
    ${shareUrl ? `<div class="center small">${t('Scan to view online')}</div>` : ''}
    ${shareUrl ? `<div class="center qr" style="margin:6px 0">${qrSvgStr}</div>` : ''}
    ${shareUrl ? `<div class="center small" style="word-break: break-all">${shareUrl}</div>` : ''}
    ${head}
    ${foot}
    </div>
  `;
}
