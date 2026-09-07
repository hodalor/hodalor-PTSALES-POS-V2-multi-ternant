import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  saleFind: vi.fn(),
  saleFindOne: vi.fn(),
  enrichSalesWithAccounting: vi.fn(),
  fetch: vi.fn(() => Promise.reject(new Error('debug sink unavailable')))
}));

vi.mock('../../src/models/Sale.js', () => ({
  default: {
    find: mocks.saleFind,
    findOne: mocks.saleFindOne
  }
}));

vi.mock('../../src/models/Product.js', () => ({ default: {} }));
vi.mock('../../src/models/Audit.js', () => ({ default: { create: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../src/models/ServerLog.js', () => ({ default: { create: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../src/models/Settings.js', () => ({ default: { findOneAndUpdate: vi.fn(), findOne: vi.fn() } }));
vi.mock('../../src/models/Invoice.js', () => ({ default: { updateMany: vi.fn() } }));
vi.mock('../../src/models/Branch.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../src/models/Customer.js', () => ({ default: { findById: vi.fn(), findOne: vi.fn() } }));
vi.mock('../../src/models/CreditSale.js', () => ({ default: { findByIdAndUpdate: vi.fn() } }));
vi.mock('../../src/models/DiscountApproval.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../../src/models/ProductUnit.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../src/models/WholesaleOperation.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../src/models/TransferRequest.js', () => ({ default: {} }));

vi.mock('../../src/utils/inventory.js', () => ({
  getMapQty: vi.fn(),
  getStockTarget: vi.fn(),
  markInventoryModified: vi.fn(),
  resolveTierPrice: vi.fn(),
  setMapQty: vi.fn()
}));

vi.mock('../../src/utils/inventoryAudit.js', () => ({
  makeInventoryLine: vi.fn(),
  withInventoryAudit: vi.fn(async (callback) => callback())
}));

vi.mock('../../src/utils/credit.js', () => ({
  refreshCreditSaleStatus: vi.fn(),
  updateCustomerCreditMetrics: vi.fn()
}));

vi.mock('../../src/utils/productUnits.js', () => ({
  normalizeTrackType: vi.fn((value) => String(value || '').toLowerCase() === 'serialized' ? 'serialized' : 'quantity'),
  releaseSerializedUnits: vi.fn(),
  sellSerializedUnits: vi.fn()
}));

vi.mock('../../src/utils/safeError.js', () => ({
  safeErrorMessage: vi.fn((error, fallback) => error?.message || fallback),
  safeErrorStatus: vi.fn((error) => error?.status || 400)
}));

vi.mock('../../src/utils/superBin.js', () => ({
  archiveLiveDocument: vi.fn()
}));

vi.mock('../../src/utils/saleAccounting.js', () => ({
  enrichSalesWithAccounting: mocks.enrichSalesWithAccounting
}));

vi.mock('../../src/utils/inTransitLocks.js', () => ({
  assertOutgoingAvailability: vi.fn()
}));

const { default: router } = await import('../../src/routes/sales.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'phase1-sales-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    name: 'Alice',
    role: 'Admin',
    tenantId: 'master',
    branchId: 'main',
    assignedBranches: 'all',
    grants: [],
    ...overrides
  }, secret);
  return { Authorization: `Bearer ${token}` };
}

describe('sales route characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('filters cashier sales listing to the current seller and enriches the returned rows', async () => {
    mocks.saleFind.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([{ _id: 'sale-1', sellerName: 'Alice', branchId: 'main' }])
        })
      })
    });
    mocks.enrichSalesWithAccounting.mockResolvedValue([{ id: 'sale-1', sellerName: 'Alice', total: 10 }]);

    const response = await request(createApp())
      .get('/')
      .set(authHeader({
        role: 'Cashier',
        grants: ['see_sales'],
        assignedBranches: ['main'],
        branchId: 'main',
        name: 'Alice'
      }))
      .expect(200);

    expect(mocks.saleFind).toHaveBeenCalledWith(expect.objectContaining({
      branchId: { $in: ['main'] },
      sellerName: expect.any(RegExp)
    }));
    expect(response.body).toEqual([{ id: 'sale-1', sellerName: 'Alice', total: 10 }]);
  });

  it('returns an empty list when a requested branch is outside the computed access filter', async () => {
    const response = await request(createApp())
      .get('/')
      .query({ branchId: 'south' })
      .set(authHeader({
        role: 'Cashier',
        grants: ['see_sales'],
        assignedBranches: ['main'],
        branchId: 'main',
        name: 'Alice'
      }))
      .expect(200);

    expect(response.body).toEqual([]);
    expect(mocks.saleFind).not.toHaveBeenCalled();
  });

  it('requires branchId before attempting to create a sale', async () => {
    const response = await request(createApp())
      .post('/')
      .set(authHeader())
      .send({ items: [{ productId: 'p1', qty: 1 }] })
      .expect(400);

    expect(response.body).toEqual({ error: 'Missing branchId' });
  });

  it('requires at least one sale item', async () => {
    const response = await request(createApp())
      .post('/')
      .set(authHeader())
      .send({ branchId: 'main', items: [] })
      .expect(400);

    expect(response.body).toEqual({ error: 'Sale must include items' });
  });

  it('rejects discounted sales that arrive without a discount approval id', async () => {
    const response = await request(createApp())
      .post('/')
      .set(authHeader())
      .send({
        branchId: 'main',
        discount: 5,
        items: [{ productId: 'p1', qty: 1 }]
      })
      .expect(403);

    expect(response.body).toEqual({ error: 'Discounted sales must be approved first' });
  });

  it('dedupes repeated sale requests by returning the existing sale for the same clientId even if debug telemetry fails', async () => {
    mocks.saleFindOne.mockResolvedValue({
      _id: 'sale-2',
      clientId: 'sale-client-1',
      branchId: 'main',
      status: 'completed'
    });

    const response = await request(createApp())
      .post('/')
      .set(authHeader())
      .send({
        branchId: 'main',
        clientId: 'sale-client-1',
        items: [{ productId: 'p1', qty: 1 }]
      })
      .expect(200);

    expect(response.body).toEqual({
      _id: 'sale-2',
      clientId: 'sale-client-1',
      branchId: 'main',
      status: 'completed'
    });
  });
});
