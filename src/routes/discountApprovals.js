import { Router } from 'express';
import DiscountApproval from '../models/DiscountApproval.js';
import Audit from '../models/Audit.js';
import { requireAuth, requireRoleOrPerm } from '../middleware/auth.js';

const r = Router();

r.use(requireAuth);

function normalizeBranchIds(value) {
  if (value === 'all') return 'all';
  return Array.from(new Set(
    (Array.isArray(value) ? value : [value])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function getAccessibleBranchIds(user = {}) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'superadmin') return 'all';
  const assigned = normalizeBranchIds(user?.assignedBranches);
  if (assigned === 'all') return 'all';
  return normalizeBranchIds([user?.branchId, ...(Array.isArray(assigned) ? assigned : [])]);
}

function canApproveDiscount(user = {}) {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  return role === 'admin' || role === 'superadmin' || grants.includes('approve_discount_sales');
}

function canSeeRow(user = {}, row = {}) {
  if (!row) return false;
  if (canApproveDiscount(user)) {
    const branches = getAccessibleBranchIds(user);
    if (branches === 'all') return true;
    return branches.includes(String(row.branchId || ''));
  }
  return String(row.submittedByName || '') === String(user?.name || '');
}

function computeTaxRate(subtotal = 0, discount = 0, tax = 0) {
  const taxable = Math.max(0, Number(subtotal || 0) - Number(discount || 0));
  if (taxable <= 0) return 0;
  return Math.max(0, Number(tax || 0)) / taxable;
}

function adjustPaymentMethods(paymentMethods = [], nextTotal = 0) {
  const methods = Array.isArray(paymentMethods) ? paymentMethods.map((entry) => ({
    ...entry,
    amount: Math.max(0, Number(entry?.amount || 0))
  })) : [];
  const currentTotal = methods.reduce((sum, entry) => sum + Math.max(0, Number(entry?.amount || 0)), 0);
  const delta = Number(nextTotal || 0) - currentTotal;
  if (methods.length === 0) return [{ type: 'cash', amount: Math.max(0, Number(nextTotal || 0)) }];
  const targetIndex = Math.max(0, methods.findIndex((entry) => String(entry?.type || '').toLowerCase() === 'cash'));
  methods[targetIndex] = {
    ...methods[targetIndex],
    amount: Math.max(0, Number(methods[targetIndex]?.amount || 0) + delta)
  };
  return methods;
}

function applyReviewedDiscount(row, requestedDiscount) {
  const salePayload = row?.salePayload && typeof row.salePayload === 'object' ? { ...row.salePayload } : {};
  const subtotal = Math.max(0, Number(row?.subtotal || salePayload?.subtotal || 0));
  const boundedDiscount = Math.min(subtotal, Math.max(0, Number(requestedDiscount || 0)));
  const taxRate = computeTaxRate(subtotal, row?.discount || salePayload?.discount || 0, row?.tax || salePayload?.tax || 0);
  const nextTax = Math.max(0, (subtotal - boundedDiscount) * taxRate);
  const nextTotal = Math.max(0, subtotal - boundedDiscount + nextTax);
  const nextPaymentMethods = adjustPaymentMethods(salePayload?.payment_methods, nextTotal);
  return {
    subtotal,
    discount: boundedDiscount,
    reviewedDiscount: boundedDiscount,
    tax: nextTax,
    total: nextTotal,
    salePayload: {
      ...salePayload,
      subtotal,
      discount: boundedDiscount,
      tax: nextTax,
      total: nextTotal,
      payment_methods: nextPaymentMethods
    }
  };
}

r.get('/', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['add_sales', 'approve_discount_sales']), async (req, res) => {
  const query = {};
  if (req.query.status) {
    const requestedStatus = String(req.query.status || '');
    if (requestedStatus === 'completed') {
      query.status = { $in: ['completed', 'cancelled'] };
    } else {
      query.status = requestedStatus;
    }
  }
  if (req.query.posType) query.posType = String(req.query.posType || '');
  if (req.query.branchId) query.branchId = String(req.query.branchId || '');
  const rows = await DiscountApproval.find(query).sort({ createdAt: -1 }).limit(500).lean();
  const mineOnly = String(req.query.mine || '').trim() === '1';
  const filtered = rows.filter((row) => {
    if (mineOnly && String(row.submittedByName || '') !== String(req.user?.name || '')) return false;
    return canSeeRow(req.user, row);
  });
  res.json(filtered);
});

