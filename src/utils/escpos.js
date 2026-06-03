import { formatCurrency } from './currency';
// Very simple ESC/POS generator helpers (text only)
function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function paymentMethodLabel(value) {
  const method = String(value || '').trim().toLowerCase();
  if (method === 'card') return 'CARD';
  if (method === 'mobile') return 'MOBILE MONEY';
  if (method === 'wallet') return 'WALLET';
  return 'CASH';
}

function repaymentStatusLabel(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'approved') return 'APPROVED';
  if (status === 'rejected') return 'REJECTED';
  if (status === 'pending_manager') return 'PENDING MANAGER';
  return 'PENDING DIRECTOR';
}

function actorLabel(name, role) {
  const person = String(name || '').trim();
  const personRole = String(role || '').trim();
  if (person && personRole) return `${person} (${personRole})`;
  return person || personRole || '';
}

function getReceiptCreditLabel(sale) {
  const packageName = String(sale?.creditPackageName || sale?.creditSale?.creditPackageName || '').trim();
  if (packageName) return packageName.toUpperCase();
  const creditMode = String(sale?.creditMode || '').trim().toLowerCase();
  return creditMode === 'distribution_credit' ? 'DISTRIBUTION CREDIT' : 'EASYBUY';
}

export function escposReceipt({ header, items, totals, footer, settings, sale }) {
  const lines = [];
  const repaymentHistory = Array.isArray(sale?.repaymentHistory) ? sale.repaymentHistory : [];
  const creditLabel = getReceiptCreditLabel(sale);
  const creditPaid = Number(sale?.creditAmountPaidNow ?? sale?.creditSale?.amount_paid ?? sale?.creditSale?.amountPaidNow ?? 0);
  const creditBalance = Number(sale?.creditBalance ?? sale?.creditSale?.balance ?? Math.max(0, Number(sale?.total || totals?.total || 0) - creditPaid));
  const creditDueDate = sale?.creditDueDate || sale?.creditSale?.due_date || sale?.creditSale?.dueDate || null;
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
  if (creditDueDate || repaymentHistory.length > 0 || creditPaid > 0 || creditBalance > 0) {
    lines.push('--------------------------------');
    lines.push(text('CREDIT LEDGER'));
    lines.push(text(`SALE DATE    ${formatDateTime(sale?.created_at)}`));
    lines.push(text(`CREDIT TOTAL ${fmt(sale?.total || totals.total)}`));
    lines.push(text(`UPFRONT PAID ${fmt(creditPaid)}`));
    lines.push(text(`OUTSTANDING  ${fmt(creditBalance)}`));
    if (creditDueDate) lines.push(text(`DUE DATE     ${new Date(creditDueDate).toLocaleDateString()}`));
    if (repaymentHistory.length === 0) {
      lines.push(text('NO REPAYMENTS YET'));
    } else {
      repaymentHistory.forEach((entry, index) => {
        const initiatedBy = actorLabel(entry?.initiatedByName, entry?.initiatedByRole);
        const approvedBy = actorLabel(entry?.approvedByName, entry?.approvedByRole);
        lines.push('--------------------------------');
        lines.push(text(`REPAYMENT ${index + 1}`));
        lines.push(text(`AMOUNT      ${fmt(entry?.amount || 0)}`));
        lines.push(text(`METHOD      ${paymentMethodLabel(entry?.paymentMethod)}`));
        lines.push(text(`STATUS      ${repaymentStatusLabel(entry?.status)}`));
        if (entry?.initiatedAt) lines.push(text(`INITIATED   ${formatDateTime(entry.initiatedAt)}`));
        if (initiatedBy) lines.push(text(`INIT BY     ${initiatedBy}`));
        if (entry?.approvedAt) lines.push(text(`APPROVED    ${formatDateTime(entry.approvedAt)}`));
        if (approvedBy) lines.push(text(`APP BY      ${approvedBy}`));
        if (entry?.remark) lines.push(text(`REMARK      ${entry.remark}`));
      });
    }
    lines.push(text(`MODE        ${creditLabel}`));
  }
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
