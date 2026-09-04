import Audit, { modelFor as AuditModelFor } from '../models/Audit.js';
import fs from 'node:fs';
import path from 'node:path';
import Approval, { modelFor as ApprovalModelFor } from '../models/Approval.js';
import CashReconciliation, { modelFor as CashReconciliationModelFor } from '../models/CashReconciliation.js';
import CreditRepayment, { modelFor as CreditRepaymentModelFor } from '../models/CreditRepayment.js';
import CreditSale, { modelFor as CreditSaleModelFor } from '../models/CreditSale.js';
import Product, { modelFor as ProductModelFor } from '../models/Product.js';
import ReconciliationAccount, { modelFor as ReconciliationAccountModelFor } from '../models/ReconciliationAccount.js';
import WholesaleOperation, { modelFor as WholesaleOperationModelFor } from '../models/WholesaleOperation.js';
import mongoose from 'mongoose';
import { getMapQty, getStockTarget, markInventoryModified, setMapQty } from './inventory.js';
import { makeInventoryLine, withInventoryAudit } from './inventoryAudit.js';
import { refreshCreditSaleStatus, updateCustomerCreditMetrics } from './credit.js';
import { adjustSerializedUnits, normalizeTrackType, transferSerializedUnits } from './productUnits.js';
import { assertOutgoingAvailability } from './inTransitLocks.js';

function productQuery(productId) {
  const pid = String(productId || '');
  const or = [{ id: pid }];
  if (mongoose.isValidObjectId(pid)) or.unshift({ _id: pid });
  return { $or: or };
}

function reportInTransitStockLockDebug({ hypothesisId = 'A', location = '', msg = '', data = {} } = {}) {
  const envCandidates = [
    path.resolve(process.cwd(), '.dbg', 'in-transit-stock-lock.env'),
    path.resolve(process.cwd(), '..', '.dbg', 'in-transit-stock-lock.env')
  ];
  let url = 'http://127.0.0.1:7777/event';
  let sessionId = 'in-transit-stock-lock';
  for (const candidate of envCandidates) {
    try {
      const text = fs.readFileSync(candidate, 'utf8');
      url = text.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || url;
      sessionId = text.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || sessionId;
      break;
    } catch {}
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, runId: 'pre-fix', hypothesisId, location, msg, data, ts: Date.now() })
  }).catch(() => {});
}

function resolveWorkflowModels(db = null) {
  return {
    Audit: db ? AuditModelFor(db) : Audit,
    Approval: db ? ApprovalModelFor(db) : Approval,
    CashReconciliation: db ? CashReconciliationModelFor(db) : CashReconciliation,
    CreditRepayment: db ? CreditRepaymentModelFor(db) : CreditRepayment,
    CreditSale: db ? CreditSaleModelFor(db) : CreditSale,
    Product: db ? ProductModelFor(db) : Product,
    ReconciliationAccount: db ? ReconciliationAccountModelFor(db) : ReconciliationAccount,
    WholesaleOperation: db ? WholesaleOperationModelFor(db) : WholesaleOperation
  };
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
  if (String(area || '').toLowerCase() === 'retail') return grants.includes('approve_retail_director') || grants.includes('approve_transfers');
  if (String(area || '').toLowerCase() === 'warehouse') return grants.includes('approve_warehouse_director');
  return grants.includes('approve_distribution_director');
}

export function canApproveAreaManager(user, area = 'wholesale') {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  if (['manager', 'admin', 'superadmin'].includes(role)) return true;
  if (String(area || '').toLowerCase() === 'retail') return grants.includes('approve_retail_manager') || grants.includes('approve_transfers');
  if (String(area || '').toLowerCase() === 'warehouse') return grants.includes('approve_warehouse_manager');
  return grants.includes('approve_distribution_manager');
}

function normalizeApprovalInventoryArea(value = '') {
  const raw = String(value || '').toLowerCase();
  if (raw === 'warehouse') return 'warehouse';
  if (raw === 'retail') return 'retail';
  return 'wholesale';
}

