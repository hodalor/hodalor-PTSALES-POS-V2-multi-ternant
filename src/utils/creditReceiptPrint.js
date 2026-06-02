import * as salesApi from '../api/sales';
import { buildBrandedReceiptHtml, printReceiptHtml } from './print';

function findBranchName(branches = [], branchId) {
  return (Array.isArray(branches) ? branches : []).find((row) => String(row?.id || '') === String(branchId || ''))?.name || '';
}

export async function printCreditReceiptByCreditSaleId({ creditSaleId, settings, branches = [] }) {
  const id = String(creditSaleId || '').trim();
  if (!id) {
    throw new Error('Missing credit sale id for receipt printing');
  }
  const rows = await salesApi.list({ limit: 1000 });
  const sale = (Array.isArray(rows) ? rows : []).find((row) => String(row?.creditSaleId || '') === id);
  if (!sale) {
    throw new Error('Linked sale not found for receipt printing');
  }
  const branchName = sale.branchName || findBranchName(branches, sale.branchId) || sale.branchId || '-';
  const html = buildBrandedReceiptHtml({
    settings,
    sale: {
      ...sale,
      branchName
    }
  });
  printReceiptHtml(html);
  return sale;
}
