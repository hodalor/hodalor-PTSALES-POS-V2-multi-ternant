import Audit from '../models/Audit.js';
import Approval from '../models/Approval.js';
import CashReconciliation from '../models/CashReconciliation.js';
import CreditRepayment from '../models/CreditRepayment.js';
import CreditSale from '../models/CreditSale.js';
import Product from '../models/Product.js';
import ReconciliationAccount from '../models/ReconciliationAccount.js';
import WholesaleOperation from '../models/WholesaleOperation.js';
import mongoose from 'mongoose';
import { getMapQty, getStockTarget, markInventoryModified, setMapQty } from './inventory.js';
import { makeInventoryLine, withInventoryAudit } from './inventoryAudit.js';
import { refreshCreditSaleStatus, updateCustomerCreditMetrics } from './credit.js';
import { adjustSerializedUnits, normalizeTrackType, transferSerializedUnits } from './productUnits.js';

function productQuery(productId) {
  const pid = String(productId || '');
  const or = [{ id: pid }];
  if (mongoose.isValidObjectId(pid)) or.unshift({ _id: pid });
  return { $or: or };
}

export function canApproveDirector(user) {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  return ['admin', 'superadmin', 'director'].includes(role) || grants.includes('approve_credit_director') || grants.includes('approve_finance_reconciliation_director');
}

export function canApproveManager(user) {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  return ['manager', 'admin', 'superadmin'].includes(role) || grants.includes('approve_credit_manager') || grants.includes('approve_finance_reconciliation_manager');
}

export function canApproveAreaDirector(user, area = 'wholesale') {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  if (['admin', 'superadmin', 'director'].includes(role)) return true;
  if (String(area || '').toLowerCase() === 'warehouse') return grants.includes('approve_warehouse_director');
  return grants.includes('approve_distribution_director');
}

export function canApproveAreaManager(user, area = 'wholesale') {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  if (['manager', 'admin', 'superadmin'].includes(role)) return true;
  if (String(area || '').toLowerCase() === 'warehouse') return grants.includes('approve_warehouse_manager');
  return grants.includes('approve_distribution_manager');
}

