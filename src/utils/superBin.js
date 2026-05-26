import { getMasterConnection, getTenantConnection, normalizeTenantId } from '../config/tenancy.js';
import { modelFor as SuperBinModelFor } from '../models/SuperBin.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';
import { modelFor as TenantSessionModelFor } from '../models/TenantSession.js';
import { updateCustomerCreditMetrics } from './credit.js';

function actorSnapshot(req) {
  return {
    name: String(req.user?.name || '').trim(),
    role: String(req.user?.role || '').trim(),
    tenantId: String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master'
  };
}

function plainDoc(doc) {
  if (!doc) return null;
  if (typeof doc.toObject === 'function') {
    return doc.toObject({ flattenMaps: true, depopulate: true });
  }
  return { ...doc };
}

function sourceIdForDoc(doc = {}, fallback = '') {
  return String(doc?._id || doc?.id || doc?.clientId || doc?.tenantId || fallback || '').trim();
}

function summaryForEntity(entityType, doc = {}) {
  if (entityType === 'product') {
    return {
      name: String(doc.name || '').trim(),
      sku: String(doc.sku || '').trim(),
      category: String(doc.category || '').trim()
    };
  }
  if (entityType === 'customer') {
    return {
      name: String(doc.name || '').trim(),
      customerCode: String(doc.customerCode || '').trim(),
      phone: String(doc.phone || '').trim()
    };
  }
  if (entityType === 'user') {
    return {
      name: String(doc.name || '').trim(),
      role: String(doc.role || '').trim(),
      branchId: String(doc.branchId || '').trim()
    };
  }
  if (entityType === 'sale') {
    return {
      receiptNumber: String(doc.receiptNumber || '').trim(),
      invoiceSerial: String(doc.invoiceSerial || '').trim(),
      customerName: String(doc.customerName || '').trim(),
      total: Number(doc.total || 0)
    };
  }
  if (entityType === 'credit_sale') {
    return {
      saleId: String(doc.saleId || '').trim(),
      customerId: String(doc.customer_id || '').trim(),
      branchId: String(doc.branchId || '').trim(),
      total: Number(doc.total_amount || 0)
    };
  }
  if (entityType === 'credit_repayment') {
    return {
      creditSaleId: String(doc.creditSaleId || '').trim(),
      customerId: String(doc.customerId || '').trim(),
      amount: Number(doc.amount || 0),
      status: String(doc.status || '').trim()
    };
  }
  if (entityType === 'wholesale_operation') {
    return {
      operationType: String(doc.operationType || '').trim(),
      operationArea: String(doc.operationArea || '').trim(),
      branchId: String(doc.branchId || doc.fromBranchId || '').trim(),
      status: String(doc.status || '').trim()
    };
  }
  if (entityType === 'product_unit') {
    return {
      imei: String(doc.imei || '').trim(),
      serialNumber: String(doc.serialNumber || '').trim(),
      branchId: String(doc.branchId || '').trim(),
      status: String(doc.status || '').trim()
    };
  }
  if (entityType === 'branch') {
    return {
      name: String(doc.name || '').trim(),
      code: String(doc.code || '').trim(),
      branchType: String(doc.branchType || '').trim()
    };
  }
  if (entityType === 'supplier') {
    return {
      name: String(doc.name || '').trim(),
      phone: String(doc.phone || '').trim(),
      email: String(doc.email || '').trim()
    };
  }
  if (entityType === 'expense') {
    return {
      category: String(doc.category || '').trim(),
      branchId: String(doc.branchId || '').trim(),
      amount: Number(doc.amount || 0)
    };
  }
  if (entityType === 'audit') {
    return {
      actor: String(doc.actor || '').trim(),
      actionType: String(doc.actionType || '').trim(),
      branchId: String(doc.branchId || '').trim()
    };
  }
  if (entityType === 'server_log') {
    return {
      message: String(doc.message || '').trim(),
      level: String(doc.level || '').trim(),
      route: String(doc.route || '').trim()
    };
  }
  if (entityType === 'reconciliation_account') {
    return {
      name: String(doc.name || '').trim(),
      bankName: String(doc.bankName || '').trim(),
      accountNumber: String(doc.accountNumber || '').trim()
    };
  }
  if (entityType === 'tenant') {
    return {
      tenantId: String(doc.tenantId || '').trim(),
      name: String(doc.name || '').trim(),
      dbName: String(doc.dbName || '').trim()
    };
  }
  return {};
}

