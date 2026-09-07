import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  creditRepaymentFind: vi.fn(),
  creditRepaymentFindOne: vi.fn(),
  creditRepaymentCreate: vi.fn(),
  creditRepaymentFindById: vi.fn(),
  creditSaleFind: vi.fn(),
  creditSaleFindById: vi.fn(),
  customerFind: vi.fn(),
  saleFind: vi.fn(),
  approvalFindById: vi.fn(),
  approvalFind: vi.fn(),
  createApprovalForReference: vi.fn(),
  refreshCreditSaleStatus: vi.fn(async () => {}),
  updateCustomerCreditMetrics: vi.fn(),
  archiveLiveDocument: vi.fn().mockResolvedValue({}),
  fetch: vi.fn(() => Promise.resolve({ ok: true }))
}));

vi.mock('../../src/models/CreditRepayment.js', () => ({
  default: {
    find: mocks.creditRepaymentFind,
    findOne: mocks.creditRepaymentFindOne,
    create: mocks.creditRepaymentCreate,
    findById: mocks.creditRepaymentFindById
  }
}));

vi.mock('../../src/models/CreditSale.js', () => ({
  default: {
    find: mocks.creditSaleFind,
    findById: mocks.creditSaleFindById
  }
}));

vi.mock('../../src/models/Customer.js', () => ({
  default: {
    find: mocks.customerFind,
    findById: vi.fn(),
    findOne: vi.fn()
  }
}));

vi.mock('../../src/models/Sale.js', () => ({
  default: {
    find: mocks.saleFind
  }
}));

vi.mock('../../src/models/Approval.js', () => ({
  default: {
    findById: mocks.approvalFindById,
    find: mocks.approvalFind
  }
}));

vi.mock('../../src/utils/approvalWorkflow.js', () => ({
  createApprovalForReference: mocks.createApprovalForReference
}));

vi.mock('../../src/utils/credit.js', () => ({
  computeCreditStatus: vi.fn((row) => row),
  customerRankFromScore: vi.fn(() => 'bronze'),
  refreshCreditSaleStatus: mocks.refreshCreditSaleStatus,
  updateCustomerCreditMetrics: mocks.updateCustomerCreditMetrics
}));

vi.mock('../../src/utils/superBin.js', () => ({
  archiveLiveDocument: mocks.archiveLiveDocument
}));

const { default: router } = await import('../../src/routes/credits.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'phase1-credits-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    name: 'Admin User',
    role: 'Admin',
    tenantId: 'master',
    branchId: 'north',
    assignedBranches: 'all',
    ...overrides
  }, secret);
  return { Authorization: `Bearer ${token}` };
}

describe('credits route characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('returns an empty list when a restricted user requests another branchs credit sales', async () => {
    const response = await request(createApp())
      .get('/sales')
      .query({ branchId: 'south' })
      .set(authHeader({
        role: 'Manager',
        branchId: 'north',
        assignedBranches: ['north']
      }))
      .expect(200);

    expect(response.body).toEqual([]);
    expect(mocks.creditSaleFind).not.toHaveBeenCalled();
  });

  it('requires creditSaleId when creating a repayment', async () => {
    const response = await request(createApp())
      .post('/repayments')
      .set(authHeader())
      .send({ amount: 10 })
      .expect(400);

    expect(response.body).toEqual({ error: 'Missing creditSaleId' });
  });

  it('requires repayment amounts greater than zero', async () => {
    const response = await request(createApp())
      .post('/repayments')
      .set(authHeader())
      .send({ creditSaleId: 'sale-1', amount: 0 })
      .expect(400);

    expect(response.body).toEqual({ error: 'Amount must be greater than zero' });
  });

  it('returns the current completed-sale error once refreshCreditSaleStatus leaves the sale completed', async () => {
    mocks.creditSaleFindById.mockResolvedValue({
      _id: 'sale-1',
      branchId: 'north',
      balance: 50,
      accumulated_penalty: 0,
      status: 'completed'
    });

    const response = await request(createApp())
      .post('/repayments')
      .set(authHeader())
      .send({ creditSaleId: 'sale-1', amount: 10 })
      .expect(400);

    expect(response.body).toEqual({ error: 'Credit sale is already completed' });
  });

  it('returns the existing repayment and approval when the generated clientId has already been used', async () => {
    mocks.creditSaleFindById.mockResolvedValue({
      _id: 'sale-1',
      branchId: 'north',
      customer_id: 'cust-1',
      balance: 100,
      accumulated_penalty: 0,
      status: 'active'
    });
    mocks.creditRepaymentFind.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([])
      })
    });
    mocks.creditRepaymentFindOne.mockResolvedValue({
      _id: 'repayment-1',
      approvalId: 'approval-1',
      amount: 10
    });
    mocks.approvalFindById.mockResolvedValue({
      _id: 'approval-1',
      status: 'pending_director'
    });

    const response = await request(createApp())
      .post('/repayments')
      .set(authHeader())
      .send({ creditSaleId: 'sale-1', amount: 10, paidAt: '2026-09-08T10:00:00.000Z' })
      .expect(200);

    expect(response.body).toEqual({
      repayment: {
        _id: 'repayment-1',
        approvalId: 'approval-1',
        amount: 10
      },
      approval: {
        _id: 'approval-1',
        status: 'pending_director'
      }
    });
  });

  it('creates a pending_director repayment and approval on the current happy path', async () => {
    mocks.creditSaleFindById.mockResolvedValue({
      _id: 'sale-1',
      branchId: 'north',
      customer_id: 'cust-1',
      balance: 100,
      accumulated_penalty: 0,
      status: 'active'
    });
    mocks.creditRepaymentFind.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([])
      })
    });
    mocks.creditRepaymentFindOne.mockResolvedValue(null);
    mocks.creditRepaymentCreate.mockResolvedValue({ _id: 'repayment-2' });
    mocks.createApprovalForReference.mockResolvedValue({ _id: 'approval-2', status: 'pending_director' });
    mocks.creditRepaymentFindById.mockResolvedValue({
      _id: 'repayment-2',
      status: 'pending_director',
      amount: 25
    });

    const response = await request(createApp())
      .post('/repayments')
      .set(authHeader())
      .send({ creditSaleId: 'sale-1', amount: 25 })
      .expect(200);

    expect(mocks.creditRepaymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      creditSaleId: 'sale-1',
      customerId: 'cust-1',
      amount: 25,
      status: 'pending_director'
    }));
    expect(response.body).toEqual({
      repayment: {
        _id: 'repayment-2',
        status: 'pending_director',
        amount: 25
      },
      approval: {
        _id: 'approval-2',
        status: 'pending_director'
      }
    });
  });
});
