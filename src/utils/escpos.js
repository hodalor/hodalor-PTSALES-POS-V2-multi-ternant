import { formatCurrency } from './currency';
// Very simple ESC/POS generator helpers (text only)
export function escposReceipt({ header, items, totals, footer, settings }) {
  const lines = [];
  lines.push(center(header?.title || 'RECEIPT'));
  if (header?.store) lines.push(center(header.store));
  if (header?.branch) lines.push(center(header.branch));
  if (header?.phone) lines.push(center(`Tel: ${header.phone}`));
  if (header?.cashier) lines.push(text(`CASHIER: ${header.cashier}`));
  if (header?.customer) lines.push(text(`CUSTOMER: ${header.customer}`));
  if (settings?.businessTpin) lines.push(text(`TPIN: ${settings.businessTpin}`));
  if (header?.receiptNumber) lines.push(text(`RCPT: ${header.receiptNumber}`));
  if (header?.invoiceSerial) lines.push(text(`INV: ${header.invoiceSerial}`));
  lines.push('--------------------------------');
  const fmt = (v) => formatCurrency(v, settings || {});
  items.forEach(it => {
    const nm = it.spec ? `${it.name} [${it.spec}]` : it.name;
    lines.push(text(`${truncate(nm, 20)} x${it.qty}`));
    lines.push(right(`${fmt(it.price * it.qty)}`));
  });
  lines.push('--------------------------------');
  lines.push(text(`Subtotal    ${fmt(totals.subtotal)}`));
  lines.push(text(`Discount   -${fmt(totals.discount)}`));
  lines.push(text(`Tax         ${fmt(totals.tax)}`));
  lines.push(text(`DUE(VAT)    ${fmt(totals.total)}`));
  const base = (settings?.receiptQrBaseUrl && settings.receiptQrBaseUrl.trim()) ? settings.receiptQrBaseUrl.trim().replace(/\/+$/,'') : '';
  if (base && header?.receiptId) {
    lines.push('--------------------------------');
    lines.push(center('Scan to view receipt'));
    lines.push(center(`${base}/r/${header.receiptId}`));
  }
  if (footer?.note) {
    lines.push('--------------------------------');
    lines.push(center(footer.note));
  }
  lines.push('\n\n\n');
  return lines.join('\n');
}

export function escposOpenDrawer() {
  // BEL or ESC p m t1 t2
  return '\x1B\x70\x00\x19\xFA';
}

export function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function center(s) { return s; }
function right(s) { return s; }
function text(s) { return s; }
function truncate(s, n) { return (s || '').length > n ? s.slice(0, n - 1) + '…' : s; }
