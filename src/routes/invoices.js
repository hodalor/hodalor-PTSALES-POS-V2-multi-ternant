import { Router } from 'express';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import Branch from '../models/Branch.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import Settings from '../models/Settings.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';

const r = Router();

r.use(requireAuth);

function isInvoiceEditable(invoice) {
  const source = String(invoice?.source || 'manual').trim().toLowerCase();
  const paymentStatus = String(invoice?.paymentStatus || 'unpaid').trim().toLowerCase();
  const hasLinkedSale = !!String(invoice?.saleId || '').trim();
  return ['manual', 'wholesale-manual', 'warehouse-manual'].includes(source)
    && paymentStatus === 'unpaid'
    && !hasLinkedSale;
}

function makeCustomerCode() {
  const n = Math.floor(Math.random() * 1000000);
  return String(n).padStart(6, '0');
}

async function findCustomerByReference(customer = {}) {
  const customerId = String(customer.customerId || '').trim();
  const clientId = String(customer.clientId || '').trim();
  const customerCode = String(customer.customerCode || '').trim();
  if (customerId) {
    if (mongoose.isValidObjectId(customerId)) {
      const byId = await Customer.findById(customerId);
      if (byId) return byId;
    }
    const byAlt = await Customer.findOne({ $or: [{ clientId: customerId }, { customerCode: customerId }] });
    if (byAlt) return byAlt;
  }
  if (clientId) {
    const byClient = await Customer.findOne({ clientId });
    if (byClient) return byClient;
  }
  if (customerCode) {
    const byCode = await Customer.findOne({ customerCode });
    if (byCode) return byCode;
  }
  return null;
}

async function resolveRegistrationBranch(req) {
  const registrationBranchId = String(req.user?.branchId || '').trim();
  if (!registrationBranchId) return { registrationBranchId: '', registrationBranchName: '' };
  const branch = await Branch.findOne({ id: registrationBranchId }).lean().catch(() => null);
  return {
    registrationBranchId,
    registrationBranchName: String(branch?.name || branch?.code || registrationBranchId || '').trim()
  };
}

async function resolveInvoiceCustomer(payload = {}, source = 'manual', req = {}) {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const name = String(raw.name || '').trim();
  if (!name) return null;

  const existing = await findCustomerByReference(raw);
  if (existing) return existing;

  const phone = String(raw.phone || raw.contact || '').trim();
  const businessName = String(raw.businessName || '').trim();
  const businessPhone = String(raw.businessPhone || '').trim();
  if (phone || businessName || businessPhone) {
    const or = [];
    if (phone) or.push({ phone });
    if (businessPhone) or.push({ businessPhone });
    if (businessName) or.push({ businessName });
    if (name) or.push({ name });
    if (or.length > 0) {
      const likelyMatch = await Customer.findOne({ $or: or }).sort({ updatedAt: -1 });
      if (likelyMatch) return likelyMatch;
    }
  }

  const registrationBranch = await resolveRegistrationBranch(req);
  const doc = {
    clientId: String(raw.clientId || '').trim() || undefined,
    customerCode: String(raw.customerCode || '').trim() || null,
    name,
    phone,
    email: String(raw.email || '').trim() || '',
    customerType: String(source || '').startsWith('wholesale') ? 'distribution' : 'retail',
    address: String(raw.address || '').trim() || '',
    registrationBranchId: registrationBranch.registrationBranchId,
    registrationBranchName: registrationBranch.registrationBranchName,
    businessName,
    businessAddress: String(raw.businessAddress || raw.address || '').trim() || '',
    taxId: String(raw.taxId || '').trim() || '',
    businessPhone,
    businessEmail: String(raw.businessEmail || '').trim() || ''
  };

  for (let i = 0; i < 15; i += 1) {
    const next = { ...doc };
    if (!next.customerCode) next.customerCode = makeCustomerCode();
    try {
      return await Customer.create(next);
    } catch (e) {
      if (e && e.code === 11000) {
        doc.customerCode = null;
        continue;
      }
      throw e;
    }
  }
  return null;
}

r.get('/', requireRoleOrPerm(['Admin','Manager','Cashier'], ['see_invoices', 'view_invoices', 'view_wholesale_invoices', 'view_warehouse_invoices']), async (req, res) => {
  const rows = await Invoice.find().sort({ createdAt: -1 }).limit(500);
  res.json(rows);
});

