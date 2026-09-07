import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  productFind: vi.fn(),
  productCreate: vi.fn(),
  productFindOne: vi.fn(),
  productFindOneAndUpdate: vi.fn(),
  productDeleteOne: vi.fn(),
  auditCreate: vi.fn().mockResolvedValue({}),
  serverLogCreate: vi.fn().mockResolvedValue({}),
  uploadMediaString: vi.fn(async (value) => value),
  archiveLiveDocument: vi.fn().mockResolvedValue({})
}));

vi.mock('../../src/models/Product.js', () => ({
  default: {
    find: mocks.productFind,
    create: mocks.productCreate,
    findOne: mocks.productFindOne,
    findOneAndUpdate: mocks.productFindOneAndUpdate,
    deleteOne: mocks.productDeleteOne
  }
}));

vi.mock('../../src/models/Audit.js', () => ({
  default: {
    create: mocks.auditCreate
  }
}));

vi.mock('../../src/models/ServerLog.js', () => ({
  default: {
    create: mocks.serverLogCreate
  }
}));

vi.mock('../../src/utils/mediaStorage.js', () => ({
  uploadMediaString: mocks.uploadMediaString
}));

vi.mock('../../src/utils/superBin.js', () => ({
  archiveLiveDocument: mocks.archiveLiveDocument
}));

const { default: router } = await import('../../src/routes/products.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'phase1-products-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    name: 'Admin User',
    role: 'Admin',
    tenantId: 'master',
    branchId: 'main',
    assignedBranches: 'all',
    ...overrides
  }, secret);
  return { Authorization: `Bearer ${token}` };
}

describe('products route characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists products, backfills missing barcodes, and applies current pricing defaults', async () => {
    const save = vi.fn().mockResolvedValue({});
    mocks.productFind.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          {
            _id: '507f191e810c19729de860ea',
            name: 'Phone',
            price: 10,
            retailPrice: '',
            wholesalePrice: '',
            warehousePrice: '',
            agentPrice: '',
            lowStock: '2',
            trackType: '',
            stockByBranch: new Map([['main', 5]]),
            wholesaleStockByBranch: new Map([['main', 1]]),
            warehouseStockByBranch: new Map(),
            variants: [{ label: 'Blue', price: 15 }],
            toObject: vi.fn(() => ({
              _id: '507f191e810c19729de860ea',
              name: 'Phone',
              price: 10,
              retailPrice: '',
              wholesalePrice: '',
              warehousePrice: '',
              agentPrice: '',
              lowStock: '2',
              trackType: '',
              stockByBranch: new Map([['main', 5]]),
              wholesaleStockByBranch: new Map([['main', 1]]),
              warehouseStockByBranch: new Map(),
              variants: [{ label: 'Blue', price: 15 }]
            })),
            save
          }
        ])
      })
    });

    const response = await request(createApp())
      .get('/')
      .set(authHeader())
      .expect(200);

    expect(save).toHaveBeenCalledOnce();
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: '507f191e810c19729de860ea',
      retailPrice: 10,
      wholesalePrice: 10,
      warehousePrice: 0,
      agentPrice: 10,
      allowCredit: true,
      trackType: 'quantity',
      lowStock: 2,
      wholesaleLowStock: 2,
      warehouseLowStock: 2
    });
    expect(response.body[0].barcode).toBeUndefined();
    expect(response.body[0].variants[0]).toMatchObject({
      id: 'Blue',
      retailPrice: 15,
      wholesalePrice: 10,
      warehousePrice: 0,
      agentPrice: 10
    });
  });

  it('rejects product creation when cost price exceeds retail price', async () => {
    const response = await request(createApp())
      .post('/')
      .set(authHeader())
      .send({
        name: 'Phone',
        sku: 'SKU-1',
        retailPrice: 10,
        costPrice: 20
      })
      .expect(400);

    expect(response.body).toEqual({
      error: 'Cost price cannot be greater than retail selling price'
    });
  });

  it('rejects normal product updates that attempt to modify inventory maps directly', async () => {
    mocks.productFindOne.mockResolvedValue({
      id: 'product-1',
      name: 'Phone',
      variants: []
    });

    const response = await request(createApp())
      .put('/product-1')
      .set(authHeader())
      .send({
        stockByBranch: { main: 9 }
      })
      .expect(400);

    expect(response.body).toEqual({
      error: 'Normal product editing cannot change stock balances. Use the inventory stock endpoints for stock changes.'
    });
  });

  it('requires a deletion remark before deleting a product', async () => {
    mocks.productFindOne.mockResolvedValue({
      _id: '507f191e810c19729de860ea',
      id: 'product-1',
      name: 'Phone'
    });

    const response = await request(createApp())
      .delete('/product-1')
      .set(authHeader())
      .send({})
      .expect(400);

    expect(response.body).toEqual({
      error: 'Deletion remark is required'
    });
  });
});
