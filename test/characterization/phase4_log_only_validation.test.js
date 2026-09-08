import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAuth } from '../../src/middleware/auth.js';

const validationSpy = vi.fn();

const salesMocks = vi.hoisted(() => ({
  saleFindOne: vi.fn(),
  fetch: vi.fn(() => Promise.resolve({ ok: true }))
}));

const creditsMocks = vi.hoisted(() => ({
  creditSaleFindById: vi.fn(),
  creditRepaymentFind: vi.fn(),
  creditRepaymentFindOne: vi.fn(),
  fetch: vi.fn(() => Promise.resolve({ ok: true }))
}));

const productsMocks = vi.hoisted(() => ({
  uploadMediaString: vi.fn(async (value) => value),
  serverLogCreate: vi.fn().mockResolvedValue({})
}));

vi.mock('../../src/validation/logOnlyValidation.js', async () => {
  const actual = await vi.importActual('../../src/validation/logOnlyValidation.js');
  return {
    ...actual,
    validateLogOnly: (...args) => validationSpy(...args)
  };
});

vi.mock('../../src/models/Sale.js', () => ({
  default: {
    find: vi.fn(),
    findOne: salesMocks.saleFindOne,
    deleteMany: vi.fn(),
    deleteOne: vi.fn()
  }
}));

vi.mock('../../src/models/Product.js', () => ({
  default: {
    create: vi.fn(),
    findOne: vi.fn().mockResolvedValue({ id: 'product-1', name: 'Phone', variants: [] })
  }
}));

vi.mock('../../src/models/Audit.js', () => ({
  default: {
    create: vi.fn().mockResolvedValue({})
  }
}));

vi.mock('../../src/models/ServerLog.js', () => ({
  default: {
    create: productsMocks.serverLogCreate
  }
}));

vi.mock('../../src/models/Settings.js', () => ({
  default: {}
}));

vi.mock('../../src/models/Invoice.js', () => ({
  default: {}
}));

vi.mock('../../src/models/Branch.js', () => ({
  default: {}
}));

vi.mock('../../src/models/Customer.js', () => ({
  default: {}
}));

vi.mock('../../src/models/CreditSale.js', () => ({
  default: {
    findById: creditsMocks.creditSaleFindById,
    find: vi.fn()
  }
}));

vi.mock('../../src/models/DiscountApproval.js', () => ({
  default: {}
}));

vi.mock('../../src/models/ProductUnit.js', () => ({
  default: {}
}));

vi.mock('../../src/models/CreditRepayment.js', () => ({
  default: {
    find: creditsMocks.creditRepaymentFind,
    findOne: creditsMocks.creditRepaymentFindOne
  }
}));

vi.mock('../../src/models/Approval.js', () => ({
  default: {
    findById: vi.fn()
  }
}));

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
  computeCreditStatus: vi.fn((row) => row),
  customerRankFromScore: vi.fn(() => 'bronze'),
  refreshCreditSaleStatus: vi.fn(async () => {}),
  updateCustomerCreditMetrics: vi.fn()
}));

vi.mock('../../src/utils/productUnits.js', () => ({
  normalizeTrackType: vi.fn(() => 'quantity'),
  releaseSerializedUnits: vi.fn(),
  sellSerializedUnits: vi.fn()
}));

vi.mock('../../src/utils/safeError.js', () => ({
  safeErrorMessage: vi.fn((error, fallback) => error?.message || fallback),
  safeErrorStatus: vi.fn((error, fallback = 400) => error?.status || fallback)
}));

vi.mock('../../src/utils/superBin.js', () => ({
  archiveLiveDocument: vi.fn()
}));

vi.mock('../../src/utils/saleAccounting.js', () => ({
  enrichSalesWithAccounting: vi.fn(async (rows) => rows)
}));

vi.mock('../../src/utils/inTransitLocks.js', () => ({
  assertOutgoingAvailability: vi.fn(async () => {})
}));

vi.mock('../../src/utils/approvalWorkflow.js', () => ({
  createApprovalForReference: vi.fn()
}));

vi.mock('../../src/utils/mediaStorage.js', () => ({
  uploadMediaString: productsMocks.uploadMediaString
}));

vi.mock('../../src/config/tenantAccess.js', () => ({
  filterGrantsByFeatureFlags: vi.fn((grants) => grants)
}));

vi.mock('../../src/config/tenancy.js', () => ({
  getMasterConnection: vi.fn(),
  getTenantConnection: vi.fn(),
  resolveStoredTenantId: vi.fn(async (value) => value),
  normalizeTenantId: vi.fn((value) => String(value || '').trim().toLowerCase())
}));

vi.mock('../../src/models/User.js', () => ({
  modelFor: vi.fn(() => ({
    findOne: vi.fn()
  }))
}));

vi.mock('../../src/models/Tenant.js', () => ({
  default: {
    findOne: vi.fn()
  },
  modelFor: vi.fn(() => ({
    findOne: vi.fn(async () => ({ tenantId: 'tenant-1', disabled: false }))
  }))
}));

vi.mock('../../src/models/TenantSession.js', () => ({
  modelFor: vi.fn(() => ({
    findOne: vi.fn()
  }))
}));

vi.mock('../../src/utils/tenantLimits.js', () => ({
  cleanupExpiredTenantSessions: vi.fn(),
  countActiveTenantSessions: vi.fn(),
  getEffectiveTenantLimits: vi.fn(),
  getTenantLimitDefaults: vi.fn(),
  getTenantUsageSummary: vi.fn(async () => ({ limits: { maxUserAccounts: 10 }, usage: { totalUsers: 2 } })),
  hasActiveTenantSession: vi.fn()
}));

