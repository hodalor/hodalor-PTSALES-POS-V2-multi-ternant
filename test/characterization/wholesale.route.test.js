import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  wholesaleFind: vi.fn(),
  wholesaleCountDocuments: vi.fn(),
  wholesaleCreate: vi.fn(),
  approvalFind: vi.fn(),
  createApprovalForReference: vi.fn(),
  fetch: vi.fn(() => Promise.reject(new Error('debug sink unavailable')))
}));

vi.mock('../../src/models/WholesaleOperation.js', () => ({
  default: {
    find: mocks.wholesaleFind,
    countDocuments: mocks.wholesaleCountDocuments,
    create: mocks.wholesaleCreate
  }
}));

vi.mock('../../src/models/Approval.js', () => ({
  default: {
    find: mocks.approvalFind
  }
}));

vi.mock('../../src/utils/approvalWorkflow.js', () => ({
  createApprovalForReference: mocks.createApprovalForReference
}));

vi.mock('../../src/utils/superBin.js', () => ({
  archiveLiveDocument: vi.fn()
}));

const { default: router } = await import('../../src/routes/wholesale.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'phase3-wholesale-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    name: 'Admin User',
    role: 'Admin',
    tenantId: 'master',
    branchId: 'main',
    assignedBranches: 'all',
    grants: [],
    ...overrides
  }, secret);
  return { Authorization: `Bearer ${token}` };
}

describe('wholesale route characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.wholesaleCountDocuments.mockResolvedValue(1);
    mocks.approvalFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([])
    });
  });

  it('lists wholesale operations even if debug telemetry fails', async () => {
    mocks.wholesaleFind.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue([
              { _id: 'op-1', operationType: 'transfer', fromBranchId: 'main', toBranchId: 'branch-2', items: [] }
            ])
          })
        })
      })
    });

    const response = await request(createApp())
      .get('/operations')
      .set(authHeader())
      .expect(200);

    expect(response.body).toEqual([
      { _id: 'op-1', operationType: 'transfer', fromBranchId: 'main', toBranchId: 'branch-2', items: [] }
    ]);
  });

  it('creates a wholesale operation and approval even if debug telemetry fails', async () => {
    mocks.wholesaleCreate.mockResolvedValue({
      _id: 'op-2',
      operationType: 'transfer',
      items: [{ productId: 'p1', qty: 2 }],
      toObject: () => ({
        _id: 'op-2',
        operationType: 'transfer',
        items: [{ productId: 'p1', qty: 2 }],
        status: 'pending_director'
      })
    });
    mocks.createApprovalForReference.mockResolvedValue({
      _id: 'approval-1',
      status: 'pending_director'
    });

    const response = await request(createApp())
      .post('/operations')
      .set(authHeader({
        role: 'Manager',
        grants: ['add_wholesale_transfers']
      }))
      .send({
        operationType: 'transfer',
        operationArea: 'wholesale',
        fromBranchId: 'main',
        toBranchId: 'branch-2',
        items: [{ productId: 'p1', qty: 2 }]
      })
      .expect(200);

    expect(mocks.createApprovalForReference).toHaveBeenCalled();
    expect(response.body).toEqual({
      operation: {
        _id: 'op-2',
        operationType: 'transfer',
        items: [{ productId: 'p1', qty: 2 }],
        status: 'pending_director',
        approvalId: 'approval-1',
        approvalMode: 'workflow'
      },
      approval: {
        _id: 'approval-1',
        status: 'pending_director'
      }
    });
  });

  it('creates warehouse refund operations when the user has warehouse refund grants', async () => {
    mocks.wholesaleCreate.mockResolvedValue({
      _id: 'op-warehouse-refund-1',
      operationType: 'refund',
      operationArea: 'warehouse',
      requestedAmount: 180,
      items: [{ productId: 'p1', qty: 1 }],
      toObject: () => ({
        _id: 'op-warehouse-refund-1',
        operationType: 'refund',
        operationArea: 'warehouse',
        requestedAmount: 180,
        items: [{ productId: 'p1', qty: 1 }],
        status: 'pending_director'
      })
    });
    mocks.createApprovalForReference.mockResolvedValue({
      _id: 'approval-warehouse-refund-1',
      status: 'pending_director'
    });

    const response = await request(createApp())
      .post('/operations')
      .set(authHeader({
        role: 'Cashier',
        grants: ['add_warehouse_refunds']
      }))
      .send({
        operationType: 'refund',
        operationArea: 'warehouse',
        branchId: 'warehouse-main',
        requestedAmount: 180,
        items: [{ productId: 'p1', qty: 1 }]
      })
      .expect(200);

    expect(mocks.wholesaleCreate).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'refund',
      operationArea: 'warehouse',
      branchId: 'warehouse-main',
      requestedAmount: 180
    }));
    expect(response.body).toEqual({
      operation: {
        _id: 'op-warehouse-refund-1',
        operationType: 'refund',
        operationArea: 'warehouse',
        requestedAmount: 180,
        items: [{ productId: 'p1', qty: 1 }],
        status: 'pending_director',
        approvalId: 'approval-warehouse-refund-1',
        approvalMode: 'workflow'
      },
      approval: {
        _id: 'approval-warehouse-refund-1',
        status: 'pending_director'
      }
    });
  });
});