r.post('/request', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], 'add_sales'), async (req, res) => {
  const payload = req.body?.salePayload || {};
  const discount = Math.max(0, Number(payload?.discount || 0));
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (discount <= 0) return res.status(400).json({ error: 'Discount amount must be greater than zero' });
  if (!String(payload?.branchId || '').trim()) return res.status(400).json({ error: 'Branch is required' });
  if (items.length === 0) return res.status(400).json({ error: 'Discount request requires at least one item' });
  const requestKey = String(req.body?.requestKey || '').trim();
  if (requestKey) {
    const existing = await DiscountApproval.findOne({ requestKey }).lean();
    if (existing && canSeeRow(req.user, existing)) return res.json(existing);
  }
  const row = await DiscountApproval.create({
    requestKey: requestKey || undefined,
    branchId: String(payload.branchId || ''),
    branchName: String(payload.branchName || ''),
    posType: String(payload.posType || 'retail'),
    inventoryType: String(payload.inventoryType || 'retail'),
    submittedByName: String(req.user?.name || 'unknown'),
    submittedByRole: String(req.user?.role || ''),
    customerId: String(payload.customerId || ''),
    customerCode: String(payload.customerCode || ''),
    customerName: String(payload.customerName || ''),
    customerPhone: String(payload.customerPhone || ''),
    subtotal: Math.max(0, Number(payload.subtotal || 0)),
    discount,
    reviewedDiscount: discount,
    tax: Math.max(0, Number(payload.tax || 0)),
    total: Math.max(0, Number(payload.total || 0)),
    itemCount: items.reduce((sum, item) => sum + Math.max(0, Number(item?.qty || 0)), 0),
    items: items.map((item) => ({
      productId: String(item?.productId || ''),
      variantId: String(item?.variantId || ''),
      sku: String(item?.sku || ''),
      name: String(item?.name || ''),
      brand: String(item?.brand || ''),
      spec: String(item?.spec || ''),
      qty: Math.max(0, Number(item?.qty || 0)),
      price: Math.max(0, Number(item?.price || 0)),
      priceTier: String(item?.priceTier || payload?.defaultPriceTier || 'retail')
    })),
    salePayload: payload,
    status: 'under_review'
  });
  try {
    await Audit.create({
      actor: String(req.user?.name || 'unknown'),
      actionType: 'discount_sale_submitted',
      details: {
        discountApprovalId: String(row._id || ''),
        branchId: String(row.branchId || ''),
        posType: String(row.posType || ''),
        total: Number(row.total || 0),
        discount: Number(row.discount || 0)
      },
      branchId: String(row.branchId || ''),
      ts: new Date()
    });
  } catch {}
  res.json(row);
});

r.post('/:id/approve', requireRoleOrPerm(['Admin', 'Manager', 'SuperAdmin'], 'approve_discount_sales'), async (req, res) => {
  const row = await DiscountApproval.findById(req.params.id);
  if (!row) return res.status(404).json({ error: 'Discount request not found' });
  if (!canSeeRow(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  if (['completed', 'cancelled'].includes(String(row.status || ''))) return res.status(400).json({ error: 'Discount request is already closed' });
  if (String(row.submittedByName || '').trim() === String(req.user?.name || '').trim() && !['admin', 'superadmin'].includes(String(req.user?.role || '').toLowerCase())) {
    return res.status(400).json({ error: 'Initiator cannot approve the same discount request' });
  }
  const reviewedDiscountInput = req.body?.discount;
  const nextValues = applyReviewedDiscount(row, reviewedDiscountInput == null ? row.reviewedDiscount || row.discount || 0 : reviewedDiscountInput);
  row.status = 'approved';
  row.approvedByName = String(req.user?.name || 'unknown');
  row.approvedByRole = String(req.user?.role || '');
  row.approvedAt = new Date();
  row.approvalRemark = String(req.body?.remark || '').trim();
  row.subtotal = nextValues.subtotal;
  row.discount = nextValues.discount;
  row.reviewedDiscount = nextValues.reviewedDiscount;
  row.tax = nextValues.tax;
  row.total = nextValues.total;
  row.salePayload = nextValues.salePayload;
  await row.save();
  try {
    await Audit.create({
      actor: String(req.user?.name || 'unknown'),
      actionType: 'discount_sale_approved',
      details: {
        discountApprovalId: String(row._id || ''),
        submittedByName: String(row.submittedByName || ''),
        total: Number(row.total || 0),
        discount: Number(row.discount || 0)
      },
      remark: String(row.approvalRemark || ''),
      branchId: String(row.branchId || ''),
      ts: new Date()
    });
  } catch {}
  res.json(row);
});

r.post('/:id/reject', requireRoleOrPerm(['Admin', 'Manager', 'SuperAdmin'], 'approve_discount_sales'), async (req, res) => {
  const row = await DiscountApproval.findById(req.params.id);
  if (!row) return res.status(404).json({ error: 'Discount request not found' });
  if (!canSeeRow(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  if (['completed', 'cancelled'].includes(String(row.status || ''))) return res.status(400).json({ error: 'Discount request is already closed' });
  const remark = String(req.body?.remark || '').trim();
  if (!remark) return res.status(400).json({ error: 'Remark is required' });
  row.status = 'rejected';
  row.rejectedByName = String(req.user?.name || 'unknown');
  row.rejectedByRole = String(req.user?.role || '');
  row.rejectedAt = new Date();
  row.rejectionRemark = remark;
  await row.save();
  try {
    await Audit.create({
      actor: String(req.user?.name || 'unknown'),
      actionType: 'discount_sale_rejected',
      details: {
        discountApprovalId: String(row._id || ''),
        submittedByName: String(row.submittedByName || ''),
        total: Number(row.total || 0),
        discount: Number(row.discount || 0)
      },
      remark,
      branchId: String(row.branchId || ''),
      ts: new Date()
    });
  } catch {}
  res.json(row);
});

r.post('/:id/cancel', requireRoleOrPerm(['Admin', 'Manager', 'Cashier'], ['add_sales', 'approve_discount_sales']), async (req, res) => {
  const row = await DiscountApproval.findById(req.params.id);
  if (!row) return res.status(404).json({ error: 'Discount request not found' });
  if (!canSeeRow(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  if (['completed', 'cancelled'].includes(String(row.status || ''))) return res.status(400).json({ error: 'Discount request is already closed' });
  row.status = 'cancelled';
  row.completedByName = String(req.user?.name || 'unknown');
  row.completedByRole = String(req.user?.role || '');
  row.completedAt = new Date();
  await row.save();
  try {
    await Audit.create({
      actor: String(req.user?.name || 'unknown'),
      actionType: 'discount_sale_cancelled',
      details: {
        discountApprovalId: String(row._id || ''),
        submittedByName: String(row.submittedByName || ''),
        total: Number(row.total || 0),
        discount: Number(row.discount || 0)
      },
      remark: String(req.body?.remark || '').trim(),
      branchId: String(row.branchId || ''),
      ts: new Date()
    });
  } catch {}
  res.json(row);
});

export default r;
