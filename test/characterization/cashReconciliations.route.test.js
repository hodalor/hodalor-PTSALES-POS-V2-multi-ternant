import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  saleAggregate: vi.fn(),
  cashReconciliationAggregate: vi.fn(),
  cashReconciliationFindById: vi.fn(),
  cashReconciliationUpdateOne: vi.fn(),
  cashReconciliationInsertOne: vi.fn(),
  accountFind: vi.fn(),
  branchFind: vi.fn(),
  auditCreate: vi.fn().mockResolvedValue({}),
  createApprovalForReference: vi.fn(),
  uploadMediaString: vi.fn(async (value) => value),
  listRecognizedSalesTotalsByDay: vi.fn(),
  canAccessAccount: vi.fn(() => true),
  resolveAllowedBranchIds: vi.fn(async () => ['main']),
  getMasterConnection: vi.fn(),
  tenantFindOne: vi.fn(),
  fetch: vi.fn(() => Promise.reject(new Error('debug sink unavailable')))
}));

vi.mock('../../src/models/Sale.js', () => ({
  default: {
    aggregate: mocks.saleAggregate,
    findOne: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(null)
        })
      })
    })
  }
}));

vi.mock('../../src/models/CashReconciliation.js', () => ({
  modelFor: vi.fn(() => ({
    aggregate: mocks.cashReconciliationAggregate,
    findById: mocks.cashReconciliationFindById,
    updateOne: mocks.cashReconciliationUpdateOne,
    collection: {
      insertOne: mocks.cashReconciliationInsertOne
    }
  })),
  default: {
    aggregate: mocks.cashReconciliationAggregate
  }
}));

vi.mock('../../src/models/ReconciliationAccount.js', () => ({
  modelFor: vi.fn(() => ({
    find: mocks.accountFind
  }))
}));

vi.mock('../../src/models/Branch.js', () => ({
  modelFor: vi.fn(() => ({
    find: mocks.branchFind
  })),
  default: {
    find: mocks.branchFind
  }
}));

vi.mock('../../src/models/Audit.js', () => ({
  modelFor: vi.fn(() => ({
    create: mocks.auditCreate
  }))
}));

vi.mock('../../src/config/tenancy.js', () => ({
  getMasterConnection: mocks.getMasterConnection
}));

vi.mock('../../src/models/Tenant.js', () => ({
  modelFor: vi.fn(() => ({
    findOne: mocks.tenantFindOne
  }))
}));

vi.mock('../../src/utils/approvalWorkflow.js', () => ({
  createApprovalForReference: mocks.createApprovalForReference
}));

vi.mock('../../src/utils/mediaStorage.js', () => ({
  uploadMediaString: mocks.uploadMediaString
}));

vi.mock('../../src/utils/saleAccounting.js', () => ({
  listRecognizedSalesTotalsByDay: mocks.listRecognizedSalesTotalsByDay
}));

vi.mock('../../src/routes/reconciliationAccounts.js', () => ({
  canAccessAccount: mocks.canAccessAccount,
  resolveAllowedBranchIds: mocks.resolveAllowedBranchIds
}));

const { default: router } = await import('../../src/routes/cashReconciliations.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'phase3-recon-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    name: 'Cashier User',
    role: 'Cashier',
    tenantId: 'master',
    branchId: 'main',
    assignedBranches: ['main'],
    grants: ['add_finance_reconciliation'],
    ...overrides
  }, secret);
  return { Authorization: `Bearer ${token}` };
}

describe('cash reconciliations route characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.listRecognizedSalesTotalsByDay.mockResolvedValue(new Map([
      ['main:2026-09-08', {
        branchId: 'main',
        date: '2026-09-08',
        total: 100,
        paymentBreakdown: { cash: 100 }
      }]
    ]));
    mocks.cashReconciliationAggregate.mockResolvedValue([]);
    mocks.accountFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: 'acct-1', name: 'Main Bank', branchIds: ['main'], active: true }])
    });
    mocks.branchFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ _id: 'main', id: 'main', name: 'Main Branch' }])
    });
    mocks.createApprovalForReference.mockResolvedValue({ _id: 'approval-1', status: 'pending_director' });
    mocks.cashReconciliationFindById.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: 'recon-1',
        branchId: 'main',
        approvalId: 'approval-1',
        status: 'pending_director'
      })
    });
  });

  it('creates a reconciliation even if debug telemetry fails', async () => {
    const response = await request(createApp())
      .post('/')
      .set(authHeader())
      .send({
        branchId: 'main',
        selectedDates: ['2026-09-08'],
        allocations: [{
          accountId: 'acct-1',
          amount: 100,
          paymentMethod: 'cash',
          proofImage: 'data:image/png;base64,abc'
        }]
      })
      .expect(201);

    expect(mocks.cashReconciliationInsertOne).toHaveBeenCalled();
    expect(response.body).toEqual({
      _id: 'recon-1',
      branchId: 'main',
      approvalId: 'approval-1',
      status: 'pending_director'
    });
  });
});