export function canApproveWholesaleOperationDirector(user, operation = null) {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  if (['admin', 'superadmin', 'director'].includes(role)) return true;
  if (!operation || String(operation?.operationType || '').toLowerCase() !== 'transfer') {
    return canApproveAreaDirector(user, normalizeApprovalInventoryArea(operation?.operationArea || 'wholesale'));
  }
  if (grants.includes('approve_transfers')) return true;
  const candidateAreas = new Set([
    normalizeApprovalInventoryArea(operation?.operationArea || 'wholesale'),
    normalizeApprovalInventoryArea(operation?.fromInventoryType || operation?.operationArea || 'wholesale'),
    normalizeApprovalInventoryArea(operation?.toInventoryType || operation?.operationArea || 'wholesale')
  ]);
  return Array.from(candidateAreas).some((area) => canApproveAreaDirector(user, area));
}

export function canApproveWholesaleOperationManager(user, operation = null) {
  const role = String(user?.role || '').toLowerCase();
  const grants = Array.isArray(user?.grants) ? user.grants : [];
  if (['manager', 'admin', 'superadmin'].includes(role)) return true;
  if (!operation || String(operation?.operationType || '').toLowerCase() !== 'transfer') {
    return canApproveAreaManager(user, normalizeApprovalInventoryArea(operation?.operationArea || 'wholesale'));
  }
  if (grants.includes('approve_transfers')) return true;
  const candidateAreas = new Set([
    normalizeApprovalInventoryArea(operation?.operationArea || 'wholesale'),
    normalizeApprovalInventoryArea(operation?.fromInventoryType || operation?.operationArea || 'wholesale'),
    normalizeApprovalInventoryArea(operation?.toInventoryType || operation?.operationArea || 'wholesale')
  ]);
  return Array.from(candidateAreas).some((area) => canApproveAreaManager(user, area));
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
          await assertOutgoingAvailability({
            product,
            productId: String(item.productId || ''),
            variantId: String(item.variantId || ''),
            branchId: String(operation.branchId || operation.fromBranchId || ''),
            inventoryType: String(operation.fromInventoryType || 'wholesale'),
            qty,
            unitIds: item.unitIds,
            excludeWholesaleOperationId: String(operation?._id || ''),
            purpose: 'transfer'
          });
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
      if (String(item.adjustmentType || operation.adjustmentType || 'increase') === 'decrease') {
        await assertOutgoingAvailability({
          product,
          productId: String(item.productId || ''),
          variantId: String(item.variantId || ''),
          branchId: String(branchId || ''),
          inventoryType: String(operation.fromInventoryType || 'wholesale'),
          qty,
          excludeWholesaleOperationId: String(operation?._id || ''),
          purpose: 'transfer'
        });
      }
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
        try {
          await assertOutgoingAvailability({
            product,
            productId: String(item.productId || ''),
            variantId: String(item.variantId || ''),
            branchId: String(operation.fromBranchId || ''),
            inventoryType: String(operation.fromInventoryType || 'wholesale'),
            qty,
            unitIds: item.unitIds,
            excludeWholesaleOperationId: String(operation?._id || ''),
            purpose: 'transfer'
          });
          await transferSerializedUnits({
            productId: item.productId,
            variantId: item.variantId || '',
            fromBranchId: operation.fromBranchId,
            toBranchId: operation.toBranchId,
            fromInventoryType: operation.fromInventoryType || 'wholesale',
            toInventoryType: operation.toInventoryType || 'wholesale',
            unitIds: item.unitIds
          });
        } catch (error) {
          // #region debug-point B:workflow-transfer-serialized-failed
          reportInTransitStockLockDebug({
            hypothesisId: 'B',
            location: 'approvalWorkflow.js:transfer-serialized-failed',
            msg: '[DEBUG] Workflow serialized transfer approval failed availability check',
            data: {
              operationId: String(operation?._id || operation?.clientId || ''),
              fromBranchId: String(operation?.fromBranchId || ''),
              toBranchId: String(operation?.toBranchId || ''),
              fromInventoryType: String(operation?.fromInventoryType || ''),
              toInventoryType: String(operation?.toInventoryType || ''),
              productId: String(item?.productId || ''),
              variantId: String(item?.variantId || ''),
              qty,
              unitIds: Array.isArray(item?.unitIds) ? item.unitIds.map(String) : [],
              error: String(error?.message || error || '')
            }
          });
          // #endregion
          throw error;
        }
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
      await assertOutgoingAvailability({
        product,
        productId: String(item.productId || ''),
        variantId: String(item.variantId || ''),
        branchId: String(operation.fromBranchId || ''),
        inventoryType: String(operation.fromInventoryType || 'wholesale'),
        qty,
        excludeWholesaleOperationId: String(operation?._id || ''),
        purpose: 'transfer'
      });
      // #region debug-point D:workflow-transfer-stock-check
      reportInTransitStockLockDebug({
        hypothesisId: 'D',
        location: 'approvalWorkflow.js:transfer-stock-check',
        msg: '[DEBUG] Workflow quantity transfer approval checked source stock',
        data: {
          operationId: String(operation?._id || operation?.clientId || ''),
          fromBranchId: String(operation?.fromBranchId || ''),
          toBranchId: String(operation?.toBranchId || ''),
          fromInventoryType: String(operation?.fromInventoryType || ''),
          toInventoryType: String(operation?.toInventoryType || ''),
          productId: String(item?.productId || ''),
          variantId: String(item?.variantId || ''),
          qty,
          fromCurrent
        }
      });
      // #endregion
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
  const repaymentId = String(repayment?._id || '');
  const currentRepayment = repaymentId ? await CreditRepayment.findById(repaymentId) : repayment;
  if (!currentRepayment) return repayment;
  if (currentRepayment?.appliedAt || String(currentRepayment?.status || '').toLowerCase() === 'approved') {
    return currentRepayment;
  }
  const creditSale = await CreditSale.findById(currentRepayment.creditSaleId);
  if (!creditSale) {
    const err = new Error('Credit sale not found');
    err.status = 400;
    throw err;
  }
  const existingHistory = (Array.isArray(creditSale.payment_history) ? creditSale.payment_history : []).find((entry) => String(entry?.repaymentId || '') === repaymentId);
  if (existingHistory) {
    currentRepayment.status = 'approved';
    currentRepayment.approvedByName = currentRepayment.approvedByName || actor?.name || 'unknown';
    currentRepayment.approvedByRole = currentRepayment.approvedByRole || actor?.role || '';
    currentRepayment.approvedAt = currentRepayment.approvedAt || new Date(existingHistory.paid_at || Date.now());
    currentRepayment.appliedAt = currentRepayment.appliedAt || new Date(existingHistory.paid_at || Date.now());
    currentRepayment.appliedAmount = Math.max(0, Number(currentRepayment.appliedAmount || currentRepayment.amount || 0));
    await currentRepayment.save();
    return currentRepayment;
  }
  const amount = Math.max(0, Number(currentRepayment.amount || 0));
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
  const packageDaysMatch = String(fresh.creditPackageName || '').match(/(\d+)\s*day/i);
  const packageDays = packageDaysMatch ? Math.max(0, Number(packageDaysMatch[1] || 0)) : 0;
  const appliedToPenalty = Math.min(Number(fresh.accumulated_penalty || 0), amount);
  const principalPayment = amount - appliedToPenalty;
  fresh.accumulated_penalty = Math.max(0, Number(fresh.accumulated_penalty || 0) - appliedToPenalty);
  fresh.amount_paid = Math.max(0, Number(fresh.amount_paid || 0) + principalPayment);
  if (packageDays > 0) {
    const currentDueDate = fresh.due_date ? new Date(fresh.due_date) : null;
    const today = new Date();
    const baseDueDate = currentDueDate instanceof Date && !Number.isNaN(currentDueDate.getTime()) && currentDueDate.getTime() > today.getTime()
      ? currentDueDate
      : today;
    if (baseDueDate instanceof Date && !Number.isNaN(baseDueDate.getTime())) {
      const nextDueDate = new Date(baseDueDate);
      nextDueDate.setDate(nextDueDate.getDate() + packageDays);
      fresh.due_date = nextDueDate;
    }
  }
  fresh.payment_history.push({
    repaymentId,
    amount,
    paid_at: new Date(),
    approved_by: actor?.name || 'unknown',
    note: currentRepayment.remark || ''
  });
  await refreshCreditSaleStatus(fresh);
  currentRepayment.status = 'approved';
  currentRepayment.approvedByName = actor?.name || 'unknown';
  currentRepayment.approvedByRole = actor?.role || '';
  currentRepayment.approvedAt = new Date();
  currentRepayment.appliedAt = new Date();
  currentRepayment.appliedAmount = amount;
  currentRepayment.daysAdded = packageDays;
  await currentRepayment.save();
  await updateCustomerCreditMetrics(currentRepayment.customerId);
  await Audit.create({
    actor: actor?.name || 'unknown',
    actionType: 'credit_repayment_approved',
    details: { creditSaleId: currentRepayment.creditSaleId, repaymentId, amount, daysAdded: packageDays },
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
  const approvedAt = new Date();
  // Avoid re-validating historical payment breakdown rows when approval only needs to mark execution state.
  await reconciliation.constructor.updateOne(
    { _id: reconciliation._id },
    {
      $set: {
        status: 'approved',
        executed: true,
        approvedAt
      }
    }
  );
  reconciliation.status = 'approved';
  reconciliation.executed = true;
  reconciliation.approvedAt = approvedAt;
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
  const { db = null, ...updateExtra } = extra || {};
  const { WholesaleOperation, CreditRepayment, CashReconciliation } = resolveWorkflowModels(db);
  if (referenceModel === 'WholesaleOperation') {
    await WholesaleOperation.findByIdAndUpdate(referenceId, { status, ...updateExtra });
  } else if (referenceModel === 'CreditRepayment') {
    await CreditRepayment.findByIdAndUpdate(referenceId, { status, ...updateExtra });
  } else if (referenceModel === 'CashReconciliation') {
    const update = { status, ...updateExtra };
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
  initiatedByRole,
  db = null
}) {
  const { Approval } = resolveWorkflowModels(db);
  // #region debug-point A:approval-create-start
  fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'A', location: 'approvalWorkflow.js:createApprovalForReference:start', msg: '[DEBUG] Approval creation started for reference', data: { actionType: String(actionType || ''), referenceModel: String(referenceModel || ''), referenceId: String(referenceId || '') }, ts: Date.now() }) }).catch(() => {});
  // #endregion
  let approval;
  if (db) {
    const approvalId = new mongoose.Types.ObjectId();
    const now = new Date();
    await Approval.collection.insertOne({
      _id: approvalId,
      actionType,
      referenceModel,
      referenceId,
      initiatedByName: initiatedByName || '',
      initiatedByRole: initiatedByRole || '',
      directorApprovedByName: '',
      directorApprovedByRole: '',
      directorRemark: '',
      managerApprovedByName: '',
      managerApprovedByRole: '',
      managerRemark: '',
      rejectedByName: '',
      rejectedByRole: '',
      rejectionReason: '',
      status: 'pending_director',
      createdAt: now,
      updatedAt: now
    });
    approval = { _id: approvalId, actionType, referenceModel, referenceId, initiatedByName: initiatedByName || '', initiatedByRole: initiatedByRole || '', status: 'pending_director' };
  } else {
    approval = await Approval.create({
      actionType,
      referenceModel,
      referenceId,
      initiatedByName: initiatedByName || '',
      initiatedByRole: initiatedByRole || '',
      status: 'pending_director'
    });
  }
  // #region debug-point A:approval-create-done
  fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'A', location: 'approvalWorkflow.js:createApprovalForReference:created', msg: '[DEBUG] Approval document created for reference', data: { actionType: String(actionType || ''), referenceModel: String(referenceModel || ''), referenceId: String(referenceId || ''), approvalId: String(approval?._id || '') }, ts: Date.now() }) }).catch(() => {});
  // #endregion
  await syncReferenceStatus(referenceModel, referenceId, 'pending_director', { approvalId: String(approval._id), db });
  // #region debug-point A:approval-sync-done
  fetch('http://127.0.0.1:7777/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'reconciliation-transfer-bugs', runId: 'pre-fix', hypothesisId: 'A', location: 'approvalWorkflow.js:createApprovalForReference:sync-done', msg: '[DEBUG] Approval reference status sync completed', data: { actionType: String(actionType || ''), referenceModel: String(referenceModel || ''), referenceId: String(referenceId || ''), approvalId: String(approval?._id || '') }, ts: Date.now() }) }).catch(() => {});
  // #endregion
  return approval;
}
