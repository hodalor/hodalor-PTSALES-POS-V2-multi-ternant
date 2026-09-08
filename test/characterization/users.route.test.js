import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const mocks = vi.hoisted(() => ({
  userFind: vi.fn(),
  userFindOne: vi.fn(),
  userCreate: vi.fn(),
  auditCreate: vi.fn().mockResolvedValue({}),
  serverLogCreate: vi.fn().mockResolvedValue({}),
  hashPin: vi.fn(async (pin) => `hashed:${pin}`),
  fetch: vi.fn(() => Promise.reject(new Error('debug sink unavailable')))
}));

vi.mock('../../src/models/User.js', () => ({
  modelFor: vi.fn(() => ({
    find: mocks.userFind,
    findOne: mocks.userFindOne,
    create: mocks.userCreate,
    deleteOne: vi.fn()
  }))
}));

vi.mock('../../src/models/Audit.js', () => ({
  modelFor: vi.fn(() => ({
    create: mocks.auditCreate
  }))
}));

vi.mock('../../src/models/ServerLog.js', () => ({
  default: {
    create: mocks.serverLogCreate
  }
}));

vi.mock('../../src/utils/pin.js', () => ({
  hashPin: mocks.hashPin
}));

vi.mock('../../src/config/tenancy.js', () => ({
  getMasterConnection: vi.fn()
}));

vi.mock('../../src/models/Tenant.js', () => ({
  modelFor: vi.fn()
}));

vi.mock('../../src/models/TenantSession.js', () => ({
  modelFor: vi.fn()
}));

vi.mock('../../src/utils/tenantLimits.js', () => ({
  getEffectiveTenantLimits: vi.fn(),
  getTenantLimitDefaults: vi.fn(),
  getTenantUsageSummary: vi.fn()
}));

vi.mock('../../src/utils/paymentManagement.js', () => ({
  getPaymentManagementConfig: vi.fn()
}));

vi.mock('../../src/utils/subscriptionPayments.js', () => ({
  getMobileMoneyNetworks: vi.fn(() => []),
  getTenantLimitUpgradeInfo: vi.fn()
}));

vi.mock('../../src/utils/superBin.js', () => ({
  archiveLiveDocument: vi.fn()
}));

const { default: router } = await import('../../src/routes/users.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'phase3-users-secret';
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

describe('users route characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('creates a user even if debug telemetry fails', async () => {
    mocks.userFindOne.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      _id: 'user-1',
      name: 'Jane',
      role: 'Manager',
      branchId: 'main',
      assignedBranches: ['main'],
      preferredLanguage: 'en',
      active: true
    });

    const response = await request(createApp())
      .post('/')
      .set(authHeader())
      .send({
        name: 'Jane',
        role: 'Manager',
        pin: '1234',
        branchId: 'main',
        preferredLanguage: 'en'
      })
      .expect(200);

    expect(response.body).toEqual({
      id: 'user-1',
      name: 'Jane',
      role: 'Manager',
      branchId: 'main',
      assignedBranches: ['main'],
      preferredLanguage: 'en',
      active: true
    });
  });
});
