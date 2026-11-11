import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  approvalCreate: vi.fn(),
  approvalInsertOne: vi.fn(),
  wholesaleFindByIdAndUpdate: vi.fn(),
  creditRepaymentFindByIdAndUpdate: vi.fn(),
  cashReconciliationFindByIdAndUpdate: vi.fn(),
  fetch: vi.fn(() => Promise.reject(new Error('debug sink unavailable')))
}));

vi.mock('../../src/models/Audit.js', () => ({
  default: {},
  modelFor: vi.fn(() => ({}))
}));

vi.mock('../../src/models/Approval.js', () => ({
  default: {
    create: mocks.approvalCreate,
    collection: {
      insertOne: mocks.approvalInsertOne
    }
  },
  modelFor: vi.fn(() => ({
    create: mocks.approvalCreate,
    collection: {
      insertOne: mocks.approvalInsertOne
    }
  }))
}));

vi.mock('../../src/models/CashReconciliation.js', () => ({
  default: {
    findByIdAndUpdate: mocks.cashReconciliationFindByIdAndUpdate
  },
  modelFor: vi.fn(() => ({
    findByIdAndUpdate: mocks.cashReconciliationFindByIdAndUpdate
  }))
}));

vi.mock('../../src/models/CreditRepayment.js', () => ({
  default: {
    findByIdAndUpdate: mocks.creditRepaymentFindByIdAndUpdate
  },
  modelFor: vi.fn(() => ({
    findByIdAndUpdate: mocks.creditRepaymentFindByIdAndUpdate
  }))
}));

vi.mock('../../src/models/CreditSale.js', () => ({
  default: {},
  modelFor: vi.fn(() => ({}))
}));

vi.mock('../../src/models/Product.js', () => ({
  default: {},
  modelFor: vi.fn(() => ({}))
}));

vi.mock('../../src/models/ReconciliationAccount.js', () => ({
  default: {},
  modelFor: vi.fn(() => ({}))
}));

vi.mock('../../src/models/WholesaleOperation.js', () => ({
  default: {
    findByIdAndUpdate: mocks.wholesaleFindByIdAndUpdate
  },
  modelFor: vi.fn(() => ({
    findByIdAndUpdate: mocks.wholesaleFindByIdAndUpdate
  }))
}));

vi.mock('../../src/utils/inventory.js', () => ({
  getMapQty: vi.fn(),
  getStockTarget: vi.fn(),
  markInventoryModified: vi.fn(),
  setMapQty: vi.fn()
}));

vi.mock('../../src/utils/inventoryAudit.js', () => ({
  makeInventoryLine: vi.fn(),
  withInventoryAudit: vi.fn(async (callback) => callback())
}));

vi.mock('../../src/utils/credit.js', () => ({
  refreshCreditSaleStatus: vi.fn(),
  updateCustomerCreditMetrics: vi.fn(),
  evaluateCustomerCreditSale: vi.fn(() => ({ ok: true }))
}));

vi.mock('../../src/utils/productUnits.js', () => ({
  adjustSerializedUnits: vi.fn(),
  normalizeTrackType: vi.fn((value) => String(value || '').toLowerCase() === 'serialized' ? 'serialized' : 'quantity'),
  transferSerializedUnits: vi.fn(),
  getQuantityOwnedStock: vi.fn(async () => ({ mapQty: 0, occupyingUnits: 0, ownedQty: 0, target: null }))
}));

vi.mock('../../src/utils/inTransitLocks.js', () => ({
  assertOutgoingAvailability: vi.fn()
}));

const approvalWorkflow = await import('../../src/utils/approvalWorkflow.js');

