import { Router } from 'express';
import Invoice from '../models/Invoice.js';
import Audit from '../models/Audit.js';
import ServerLog from '../models/ServerLog.js';
import Settings from '../models/Settings.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';

const r = Router();

r.use(requireAuth);

r.get('/', requireRoleOrPerm(['Admin','Manager','Cashier'], 'see_invoices'), async (req, res) => {
  const rows = await Invoice.find().sort({ createdAt: -1 }).limit(500);
  res.json(rows);
});

r.post('/', requireRoleOrPerm(['Admin','Manager','Cashier'], 'add_invoices'), async (req, res) => {
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
  const inv = await Invoice.create({ ...payload, clientId: clientId || undefined, number });
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

export default r;
