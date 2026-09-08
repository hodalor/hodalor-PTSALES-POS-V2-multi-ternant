import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  approvalFind: vi.fn(),
  approvalFindById: vi.fn(),
  wholesaleFind: vi.fn(),
  wholesaleFindById: vi.fn(),
  cashReconciliationFindById: vi.fn(),
  creditRepaymentFindById: vi.fn(),
  creditSaleFindById: vi.fn(),
  syncReferenceStatus: vi.fn(),
  executeApprovedReference: vi.fn(),
  canApproveAreaDirector: vi.fn(() => true),
  canApproveAreaManager: vi.fn(() => true),
  canApproveDirector: vi.fn(() => true),
  canApproveManager: vi.fn(() => true),
  canApproveWholesaleOperationDirector: vi.fn(() => true),
  canApproveWholesaleOperationManager: vi.fn(() => true),
  safeErrorMessage: vi.fn((error, fallback) => error?.message || fallback),
  safeErrorStatus: vi.fn((error, fallback = 500) => error?.status || fallback),
  fetch: vi.fn(() => Promise.reject(new Error('debug sink unavailable')))
}));

vi.mock('../../src/models/Approval.js', () => ({
  default: {
    find: mocks.approvalFind,
    findById: mocks.approvalFindById
  }
}));

vi.mock('../../src/models/CashReconciliation.js', () => ({
  default: {
    findById: mocks.cashReconciliationFindById
  }
}));

vi.mock('../../src/models/CreditRepayment.js', () => ({
  default: {
    findById: mocks.creditRepaymentFindById
  }
}));

vi.mock('../../src/models/CreditSale.js', () => ({
  default: {
    findById: mocks.creditSaleFindById
  }
}));

vi.mock('../../src/models/WholesaleOperation.js', () => ({
  default: {
    find: mocks.wholesaleFind,
    findById: mocks.wholesaleFindById
  }
}));

vi.mock('../../src/utils/approvalWorkflow.js', () => ({
  canApproveAreaDirector: mocks.canApproveAreaDirector,
  canApproveAreaManager: mocks.canApproveAreaManager,
  canApproveDirector: mocks.canApproveDirector,
  canApproveManager: mocks.canApproveManager,
  canApproveWholesaleOperationDirector: mocks.canApproveWholesaleOperationDirector,
  canApproveWholesaleOperationManager: mocks.canApproveWholesaleOperationManager,
  executeApprovedReference: mocks.executeApprovedReference,
  syncReferenceStatus: mocks.syncReferenceStatus
}));

vi.mock('../../src/utils/safeError.js', () => ({
  safeErrorMessage: mocks.safeErrorMessage,
  safeErrorStatus: mocks.safeErrorStatus
}));

const { default: router } = await import('../../src/routes/approvals.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'phase3-approvals-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    name: 'Director User',
    role: 'Director',
    tenantId: 'master',
    branchId: 'main',
    assignedBranches: ['main'],
    grants: ['approve_transfers'],
    ...overrides
  }, secret);
  return { Authorization: `Bearer ${token}` };
}

describe('approvals route characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('lists visible approvals even if debug telemetry fails', async () => {
    mocks.approvalFind.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { _id: 'approval-1', referenceModel: 'WholesaleOperation', referenceId: 'op-1', status: 'pending_director', actionType: 'wholesale_transfer' }
          ])
        })
      })
    });
    mocks.wholesaleFind.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          { _id: 'op-1', operationType: 'transfer', fromBranchId: 'main', toBranchId: 'branch-2', items: [], operationArea: 'wholesale' }
        ])
      })
    });
    mocks.wholesaleFindById.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ fromBranchId: 'main', toBranchId: 'branch-2', branchId: '' })
      })
    });

    const response = await request(createApp())
      .get('/')
      .set(authHeader())
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      _id: 'approval-1',
      referenceModel: 'WholesaleOperation',
      referenceId: 'op-1',
      operationType: 'transfer'
    });
  });
});