describe('approvalWorkflow characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.approvalCreate.mockResolvedValue({ _id: 'approval-1', status: 'pending_director' });
    mocks.creditRepaymentFindByIdAndUpdate.mockResolvedValue({ ok: true });
    mocks.cashReconciliationFindByIdAndUpdate.mockResolvedValue({ ok: true });
    mocks.wholesaleFindByIdAndUpdate.mockResolvedValue({ ok: true });
  });

  it('treats grant-based and role-based director approval as currently allowed', () => {
    expect(approvalWorkflow.canApproveDirector({ role: 'Director' })).toBe(true);
    expect(approvalWorkflow.canApproveDirector({ role: 'Cashier', grants: ['approve_credit_director'] })).toBe(true);
    expect(approvalWorkflow.canApproveDirector({ role: 'Cashier', grants: [] })).toBe(false);
  });

  it('does not let manager-only transfer grants approve the director step', () => {
    const managerOnly = { role: 'Cashier', grants: ['approve_transfers', 'approve_retail_manager', 'approve_distribution_manager'] };
    const operation = {
      operationType: 'transfer',
      operationArea: 'wholesale',
      fromInventoryType: 'wholesale',
      toInventoryType: 'retail'
    };

    expect(approvalWorkflow.canApproveWholesaleOperationDirector(managerOnly, operation)).toBe(false);
    expect(approvalWorkflow.canApproveWholesaleOperationManager(managerOnly, operation)).toBe(true);
    expect(approvalWorkflow.canApproveAreaDirector(managerOnly, 'retail')).toBe(false);
    expect(approvalWorkflow.canApproveAreaDirector(managerOnly, 'wholesale')).toBe(false);
  });

  it('allows director-step approval only with an explicit director grant or director-class role', () => {
    const directorGrant = { role: 'Cashier', grants: ['approve_distribution_director'] };
    const directorRole = { role: 'Director', grants: [] };
    const operation = {
      operationType: 'transfer',
      operationArea: 'wholesale',
      fromInventoryType: 'wholesale',
      toInventoryType: 'retail'
    };

    expect(approvalWorkflow.canApproveWholesaleOperationDirector(directorGrant, operation)).toBe(true);
    expect(approvalWorkflow.canApproveWholesaleOperationDirector(directorRole, operation)).toBe(true);
  });

  it('blocks the same non-admin user from completing both director and manager stages', () => {
    const ruby = { name: 'RUBY ATUTORNU', role: 'Cashier', grants: ['approve_distribution_manager'] };
    expect(approvalWorkflow.canCompleteManagerStageAsActor(ruby, 'RUBY ATUTORNU')).toBe(false);
    expect(approvalWorkflow.canCompleteManagerStageAsActor(ruby, 'Director User')).toBe(true);
    expect(approvalWorkflow.canCompleteManagerStageAsActor({ name: 'Admin User', role: 'Admin' }, 'Admin User')).toBe(true);
  });

  it('syncs reference status updates to credit repayments', async () => {
    await approvalWorkflow.syncReferenceStatus('CreditRepayment', 'repayment-1', 'pending_director', { approvalId: 'approval-1' });

    expect(mocks.creditRepaymentFindByIdAndUpdate).toHaveBeenCalledWith('repayment-1', {
      status: 'pending_director',
      approvalId: 'approval-1'
    });
  });

  it('adds rejectedAt automatically when cash reconciliations are rejected', async () => {
    await approvalWorkflow.syncReferenceStatus('CashReconciliation', 'recon-1', 'rejected', {});

    expect(mocks.cashReconciliationFindByIdAndUpdate).toHaveBeenCalledWith(
      'recon-1',
      expect.objectContaining({
        status: 'rejected',
        rejectedAt: expect.any(Date)
      })
    );
  });

  it('creates approvals with pending_director status and immediately syncs the reference model even if debug telemetry fails', async () => {
    const result = await approvalWorkflow.createApprovalForReference({
      actionType: 'credit_repayment',
      referenceModel: 'CreditRepayment',
      referenceId: 'repayment-1',
      initiatedByName: 'Alice',
      initiatedByRole: 'Cashier'
    });

    expect(result).toMatchObject({ _id: 'approval-1', status: 'pending_director' });
    expect(mocks.approvalCreate).toHaveBeenCalledWith({
      actionType: 'credit_repayment',
      referenceModel: 'CreditRepayment',
      referenceId: 'repayment-1',
      initiatedByName: 'Alice',
      initiatedByRole: 'Cashier',
      status: 'pending_director'
    });
    expect(mocks.creditRepaymentFindByIdAndUpdate).toHaveBeenCalledWith('repayment-1', {
      status: 'pending_director',
      approvalId: 'approval-1'
    });
  });
});
