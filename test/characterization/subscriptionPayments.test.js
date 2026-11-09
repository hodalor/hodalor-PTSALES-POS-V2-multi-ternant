import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settingsFindOne: vi.fn(),
  getEffectiveMonthlyAmount: vi.fn(),
  getSubscriptionPeriodsForAmount: vi.fn(),
  getSubscriptionManagementConfig: vi.fn(),
  normalizeSubscriptionAmount: vi.fn((value) => Number(value || 0)),
  refreshTenantActivationCode: vi.fn(),
  syncTenantSubscriptionSnapshot: vi.fn(),
  buildRenewalHistoryEntry: vi.fn(),
  computeExtendedSubscriptionDate: vi.fn(),
  sendActivationCodeEmail: vi.fn(),
  tenantModelFor: vi.fn()
}));

vi.mock('../../src/models/Settings.js', () => ({
  modelFor: vi.fn(() => ({
    findOne: mocks.settingsFindOne
  }))
}));

vi.mock('../../src/models/Tenant.js', () => ({
  modelFor: mocks.tenantModelFor
}));

vi.mock('../../src/utils/tenantActivation.js', () => ({
  ACTIVATION_EXTENSION_DAYS: 3,
  buildRenewalHistoryEntry: mocks.buildRenewalHistoryEntry,
  computeExtendedSubscriptionDate: mocks.computeExtendedSubscriptionDate,
  normalizeSubscriptionAmount: mocks.normalizeSubscriptionAmount,
  refreshTenantActivationCode: mocks.refreshTenantActivationCode,
  syncTenantSubscriptionSnapshot: mocks.syncTenantSubscriptionSnapshot
}));

vi.mock('../../src/utils/mailer.js', () => ({
  sendActivationCodeEmail: mocks.sendActivationCodeEmail
}));

vi.mock('../../src/utils/subscriptionManagement.js', () => ({
  getEffectiveMonthlyAmount: mocks.getEffectiveMonthlyAmount,
  getSubscriptionManagementConfig: mocks.getSubscriptionManagementConfig,
  getSubscriptionPeriodsForAmount: mocks.getSubscriptionPeriodsForAmount
}));

const subscriptionPayments = await import('../../src/utils/subscriptionPayments.js');

