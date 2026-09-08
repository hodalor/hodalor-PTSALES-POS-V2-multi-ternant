import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  refundFind: vi.fn(),
  refundFindOne: vi.fn(),
  refundCreate: vi.fn(),
  saleFindById: vi.fn(),
  saleFindOne: vi.fn(),
  auditCreate: vi.fn(),
  uploadMediaArray: vi.fn(async () => []),
  enrichSalesWithAccounting: vi.fn(async (rows) => rows),
  fetch: vi.fn(() => Promise.reject(new Error('debug sink unavailable')))
}));

vi.mock('../../src/models/RefundRequest.js', () => ({
  default: {
    find: mocks.refundFind,
    findOne: mocks.refundFindOne,
    create: mocks.refundCreate
  }
}));

vi.mock('../../src/models/Audit.js', () => ({
  default: {
    create: mocks.auditCreate
  }
}));

vi.mock('../../src/models/Sale.js', () => ({
  default: {
    findById: mocks.saleFindById,
    findOne: mocks.saleFindOne
  }
}));

vi.mock('../../src/models/Product.js', () => ({ default: {} }));
vi.mock('../../src/models/CreditSale.js', () => ({ default: { findById: vi.fn(), findOne: vi.fn() } }));
vi.mock('../../src/utils/productUnits.js', () => ({
  resolveInventoryTypeFromBranch: vi.fn(),
  returnSerializedUnits: vi.fn()
}));
vi.mock('../../src/utils/inventory.js', () => ({
  getMapQty: vi.fn(),
  getStockTarget: vi.fn(),
  markInventoryModified: vi.fn(),
  setMapQty: vi.fn()
}));
vi.mock('../../src/utils/mediaStorage.js', () => ({
  uploadMediaArray: mocks.uploadMediaArray
}));
vi.mock('../../src/utils/saleAccounting.js', () => ({
  enrichSalesWithAccounting: mocks.enrichSalesWithAccounting
}));
vi.mock('../../src/utils/credit.js', () => ({
  refreshCreditSaleStatus: vi.fn(),
  updateCustomerCreditMetrics: vi.fn()
}));

const { default: router } = await import('../../src/routes/refunds.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'warehouse-refund-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    name: 'Warehouse User',
    role: 'Cashier',
    tenantId: 'master',
    branchId: 'warehouse-main',
    assignedBranches: ['warehouse-main'],
    grants: ['add_warehouse_refunds'],
    ...overrides
  }, secret);
  return { Authorization: `Bearer ${token}` };
}

describe('refunds route characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.refundFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([])
    });
    mocks.refundFindOne.mockResolvedValue(null);
    mocks.auditCreate.mockResolvedValue({});
  });

  it('rejects warehouse lookups for sales that belong to distribution refunds', async () => {
    mocks.saleFindOne.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: 'sale-1',
          branchId: 'warehouse-main',
          invoiceSerial: 'INV-DIST-001',
          receiptNumber: 'RCPT-DIST-001',
          inventoryType: 'wholesale',
          items: []
        })
      })
    });

    const response = await request(createApp())
      .get('/lookup-sale')
      .query({ q: 'INV-DIST-001', refundArea: 'warehouse' })
      .set(authHeader())
      .expect(400);

    expect(response.body).toEqual({ error: 'Sale belongs to distribution refunds' });
    expect(mocks.enrichSalesWithAccounting).not.toHaveBeenCalled();
  });

  it('creates warehouse refund requests with a persisted warehouse refund area', async () => {
    const saleId = '507f1f77bcf86cd799439011';
    mocks.saleFindById.mockResolvedValue({
      _id: saleId,
      branchId: 'warehouse-main',
      invoiceSerial: 'INV-WAREHOUSE-001',
      receiptNumber: 'RCPT-WAREHOUSE-001',
      inventoryType: 'warehouse',
      total: 250,
      tax: 0
    });
    mocks.refundCreate.mockImplementation(async (payload) => ({
      _id: 'refund-1',
      status: 'pending_approval',
      ...payload
    }));

    const response = await request(createApp())
      .post('/requests')
      .set(authHeader())
      .send({
        saleId,
        refundArea: 'warehouse',
        type: 'partial',
        requestedAmount: 75,
        initiatorName: 'Warehouse User',
        initiatorRole: 'Cashier'
      })
      .expect(200);

    expect(mocks.refundCreate).toHaveBeenCalledWith(expect.objectContaining({
      saleId,
      invoiceSerial: 'INV-WAREHOUSE-001',
      receiptNumber: 'RCPT-WAREHOUSE-001',
      branchId: 'warehouse-main',
      refundArea: 'warehouse',
      requestedAmount: 75
    }));
    expect(response.body).toEqual(expect.objectContaining({
      _id: 'refund-1',
      status: 'pending_approval',
      refundArea: 'warehouse'
    }));
  });

  it('allows warehouse director grants to review warehouse refund requests', async () => {
    const refundDoc = {
      _id: 'refund-warehouse-1',
      clientId: 'refund-warehouse-1',
      saleId: 'sale-warehouse-1',
      branchId: 'warehouse-main',
      refundArea: 'warehouse',
      status: 'pending_approval',
      save: vi.fn(async function save() { return this; })
    };
    mocks.refundFindOne.mockResolvedValue(refundDoc);

    const response = await request(createApp())
      .post('/reject')
      .set(authHeader({
        role: 'Director',
        grants: ['approve_warehouse_director']
      }))
      .send({
        id: 'refund-warehouse-1',
        approverName: 'Warehouse Director',
        approverRole: 'Director',
        remark: 'Director rejected for review'
      })
      .expect(200);

    expect(refundDoc.save).toHaveBeenCalled();
    expect(response.body).toEqual(expect.objectContaining({
      _id: 'refund-warehouse-1',
      status: 'rejected',
      approverRole: 'Director',
      rejectionRemark: 'Director rejected for review'
    }));
  });
});