vi.mock('../../src/utils/tenantActivation.js', () => ({
  activateTenantSubscription: vi.fn(),
  ensureTenantActivationCode: vi.fn(async (_master, tenant) => tenant || { tenantId: 'tenant-1', disabled: false, subscriptionPermanent: false })
}));

vi.mock('../../src/utils/subscriptionPayments.js', () => ({
  createDpoRenewalPayment: vi.fn(async () => ({ ok: true, provider: 'dpo', checkoutUrl: 'https://example.test/dpo' })),
  createPayPalRenewalPayment: vi.fn(async () => ({ ok: true, provider: 'paypal', checkoutUrl: 'https://example.test/paypal' })),
  createPaystackRenewalPayment: vi.fn(async () => ({ ok: true, provider: 'paystack', checkoutUrl: 'https://example.test/paystack' })),
  getMobileMoneyNetworks: vi.fn(() => []),
  getTenantRenewalInfo: vi.fn(async () => ({ billingCountry: 'GH' })),
  verifyDpoRenewalPayment: vi.fn(),
  verifyPayPalRenewalPayment: vi.fn(),
  verifyPaystackRenewalPayment: vi.fn(),
  createDpoLimitUpgradePayment: vi.fn(async () => ({ ok: true, provider: 'dpo', checkoutUrl: 'https://example.test/dpo-limit' })),
  createPayPalLimitUpgradePayment: vi.fn(async () => ({ ok: true, provider: 'paypal', checkoutUrl: 'https://example.test/paypal-limit' })),
  createPaystackLimitUpgradePayment: vi.fn(async () => ({ ok: true, provider: 'paystack', checkoutUrl: 'https://example.test/paystack-limit' })),
  getTenantLimitUpgradeInfo: vi.fn(async () => ({ addOnPricing: { additionalUserRate: 1 }, billingCountry: 'GH' })),
  verifyDpoLimitUpgradePayment: vi.fn(),
  verifyPayPalLimitUpgradePayment: vi.fn(),
  verifyPaystackLimitUpgradePayment: vi.fn()
}));

vi.mock('../../src/utils/paymentManagement.js', () => ({
  getPaymentManagementConfig: vi.fn(async () => ({ enabledGateways: ['dpo_pay', 'paystack', 'paypal'] }))
}));

const { default: salesRouter } = await import('../../src/routes/sales.js');
const { default: creditsRouter } = await import('../../src/routes/credits.js');
const { default: productsRouter } = await import('../../src/routes/products.js');
const { default: authRouter } = await import('../../src/routes/auth.js');
const { default: tenantsRouter } = await import('../../src/routes/tenants.js');

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use(parseAuth);
  app.use(router);
  return app;
}

function authHeader(overrides = {}) {
  const secret = 'phase4-log-only-secret';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    name: 'Admin User',
    role: 'Admin',
    tenantId: 'tenant-1',
    branchId: 'main',
    assignedBranches: 'all',
    grants: ['view_config'],
    ...overrides
  }, secret);
  return { Authorization: `Bearer ${token}` };
}

describe('Phase 4 log-only validation characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', salesMocks.fetch);
    salesMocks.saleFindOne.mockResolvedValue(null);
    creditsMocks.creditSaleFindById.mockResolvedValue({
      _id: 'credit-sale-1',
      branchId: 'main',
      balance: 100,
      accumulated_penalty: 0,
      customer_id: 'customer-1',
      status: 'completed'
    });
    creditsMocks.creditRepaymentFind.mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([])
      })
    });
    creditsMocks.creditRepaymentFindOne.mockResolvedValue(null);
  });

  it('still returns the current sales validation error while invoking log-only validation', async () => {
    const response = await request(createApp(salesRouter))
      .post('/')
      .set(authHeader())
      .send({ items: [] })
      .expect(400);

    expect(validationSpy).toHaveBeenCalled();
    expect(response.body).toEqual({ error: 'Missing branchId' });
  });

  it('still returns the current credit repayment validation error while invoking log-only validation', async () => {
    const response = await request(createApp(creditsRouter))
      .post('/repayments')
      .set(authHeader())
      .send({ amount: 0 })
      .expect(400);

    expect(validationSpy).toHaveBeenCalled();
    expect(response.body).toEqual({ error: 'Missing creditSaleId' });
  });

  it('still returns the current product pricing validation error while invoking log-only validation', async () => {
    const response = await request(createApp(productsRouter))
      .post('/')
      .set(authHeader())
      .send({ retailPrice: 10, costPrice: 20 })
      .expect(400);

    expect(validationSpy).toHaveBeenCalled();
    expect(response.body).toEqual({ error: 'Cost price cannot be greater than retail selling price' });
  });

  it('still accepts renewal payment requests while invoking log-only validation', async () => {
    const response = await request(createApp(authRouter))
      .post('/start-renewal-payment')
      .send({ tenantId: 'tenant-1', provider: 'dpo_pay', months: 'abc' })
      .expect(200);

    expect(validationSpy).toHaveBeenCalled();
    expect(response.body).toMatchObject({ ok: true });
  });

  it('still accepts limit-upgrade requests while invoking log-only validation', async () => {
    const response = await request(createApp(tenantsRouter))
      .post('/start-limit-upgrade-payment')
      .set(authHeader())
      .send({ provider: 'paystack', resourceType: 'user', quantity: 'abc' })
      .expect(200);

    expect(validationSpy).toHaveBeenCalled();
    expect(response.body).toMatchObject({ ok: true });
  });
});