function displayTextForEntity(entityType, doc = {}) {
  const summary = summaryForEntity(entityType, doc);
  if (entityType === 'product') {
    return {
      displayName: summary.name || summary.sku || 'Deleted product',
      secondaryText: summary.sku || summary.category || ''
    };
  }
  if (entityType === 'customer') {
    return {
      displayName: summary.name || summary.customerCode || 'Deleted customer',
      secondaryText: summary.customerCode || summary.phone || ''
    };
  }
  if (entityType === 'user') {
    return {
      displayName: summary.name || 'Deleted user',
      secondaryText: summary.role || summary.branchId || ''
    };
  }
  if (entityType === 'sale') {
    return {
      displayName: summary.receiptNumber || summary.invoiceSerial || 'Deleted sale',
      secondaryText: summary.customerName || ''
    };
  }
  if (entityType === 'credit_sale') {
    return {
      displayName: summary.saleId || 'Deleted credit sale',
      secondaryText: summary.customerId || summary.branchId || ''
    };
  }
  if (entityType === 'credit_repayment') {
    return {
      displayName: summary.creditSaleId || 'Deleted credit repayment',
      secondaryText: summary.customerId || summary.status || ''
    };
  }
  if (entityType === 'wholesale_operation') {
    return {
      displayName: `${summary.operationArea || 'wholesale'} ${summary.operationType || 'operation'}`.trim(),
      secondaryText: summary.branchId || summary.status || ''
    };
  }
  if (entityType === 'product_unit') {
    return {
      displayName: summary.imei || summary.serialNumber || 'Deleted serialized unit',
      secondaryText: summary.branchId || summary.status || ''
    };
  }
  if (entityType === 'tenant') {
    return {
      displayName: summary.name || summary.tenantId || 'Deleted tenant',
      secondaryText: summary.tenantId || summary.dbName || ''
    };
  }
  if (entityType === 'branch') {
    return {
      displayName: summary.name || 'Deleted branch',
      secondaryText: summary.code || summary.branchType || ''
    };
  }
  if (entityType === 'supplier') {
    return {
      displayName: summary.name || 'Deleted supplier',
      secondaryText: summary.phone || summary.email || ''
    };
  }
  if (entityType === 'expense') {
    return {
      displayName: summary.category || 'Deleted expense',
      secondaryText: summary.branchId || ''
    };
  }
  if (entityType === 'audit') {
    return {
      displayName: summary.actionType || 'Deleted audit log',
      secondaryText: summary.actor || summary.branchId || ''
    };
  }
  if (entityType === 'server_log') {
    return {
      displayName: summary.message || 'Deleted server log',
      secondaryText: summary.level || summary.route || ''
    };
  }
  if (entityType === 'reconciliation_account') {
    return {
      displayName: summary.name || 'Deleted reconciliation account',
      secondaryText: summary.bankName || summary.accountNumber || ''
    };
  }
  return {
    displayName: sourceIdForDoc(doc, 'Deleted item'),
    secondaryText: ''
  };
}

export function isMasterSuperAdmin(req) {
  const role = String(req.user?.role || '').toLowerCase();
  const tenantId = String(req.user?.tenantId || req.tenantId || '').toLowerCase();
  return role === 'superadmin' && (!tenantId || tenantId === 'master');
}

export function superBinTenantScope(req, requestedTenantId = '') {
  if (isMasterSuperAdmin(req)) {
    const nextTenantId = normalizeTenantId(requestedTenantId || '');
    return nextTenantId && nextTenantId !== 'master' ? nextTenantId : '';
  }
  return String(req.user?.tenantId || req.tenantId || 'master').trim() || 'master';
}

export async function archiveLiveDocument({
  req,
  tenantId,
  tenantName = '',
  entityType,
  collectionName,
  doc,
  remark = '',
  meta = {}
}) {
  const payload = plainDoc(doc);
  if (!payload) throw new Error('Archive payload is required');
  const master = await getMasterConnection();
  const SuperBin = await SuperBinModelFor(master);
  const actor = actorSnapshot(req);
  const display = displayTextForEntity(entityType, payload);
  const entry = await SuperBin.create({
    tenantId: normalizeTenantId(tenantId || actor.tenantId || 'master'),
    tenantName: String(tenantName || '').trim(),
    entityType: String(entityType || '').trim(),
    collectionName: String(collectionName || '').trim(),
    sourceId: sourceIdForDoc(payload, meta?.sourceId || ''),
    displayName: display.displayName,
    secondaryText: display.secondaryText,
    summary: summaryForEntity(entityType, payload),
    payload,
    meta: meta && typeof meta === 'object' ? meta : {},
    remark: String(remark || '').trim(),
    deletedByName: actor.name,
    deletedByRole: actor.role,
    deletedByTenantId: actor.tenantId,
    deletedAt: new Date()
  });
  return entry;
}

async function restoreGenericTenantDocument(entry) {
  const tenantId = normalizeTenantId(entry?.tenantId || '');
  if (!tenantId) throw new Error('Invalid tenant scope for restore');
  const collectionName = String(entry?.collectionName || '').trim();
  if (!collectionName) throw new Error('Archive collection is missing');
  const payload = entry?.payload;
  if (!payload || typeof payload !== 'object') throw new Error('Archive payload is missing');
  const conn = tenantId === 'master'
    ? await getMasterConnection()
    : await getTenantConnection(tenantId);
  await conn.db.collection(collectionName).replaceOne(
    { _id: payload._id },
    payload,
    { upsert: true }
  );
}

