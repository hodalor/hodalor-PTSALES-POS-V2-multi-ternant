import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  transferFind: vi.fn(),
  transferFindOne: vi.fn(),
  transferCreate: vi.fn(),
  auditCreate: vi.fn().mockResolvedValue({}),
  serverLogCreate: vi.fn().mockResolvedValue({}),
  resolveInventoryTypeFromBranch: vi.fn(async (branchId) => branchId === 'warehouse-1' ? 'warehouse' : 'retail'),
  transferSerializedUnits: vi.fn(),
  getStockTarget: vi.fn(),
  getMapQty: vi.fn(),
  markInventoryModified: vi.fn(),
  setMapQty: vi.fn(),
  safeErrorMessage: vi.fn((error, fallback) => error?.message || fallback),
  safeErrorStatus: vi.fn((error, fallback = 500) => error?.status || fallback),
  assertOutgoingAvailability: vi.fn(async () => {}),
  fetch: vi.fn(() => Promise.reject(new Error('debug sink unavailable')))
}));

vi.mock('../../src/models/TransferRequest.js', () => ({
  default: {
    find: mocks.transferFind,
    findOne: mocks.transferFindOne,
    create: mocks.transferCreate
  }
}));

vi.mock('../../src/models/Product.js', () => ({
  default: {
    findOne: vi.fn()
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

vi.mock('../../src/utils/productUnits.js', () => ({
  normalizeTrackType: vi.fn(() => 'quantity'),
  resolveInventoryTypeFromBranch: mocks.resolveInventoryTypeFromBranch,
  transferSerializedUnits: mocks.transferSerializedUnits
}));

vi.mock('../../src/utils/inventory.js', () => ({
  getStockTarget: mocks.getStockTarget,
  getMapQty: mocks.getMapQty,
  markInventoryModified: mocks.markInventoryModified,
  setMapQty: mocks.setMapQty
}));

vi.mock('../../src/utils/safeError.js', () => ({
  safeErrorMessage: mocks.safeErrorMessage,
  safeErrorStatus: mocks.safeErrorStatus
}));

vi.mock('../../src/utils/inTransitLocks.js', () => ({
  assertOutgoingAvailability: mocks.assertOutgoingAvailability
}));

const { default: router } = await import('../../src/routes/transfers.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'phase3-transfers-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    name: 'Manager User',
    role: 'Manager',
    tenantId: 'master',
    branchId: 'main',
    assignedBranches: 'all',
    grants: ['add_transfers', 'approve_retail_manager'],
    ...overrides
  }, secret);
  return { Authorization: `Bearer ${token}` };
}

describe('transfers route characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('creates a transfer request even if debug telemetry fails', async () => {
    mocks.transferFindOne.mockResolvedValue(null);
    mocks.transferCreate.mockResolvedValue({
      _id: 'tr-1',
      clientId: 'client-1',
      from: 'main',
      to: 'branch-2',
      qty: 2,
      items: [{ productId: 'p1', qty: 2 }],
      initiatorName: 'Manager User'
    });

    const response = await request(createApp())
      .post('/requests')
      .set(authHeader())
      .send({
        clientId: 'client-1',
        from: 'main',
        to: 'branch-2',
        qty: 2,
        items: [{ productId: 'p1', qty: 2 }]
      })
      .expect(200);

    expect(response.body).toEqual({
      _id: 'tr-1',
      clientId: 'client-1',
      from: 'main',
      to: 'branch-2',
      qty: 2,
      items: [{ productId: 'p1', qty: 2 }],
      initiatorName: 'Manager User'
    });
  });
});