async function applyWholesaleOperation(operation, actor) {
  const items = Array.isArray(operation.items) && operation.items.length > 0
    ? operation.items
    : [{
        lineId: '1',
        productId: operation.productId,
        variantId: operation.variantId || '',
        qty: Number(operation.qty || 0),
        unitIds: Array.isArray(operation.unitIds) ? operation.unitIds.map(String).filter(Boolean) : [],
        cost: Number(operation.cost || 0),
        requestedAmount: Number(operation.requestedAmount || 0),
        adjustmentType: operation.adjustmentType || 'increase',
        supplier: operation.supplier || '',
        reason: operation.reason || '',
        remark: operation.remark || '',
        status: 'accepted'
      }];
  const acceptedItems = items.filter(item => String(item.status || 'accepted').toLowerCase() !== 'cancelled');
  const productIds = Array.from(new Set(acceptedItems.map(item => String(item.productId || '')).filter(Boolean)));
  const objectIds = productIds.filter(pid => mongoose.isValidObjectId(pid)).map(pid => new mongoose.Types.ObjectId(pid));
  const products = productIds.length > 0
    ? await Product.find({
      $or: [
        { id: { $in: productIds } },
        ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : [])
      ]
    })
    : [];
  const productByKey = new Map();
  products.forEach(product => {
    productByKey.set(String(product._id), product);
    if (product.id) productByKey.set(String(product.id), product);
  });
  let acceptedCount = 0;
  const dirtyProducts = new Map();
  const inventoryLines = [];
  for (const item of items) {
    if (String(item.status || '').toLowerCase() === 'cancelled') continue;
    const product = productByKey.get(String(item.productId || ''));
    if (!product) {
      const err = new Error('Product not found for wholesale operation');
      err.status = 400;
      throw err;
    }
    const qty = Math.max(0, Number(item.qty || 0));
    if (qty <= 0) continue;
    if (operation.operationType === 'purchase' || operation.operationType === 'refund') {
      if (normalizeTrackType(product.trackType) === 'serialized') {
        if (!Array.isArray(item.serializedEntries) || item.serializedEntries.length !== qty) {
          const err = new Error(`Serialized ${operation.operationType} for ${product.name} requires exactly ${qty} IMEI/serial entries`);
          err.status = 400;
          throw err;
        }
        await adjustSerializedUnits({
          productId: item.productId,
          variantId: item.variantId || '',
          branchId: operation.branchId || operation.toBranchId,
          inventoryType: operation.toInventoryType || operation.fromInventoryType || 'wholesale',
          entries: item.serializedEntries,
          mode: 'increase'
        });
        acceptedCount += 1;
        continue;
      }
      const target = getStockTarget(product, item.variantId, operation.toInventoryType || operation.fromInventoryType || 'wholesale');
      if (!target) {
        const err = new Error('Variant not found');
        err.status = 400;
        throw err;
      }
      const current = getMapQty(target.container, operation.branchId || operation.toBranchId);
      setMapQty(target.container, operation.branchId || operation.toBranchId, current + qty);
      markInventoryModified(target);
      dirtyProducts.set(String(product._id), product);
      inventoryLines.push(makeInventoryLine({
        productId: item.productId,
        productName: product.name,
        variantId: item.variantId || '',
        branchId: operation.branchId || operation.toBranchId,
        inventoryType: operation.toInventoryType || operation.fromInventoryType || operation.operationArea || 'wholesale',
        delta: qty,
        reason: item.reason || operation.reason || '',
        remark: item.remark || operation.remark || ''
      }));
    } else if (operation.operationType === 'adjustment') {
      if (normalizeTrackType(product.trackType) === 'serialized') {
        if (String(item.adjustmentType || operation.adjustmentType || 'increase') === 'decrease') {
          if (!Array.isArray(item.unitIds) || item.unitIds.length !== qty) {
            const err = new Error(`Serialized adjustment decrease for ${product.name} requires exactly ${qty} selected unit(s)`);
            err.status = 400;
            throw err;
          }
          await adjustSerializedUnits({
            productId: item.productId,
            variantId: item.variantId || '',
            branchId: operation.branchId || operation.fromBranchId,
            inventoryType: operation.fromInventoryType || 'wholesale',
            unitIds: item.unitIds,
            mode: 'decrease'
          });
        } else {
          if (!Array.isArray(item.serializedEntries) || item.serializedEntries.length !== qty) {
            const err = new Error(`Serialized adjustment increase for ${product.name} requires exactly ${qty} IMEI/serial entries`);
            err.status = 400;
            throw err;
          }
          await adjustSerializedUnits({
            productId: item.productId,
            variantId: item.variantId || '',
            branchId: operation.branchId || operation.fromBranchId,
            inventoryType: operation.fromInventoryType || 'wholesale',
            entries: item.serializedEntries,
            mode: 'increase'
          });
        }
        acceptedCount += 1;
        continue;
      }
      const target = getStockTarget(product, item.variantId, operation.fromInventoryType || 'wholesale');
      if (!target) {
        const err = new Error('Variant not found');
        err.status = 400;
        throw err;
      }
      const branchId = operation.branchId || operation.fromBranchId;
      const current = getMapQty(target.container, branchId);
      const delta = String(item.adjustmentType || operation.adjustmentType || 'increase') === 'decrease' ? -qty : qty;
      if (current + delta < 0) {
        const err = new Error('Insufficient stock for adjustment');
        err.status = 400;
        throw err;
      }
      setMapQty(target.container, branchId, current + delta);
      markInventoryModified(target);
      dirtyProducts.set(String(product._id), product);
      inventoryLines.push(makeInventoryLine({
        productId: item.productId,
        productName: product.name,
        variantId: item.variantId || '',
        branchId,
        inventoryType: operation.fromInventoryType || operation.operationArea || 'wholesale',
        delta,
        reason: item.reason || operation.reason || '',
        remark: item.remark || operation.remark || ''
      }));
    } else if (operation.operationType === 'transfer') {
      if (normalizeTrackType(product.trackType) === 'serialized') {
        if (!Array.isArray(item.unitIds) || item.unitIds.length !== qty) {
          const err = new Error(`Serialized transfer for ${product.name} requires exactly ${qty} selected unit(s)`);
          err.status = 400;
          throw err;
        }
        // #region debug-point A:workflow-transfer-serialized
        import('node:fs').then(({ default: fs }) => { let u = 'http://127.0.0.1:7777/event'; let s = 'warehouse-transfer-source-stock'; try { const e = fs.readFileSync('.dbg/warehouse-transfer-source-stock.env', 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s; } catch {} return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre-fix', hypothesisId: 'A', location: 'approvalWorkflow.js:transfer-serialized', msg: '[DEBUG] Workflow serialized transfer approval executing', data: { operationId: String(operation?._id || operation?.clientId || ''), operationArea: String(operation?.operationArea || ''), fromBranchId: String(operation?.fromBranchId || ''), toBranchId: String(operation?.toBranchId || ''), fromInventoryType: String(operation?.fromInventoryType || ''), toInventoryType: String(operation?.toInventoryType || ''), productId: String(item?.productId || ''), variantId: String(item?.variantId || ''), qty, unitCount: Array.isArray(item?.unitIds) ? item.unitIds.length : 0, actorName: String(actor?.name || '') }, ts: Date.now() }) }).catch(() => {}); }).catch(() => {});
        // #endregion
        await transferSerializedUnits({
          productId: item.productId,
          variantId: item.variantId || '',
          fromBranchId: operation.fromBranchId,
          toBranchId: operation.toBranchId,
          fromInventoryType: operation.fromInventoryType || 'wholesale',
          toInventoryType: operation.toInventoryType || 'wholesale',
          unitIds: item.unitIds
        });
        acceptedCount += 1;
        continue;
      }
      const fromTarget = getStockTarget(product, item.variantId, operation.fromInventoryType || 'wholesale');
      const toTarget = getStockTarget(product, item.variantId, operation.toInventoryType || 'wholesale');
      if (!fromTarget || !toTarget) {
        const err = new Error('Variant not found');
        err.status = 400;
        throw err;
      }
      const fromCurrent = getMapQty(fromTarget.container, operation.fromBranchId);
      if (fromCurrent < qty) {
        const err = new Error('Insufficient stock for transfer');
        err.status = 400;
        throw err;
      }
      const toCurrent = getMapQty(toTarget.container, operation.toBranchId);
      // #region debug-point B:workflow-transfer-before-after
      import('node:fs').then(({ default: fs }) => { let u = 'http://127.0.0.1:7777/event'; let s = 'warehouse-transfer-source-stock'; try { const e = fs.readFileSync('.dbg/warehouse-transfer-source-stock.env', 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s; } catch {} return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre-fix', hypothesisId: 'B', location: 'approvalWorkflow.js:transfer-before', msg: '[DEBUG] Workflow transfer before stock mutation', data: { operationId: String(operation?._id || operation?.clientId || ''), operationArea: String(operation?.operationArea || ''), fromBranchId: String(operation?.fromBranchId || ''), toBranchId: String(operation?.toBranchId || ''), fromInventoryType: String(operation?.fromInventoryType || ''), toInventoryType: String(operation?.toInventoryType || ''), productId: String(item?.productId || ''), variantId: String(item?.variantId || ''), qty, fromCurrent, toCurrent }, ts: Date.now() }) }).catch(() => {}); }).catch(() => {});
      // #endregion
      setMapQty(fromTarget.container, operation.fromBranchId, fromCurrent - qty);
      setMapQty(toTarget.container, operation.toBranchId, toCurrent + qty);
      // #region debug-point B:workflow-transfer-after
      import('node:fs').then(({ default: fs }) => { let u = 'http://127.0.0.1:7777/event'; let s = 'warehouse-transfer-source-stock'; try { const e = fs.readFileSync('.dbg/warehouse-transfer-source-stock.env', 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s; } catch {} return fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: s, runId: 'pre-fix', hypothesisId: 'B', location: 'approvalWorkflow.js:transfer-after', msg: '[DEBUG] Workflow transfer after stock mutation', data: { operationId: String(operation?._id || operation?.clientId || ''), operationArea: String(operation?.operationArea || ''), fromBranchId: String(operation?.fromBranchId || ''), toBranchId: String(operation?.toBranchId || ''), fromInventoryType: String(operation?.fromInventoryType || ''), toInventoryType: String(operation?.toInventoryType || ''), productId: String(item?.productId || ''), variantId: String(item?.variantId || ''), qty, fromNext: getMapQty(fromTarget.container, operation.toBranchId ? operation.fromBranchId : operation.fromBranchId), toNext: getMapQty(toTarget.container, operation.toBranchId) }, ts: Date.now() }) }).catch(() => {}); }).catch(() => {});
      // #endregion
      markInventoryModified(fromTarget);
      markInventoryModified(toTarget);
      dirtyProducts.set(String(product._id), product);
      inventoryLines.push(
        makeInventoryLine({
          productId: item.productId,
          productName: product.name,
          variantId: item.variantId || '',
          branchId: operation.fromBranchId,
          inventoryType: operation.fromInventoryType || operation.operationArea || 'wholesale',
          delta: -qty,
          reason: item.reason || operation.reason || '',
          remark: item.remark || operation.remark || ''
        }),
        makeInventoryLine({
          productId: item.productId,
          productName: product.name,
          variantId: item.variantId || '',
          branchId: operation.toBranchId,
          inventoryType: operation.toInventoryType || operation.operationArea || 'wholesale',
          delta: qty,
          reason: item.reason || operation.reason || '',
          remark: item.remark || operation.remark || ''
        })
      );
    }
    acceptedCount += 1;
  }
  if (dirtyProducts.size > 0) {
    await Promise.all(Array.from(dirtyProducts.values()).map(product => product.save()));
  }
  operation.status = 'approved';
  operation.executedAt = new Date();
  await operation.save();
  await Audit.create({
    actor: actor?.name || 'unknown',
    actionType: `wholesale_${operation.operationType}_approved`,
    details: withInventoryAudit({
      productId: operation.productId,
      variantId: operation.variantId || '',
      qty: Number(operation.qty || 0),
      itemCount: items.length,
      acceptedCount,
      branchId: operation.branchId || '',
      fromBranchId: operation.fromBranchId || '',
      toBranchId: operation.toBranchId || '',
      fromInventoryType: operation.fromInventoryType || '',
      toInventoryType: operation.toInventoryType || ''
    }, inventoryLines),
    branchId: operation.branchId || operation.toBranchId || operation.fromBranchId || '',
    ts: new Date()
  });
}

async function applyCreditRepayment(repayment, actor) {
  const creditSale = await CreditSale.findById(repayment.creditSaleId);
  if (!creditSale) {
    const err = new Error('Credit sale not found');
    err.status = 400;
    throw err;
  }
  const amount = Math.max(0, Number(repayment.amount || 0));
  if (amount <= 0) {
    const err = new Error('Repayment amount must be greater than zero');
    err.status = 400;
    throw err;
  }
  const fresh = await refreshCreditSaleStatus(creditSale);
  const balance = Math.max(0, Number(fresh.balance || 0) + Number(fresh.accumulated_penalty || 0));
  if (amount > balance) {
    const err = new Error('Repayment amount exceeds outstanding balance');
    err.status = 400;
    throw err;
  }
  const appliedToPenalty = Math.min(Number(fresh.accumulated_penalty || 0), amount);
  const principalPayment = amount - appliedToPenalty;
  fresh.accumulated_penalty = Math.max(0, Number(fresh.accumulated_penalty || 0) - appliedToPenalty);
  fresh.amount_paid = Math.max(0, Number(fresh.amount_paid || 0) + principalPayment);
  fresh.payment_history.push({
    amount,
    paid_at: new Date(),
    approved_by: actor?.name || 'unknown',
    note: repayment.remark || ''
  });
  await refreshCreditSaleStatus(fresh);
  repayment.status = 'approved';
  repayment.approvedByName = actor?.name || 'unknown';
  repayment.approvedByRole = actor?.role || '';
  repayment.approvedAt = new Date();
  await repayment.save();
  await updateCustomerCreditMetrics(repayment.customerId);
  await Audit.create({
    actor: actor?.name || 'unknown',
    actionType: 'credit_repayment_approved',
    details: { creditSaleId: repayment.creditSaleId, amount },
    branchId: fresh.branchId || '',
    ts: new Date()
  });
}

async function applyCashReconciliation(reconciliation, actor) {
  if (!reconciliation) {
    const err = new Error('Cash reconciliation not found');
    err.status = 400;
    throw err;
  }
  if (reconciliation.executed || String(reconciliation.status || '').toLowerCase() === 'approved') return;
  const allocations = Array.isArray(reconciliation.allocations) ? reconciliation.allocations : [];
  if (allocations.length === 0) {
    const err = new Error('No reconciliation allocations found');
    err.status = 400;
    throw err;
  }
  const accountIds = Array.from(new Set(allocations.map((item) => String(item.accountId || '')).filter(Boolean)));
  const accounts = accountIds.length > 0 ? await ReconciliationAccount.find({ _id: { $in: accountIds } }) : [];
  const accountMap = new Map(accounts.map((account) => [String(account._id), account]));
  for (const allocation of allocations) {
    const account = accountMap.get(String(allocation.accountId || ''));
    if (!account) {
      const err = new Error('Selected reconciliation account not found');
      err.status = 400;
      throw err;
    }
    account.balance = Number(account.balance || 0) + Number(allocation.amount || 0);
    account.updatedByName = actor?.name || 'unknown';
    await account.save();
  }
  reconciliation.status = 'approved';
  reconciliation.executed = true;
  reconciliation.approvedAt = new Date();
  await reconciliation.save();
  await Audit.create({
    actor: actor?.name || 'unknown',
    actionType: 'cash_reconciliation_approved',
    details: {
      reconciliationId: String(reconciliation._id),
      branchId: reconciliation.branchId || '',
      depositedAmount: Number(reconciliation.depositedAmount || 0),
      selectedDates: reconciliation.selectedDates || [],
      allocationCount: allocations.length
    },
    branchId: reconciliation.branchId || '',
    ts: new Date()
  });
}

export async function executeApprovedReference(approval, actor) {
  if (!approval) return null;
  if (approval.referenceModel === 'WholesaleOperation') {
    const operation = await WholesaleOperation.findById(approval.referenceId);
    if (!operation) throw new Error('Wholesale operation not found');
    await applyWholesaleOperation(operation, actor);
  } else if (approval.referenceModel === 'CreditRepayment') {
    const repayment = await CreditRepayment.findById(approval.referenceId);
    if (!repayment) throw new Error('Credit repayment not found');
    await applyCreditRepayment(repayment, actor);
  } else if (approval.referenceModel === 'CashReconciliation') {
    const reconciliation = await CashReconciliation.findById(approval.referenceId);
    if (!reconciliation) throw new Error('Cash reconciliation not found');
    await applyCashReconciliation(reconciliation, actor);
  } else {
    throw new Error('Unsupported approval reference');
  }
  approval.status = 'approved';
  approval.executedAt = new Date();
  await approval.save();
  return approval;
}

export async function syncReferenceStatus(referenceModel, referenceId, status, extra = {}) {
  if (referenceModel === 'WholesaleOperation') {
    await WholesaleOperation.findByIdAndUpdate(referenceId, { status, ...extra });
  } else if (referenceModel === 'CreditRepayment') {
    await CreditRepayment.findByIdAndUpdate(referenceId, { status, ...extra });
  } else if (referenceModel === 'CashReconciliation') {
    const update = { status, ...extra };
    if (status === 'rejected' && !update.rejectedAt) update.rejectedAt = new Date();
    if (status === 'approved' && !update.approvedAt) update.approvedAt = new Date();
    await CashReconciliation.findByIdAndUpdate(referenceId, update);
  }
}

export async function createApprovalForReference({
  actionType,
  referenceModel,
  referenceId,
  initiatedByName,
  initiatedByRole
}) {
  const approval = await Approval.create({
    actionType,
    referenceModel,
    referenceId,
    initiatedByName: initiatedByName || '',
    initiatedByRole: initiatedByRole || '',
    status: 'pending_director'
  });
  await syncReferenceStatus(referenceModel, referenceId, 'pending_director', { approvalId: String(approval._id) });
  return approval;
}