r.post('/', requireRoleOrPerm(['Admin','Manager','Cashier'], ['add_invoices', 'see_invoices', 'view_invoices', 'view_wholesale_invoices', 'view_warehouse_invoices']), async (req, res) => {
  const payload = req.body || {};
  const clientId = String(payload.clientId || '').trim();
  if (clientId) {
    const existing = await Invoice.findOne({ clientId });
    if (existing) return res.json(existing);
  }
  let settingsData = {};
  try {
    const doc = await Settings.findOne({ key: 'default' });
    settingsData = doc?.data || {};
  } catch {}
  let number = String(payload.number || '');
  const digits = Math.max(3, Number(settingsData.invoiceNumberDigits || 6));
  const source = String(payload.source || 'manual');
  const counterField = source === 'wholesale-manual'
    ? 'data.nextWholesaleInvoiceNumber'
    : source === 'warehouse-manual'
      ? 'data.nextWarehouseInvoiceNumber'
      : 'data.nextInvoiceNumber';
  const prefix = source === 'wholesale-manual'
    ? String(settingsData.wholesaleInvoicePrefix || 'WINV')
    : source === 'warehouse-manual'
      ? String(settingsData.warehouseInvoicePrefix || 'WHINV')
      : String(settingsData.invoicePrefix || 'INV');
  if (!number) {
    try {
      const updated = await Settings.findOneAndUpdate(
        { key: 'default' },
        { $inc: { [counterField]: 1 } },
        { new: true, upsert: true }
      );
      const n = Math.max(1, Number(counterField === 'data.nextWholesaleInvoiceNumber'
        ? updated?.data?.nextWholesaleInvoiceNumber
        : counterField === 'data.nextWarehouseInvoiceNumber'
          ? updated?.data?.nextWarehouseInvoiceNumber
          : updated?.data?.nextInvoiceNumber || 1) - 1);
      number = `${prefix}-${String(n).padStart(digits, '0')}`;
    } catch {
      number = `${prefix}-${String(Date.now()).slice(-digits)}`;
    }
  }
  let normalizedCustomer = payload.customer || null;
  try {
    const linkedCustomer = await resolveInvoiceCustomer(payload.customer || {}, source, req);
    if (linkedCustomer) {
      normalizedCustomer = {
        name: linkedCustomer.name || '',
        phone: linkedCustomer.phone || '',
        email: linkedCustomer.email || '',
        address: linkedCustomer.address || '',
        businessName: linkedCustomer.businessName || '',
        businessAddress: linkedCustomer.businessAddress || '',
        taxId: linkedCustomer.taxId || '',
        customerCode: linkedCustomer.customerCode || '',
        customerId: String(linkedCustomer._id || linkedCustomer.id || ''),
        clientId: linkedCustomer.clientId || String(payload.customer?.clientId || '').trim() || undefined
      };
    }
  } catch {}
  const inv = await Invoice.create({ ...payload, customer: normalizedCustomer, clientId: clientId || undefined, number });
  try {
    await Audit.create({
      actor: req.user?.name || 'unknown',
      actionType: 'invoice_created',
      details: { number: inv.number, source: inv.source || 'manual', total: inv.total },
      branchId: payload.branchId || 'n/a'
    });
  } catch {}
  try {
    await ServerLog.create({
      level: 'info',
      actor: req.user?.name || 'unknown',
      route: '/api/invoices',
      method: 'POST',
      status: 200,
      message: `Invoice ${inv.number} created (${inv.source || 'manual'})`,
      details: { total: inv.total }
    });
  } catch {}
  res.json(inv);
});

r.put('/:id', requireRoleOrPerm(['Admin','Manager','Cashier'], ['add_invoices', 'see_invoices', 'view_invoices', 'view_wholesale_invoices', 'view_warehouse_invoices']), async (req, res) => {
  const key = String(req.params.id || '').trim();
  const query = [];
  if (mongoose.isValidObjectId(key)) query.push({ _id: key });
  query.push({ clientId: key });
  const existing = await Invoice.findOne({ $or: query });
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (!isInvoiceEditable(existing)) {
    return res.status(400).json({ error: 'Only unpaid generated invoices can be edited' });
  }
  const payload = req.body || {};
  let normalizedCustomer = payload.customer || existing.customer || null;
  try {
    const linkedCustomer = await resolveInvoiceCustomer(payload.customer || existing.customer || {}, String(existing.source || payload.source || 'manual'), req);
    if (linkedCustomer) {
      normalizedCustomer = {
        name: linkedCustomer.name || '',
        phone: linkedCustomer.phone || '',
        email: linkedCustomer.email || '',
        address: linkedCustomer.address || '',
        businessName: linkedCustomer.businessName || '',
        businessAddress: linkedCustomer.businessAddress || '',
        taxId: linkedCustomer.taxId || '',
        customerCode: linkedCustomer.customerCode || '',
        customerId: String(linkedCustomer._id || linkedCustomer.id || ''),
        clientId: linkedCustomer.clientId || String(payload.customer?.clientId || '').trim() || undefined,
        businessPhone: linkedCustomer.businessPhone || ''
      };
    }
  } catch {}
  existing.date = payload.date || existing.date;
  existing.customer = normalizedCustomer || {};
  existing.items = Array.isArray(payload.items) ? payload.items : existing.items;
  existing.subtotal = Number(payload.subtotal || 0);
  existing.discount = Math.max(0, Number(payload.discount || 0));
  existing.tax = Math.max(0, Number(payload.tax || 0));
  existing.total = Math.max(0, Number(payload.total || 0));
  existing.notes = String(payload.notes || '');
  existing.deliveryNote = String(payload.deliveryNote || '');
  existing.paymentTerms = String(payload.paymentTerms || '');
  existing.otherRef = String(payload.otherRef || '');
  existing.supplierRef = String(payload.supplierRef || '');
  existing.buyerOrderNo = String(payload.buyerOrderNo || '');
  existing.despatchDocNo = String(payload.despatchDocNo || '');
  existing.deliveryDate = String(payload.deliveryDate || '');
  existing.despatchedThrough = String(payload.despatchedThrough || '');
  existing.destination = String(payload.destination || '');
  existing.termsOfDelivery = String(payload.termsOfDelivery || '');
  await existing.save();
  try {
    await Audit.create({
      actor: req.user?.name || 'unknown',
      actionType: 'invoice_updated',
      details: { number: existing.number, source: existing.source || 'manual', total: existing.total },
      branchId: payload.branchId || 'n/a'
    });
  } catch {}
  res.json(existing);
});

export default r;