describe('subscriptionPayments characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settingsFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        data: {
          currencies: [
            { code: 'USD', symbol: '$', position: 'prefix' },
            { code: 'ZMW', symbol: 'K', position: 'prefix' }
          ],
          activeCurrencyCode: 'ZMW',
          currencySymbol: 'GHS',
          currencyPosition: 'suffix'
        }
      })
    });
    mocks.getEffectiveMonthlyAmount.mockResolvedValue(120);
    mocks.getSubscriptionPeriodsForAmount.mockResolvedValue([
      { months: 1, amount: 120 },
      { months: 3, amount: 324 }
    ]);
    mocks.getSubscriptionManagementConfig.mockResolvedValue({
      periods: [
        { months: 1, discountPercent: 0 },
        { months: 3, discountPercent: 10 }
      ]
    });
  });

  it('falls back to GH when the billing country is unknown', () => {
    expect(subscriptionPayments.normalizeCountryCode('xx')).toBe('GH');
    expect(subscriptionPayments.getMobileMoneyNetworks('xx')).toEqual(['MTN', 'AIRTELTIGO', 'TELECEL']);
  });

  it('returns the configured mobile money networks for the normalized country code', () => {
    expect(subscriptionPayments.normalizeCountryCode('zm')).toBe('ZM');
    expect(subscriptionPayments.getMobileMoneyNetworks('zm')).toEqual(['AIRTEL', 'MTN', 'ZAMTEL']);
  });

  it('builds renewal info from settings, tenant data, and subscription helpers', async () => {
    const result = await subscriptionPayments.getTenantRenewalInfo(
      { name: 'tenant-conn' },
      {
        _masterConn: { name: 'master-conn' },
        tenantId: 'ebk',
        name: 'EBK Stores',
        subscriptionExpiresAt: '2000-01-01T00:00:00.000Z',
        billingEmail: 'billing@example.com',
        billingPhone: '12345',
        billingAddress: 'Accra',
        billingCountry: 'zm'
      }
    );

    expect(result).toMatchObject({
      tenantId: 'ebk',
      tenantName: 'EBK Stores',
      expired: true,
      currencyCode: 'ZMW',
      currencySymbol: 'K',
      currencyPosition: 'prefix',
      subscriptionAmount: 120,
      billingCountry: 'ZM',
      periods: [{ months: 1, amount: 120 }, { months: 3, amount: 324 }]
    });
    expect(mocks.getEffectiveMonthlyAmount).toHaveBeenCalledWith({ name: 'master-conn' }, expect.objectContaining({ tenantId: 'ebk' }));
    expect(mocks.getSubscriptionPeriodsForAmount).toHaveBeenCalledWith({ name: 'master-conn' }, 120);
  });

  it('calculates discounted renewal totals from the current subscription config', async () => {
    const result = await subscriptionPayments.calculateRenewalAmount({ name: 'master-conn' }, { tenantId: 'ebk' }, 3);

    expect(result).toBe(324);
    expect(mocks.getSubscriptionManagementConfig).toHaveBeenCalledWith({ name: 'master-conn' });
  });

  it('returns null when the requested renewal period is not present in the config', async () => {
    const result = await subscriptionPayments.calculateRenewalAmount({ name: 'master-conn' }, { tenantId: 'ebk' }, 12, 90);

    expect(result).toBeNull();
  });

  it('detects an already applied renewal payment by transactionRef', () => {
    expect(subscriptionPayments.hasSuccessfulPaymentRef({
      paymentHistory: [{ transactionRef: 'renewal_ebk_1_card_1' }]
    }, 'renewal_ebk_1_card_1')).toBe(true);
    expect(subscriptionPayments.hasSuccessfulPaymentRef({
      paymentHistory: [{ transactionRef: 'renewal_ebk_1_card_1' }]
    }, 'renewal_ebk_1_card_2')).toBe(false);
  });

  it('applies a renewal payment once and ignores later calls with the same transactionRef', async () => {
    const existing = {
      tenantId: 'ebk',
      subscriptionExpiresAt: '2026-01-01T00:00:00.000Z',
      subscriptionPermanent: false,
      subscriptionPlan: 'basic',
      subscriptionAmount: 120,
      paymentHistory: []
    };
    const applied = {
      ...existing,
      paymentHistory: [{ transactionRef: 'renewal_ebk_1_card_99' }],
      renewalHistory: [{ daysAdded: 3 }],
      subscriptionExpiresAt: '2026-01-04T00:00:00.000Z',
      activationCode: 'ABC123'
    };
    const findOne = vi.fn()
      .mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(existing) })
      .mockReturnValue({ lean: vi.fn().mockResolvedValue(applied) });
    const findOneAndUpdate = vi.fn().mockResolvedValue(applied);
    mocks.tenantModelFor.mockReturnValue({ findOne, findOneAndUpdate });
    mocks.computeExtendedSubscriptionDate.mockReturnValue('2026-01-04T00:00:00.000Z');
    mocks.buildRenewalHistoryEntry.mockReturnValue({ daysAdded: 3 });
    mocks.refreshTenantActivationCode.mockResolvedValue({ activationCode: 'ABC123', activationCodeExpiresAt: '2026-02-01T00:00:00.000Z' });
    mocks.sendActivationCodeEmail.mockResolvedValue(undefined);
    mocks.syncTenantSubscriptionSnapshot.mockResolvedValue(undefined);

    const first = await subscriptionPayments.applyVerifiedRenewalPayment({
      masterConn: { name: 'master-conn' },
      tenantConn: { name: 'tenant-conn' },
      tenantDoc: existing,
      months: 1,
      amount: 120,
      note: 'Online renewal payment for 1 month(s)',
      payment: {
        provider: 'paystack',
        method: 'hosted_checkout',
        channel: 'card',
        transactionRef: 'renewal_ebk_1_card_99',
        providerTransactionId: 'tx-1',
        currencyCode: 'GHS'
      }
    });
    const second = await subscriptionPayments.applyVerifiedRenewalPayment({
      masterConn: { name: 'master-conn' },
      tenantConn: { name: 'tenant-conn' },
      tenantDoc: existing,
      months: 1,
      amount: 120,
      payment: {
        provider: 'paystack',
        method: 'hosted_checkout',
        channel: 'card',
        transactionRef: 'renewal_ebk_1_card_99'
      }
    });

    expect(first.alreadyApplied).toBe(false);
    expect(second.alreadyApplied).toBe(true);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdate.mock.calls[0][0]).toEqual({
      tenantId: 'ebk',
      'paymentHistory.transactionRef': { $ne: 'renewal_ebk_1_card_99' }
    });
    expect(mocks.refreshTenantActivationCode).toHaveBeenCalledTimes(1);
    expect(mocks.syncTenantSubscriptionSnapshot).toHaveBeenCalledTimes(1);
  });
});