async function restoreManyDocuments(conn, collectionName, docs = []) {
  const rows = Array.isArray(docs) ? docs.filter((doc) => doc && typeof doc === 'object' && doc._id) : [];
  for (const row of rows) {
    await conn.db.collection(collectionName).replaceOne(
      { _id: row._id },
      row,
      { upsert: true }
    );
  }
}

async function tenantConnForEntry(entry) {
  const tenantId = normalizeTenantId(entry?.tenantId || '');
  if (!tenantId) throw new Error('Invalid tenant scope for restore');
  return tenantId === 'master'
    ? await getMasterConnection()
    : await getTenantConnection(tenantId);
}

async function restoreCreditRepaymentEntry(entry) {
  const conn = await tenantConnForEntry(entry);
  const payload = entry?.payload;
  if (!payload || typeof payload !== 'object') throw new Error('Archived credit repayment payload is missing');
  await conn.db.collection('creditrepayments').replaceOne({ _id: payload._id }, payload, { upsert: true });
  await restoreManyDocuments(conn, 'approvals', entry?.meta?.relatedApprovals || []);
  if (payload.customerId) await updateCustomerCreditMetrics(String(payload.customerId)).catch(() => {});
}

async function restoreCreditSaleEntry(entry) {
  const conn = await tenantConnForEntry(entry);
  const payload = entry?.payload;
  if (!payload || typeof payload !== 'object') throw new Error('Archived credit sale payload is missing');
  await conn.db.collection('creditsales').replaceOne({ _id: payload._id }, payload, { upsert: true });
  await restoreManyDocuments(conn, 'creditrepayments', entry?.meta?.relatedRepayments || []);
  await restoreManyDocuments(conn, 'approvals', entry?.meta?.relatedRepaymentApprovals || []);
  if (payload.customer_id) await updateCustomerCreditMetrics(String(payload.customer_id)).catch(() => {});
}

async function restoreWholesaleOperationEntry(entry) {
  const conn = await tenantConnForEntry(entry);
  const payload = entry?.payload;
  if (!payload || typeof payload !== 'object') throw new Error('Archived wholesale operation payload is missing');
  await conn.db.collection('wholesaleoperations').replaceOne({ _id: payload._id }, payload, { upsert: true });
  await restoreManyDocuments(conn, 'approvals', entry?.meta?.relatedApprovals || []);
}

async function restoreTenantRecord(entry) {
  const master = await getMasterConnection();
  const TenantModel = TenantModelFor(master);
  const payload = entry?.payload;
  if (!payload || typeof payload !== 'object') throw new Error('Archived tenant payload is missing');
  const tenantId = normalizeTenantId(payload.tenantId || entry?.tenantId || '');
  if (!tenantId || tenantId === 'master') throw new Error('Invalid tenant restore target');
  const exists = await TenantModel.findOne({ tenantId }).lean();
  if (exists) throw new Error('Tenant already exists');
  await master.db.collection('tenants').replaceOne(
    { tenantId },
    { ...payload, tenantId },
    { upsert: true }
  );
}

export async function restoreSuperBinEntry(entry) {
  const entityType = String(entry?.entityType || '').trim().toLowerCase();
  if (['product', 'customer', 'user', 'sale', 'branch', 'supplier', 'expense', 'audit', 'server_log', 'reconciliation_account', 'product_unit'].includes(entityType)) {
    await restoreGenericTenantDocument(entry);
    return;
  }
  if (entityType === 'credit_repayment') {
    await restoreCreditRepaymentEntry(entry);
    return;
  }
  if (entityType === 'credit_sale') {
    await restoreCreditSaleEntry(entry);
    return;
  }
  if (entityType === 'wholesale_operation') {
    await restoreWholesaleOperationEntry(entry);
    return;
  }
  if (entityType === 'tenant') {
    await restoreTenantRecord(entry);
    return;
  }
  throw new Error(`Restore not supported for ${entityType || 'this item'}`);
}

async function deleteForeverGenericEntry(_entry) {
  return;
}

async function deleteForeverTenantEntry(entry) {
  const tenantId = normalizeTenantId(entry?.tenantId || entry?.payload?.tenantId || '');
  if (!tenantId || tenantId === 'master') throw new Error('Invalid tenant delete target');
  const master = await getMasterConnection();
  const TenantSession = TenantSessionModelFor(master);
  await TenantSession.deleteMany({ tenantId }).catch(() => {});
  try {
    const conn = await getTenantConnection(tenantId);
    if (conn?.db) await conn.dropDatabase();
  } catch {}
}

export async function deleteForeverSuperBinEntry(entry) {
  const entityType = String(entry?.entityType || '').trim().toLowerCase();
  if (entityType === 'tenant') {
    await deleteForeverTenantEntry(entry);
    return;
  }
  await deleteForeverGenericEntry(entry);
}
