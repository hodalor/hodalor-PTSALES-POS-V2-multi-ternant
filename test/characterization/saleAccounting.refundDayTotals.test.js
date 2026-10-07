import { describe, expect, it } from 'vitest';
import { buildRecognizedDayTotals } from '../../src/utils/saleAccounting.js';

function localDay(year, monthIndex, day, hour = 12) {
  return new Date(year, monthIndex, day, hour, 0, 0, 0);
}

describe('buildRecognizedDayTotals refund netting', () => {
  it('deducts approved refunds from pending day totals', () => {
    const sale = {
      _id: 'sale-1',
      branchId: 'dambai',
      total: 2090,
      costTotal: 1930,
      created_at: localDay(2026, 8, 2, 18),
      payment_methods: [{ type: 'cash', amount: 2090 }]
    };
    const refund = {
      _id: 'refund-1',
      branchId: 'dambai',
      saleId: 'sale-1',
      status: 'approved',
      type: 'full',
      requestedAmount: 2090,
      cashRefundAmount: 2090,
      settlementMode: 'cash_refund',
      approved_at: localDay(2026, 8, 20, 16)
    };
    const start = localDay(2026, 8, 1, 0);
    const end = new Date(2026, 8, 30, 23, 59, 59, 999);
    const totals = buildRecognizedDayTotals([sale], start, end, {
      refunds: [refund],
      refundAttribution: 'unreconciled_sale_date',
      coveredApproved: new Set()
    });
    expect(totals.get('dambai:2026-09-02')?.total).toBe(0);
    expect(totals.has('dambai:2026-09-20')).toBe(false);
  });

  it('keeps refund on approval day when original sales day is already deposited', () => {
    const sale = {
      _id: 'sale-1',
      branchId: 'dambai',
      total: 2090,
      costTotal: 1930,
      created_at: localDay(2026, 8, 2, 18),
      payment_methods: [{ type: 'cash', amount: 2090 }]
    };
    const refund = {
      _id: 'refund-1',
      branchId: 'dambai',
      saleId: 'sale-1',
      status: 'approved',
      type: 'full',
      requestedAmount: 2090,
      cashRefundAmount: 2090,
      settlementMode: 'cash_refund',
      approved_at: localDay(2026, 8, 20, 16)
    };
    const start = localDay(2026, 8, 1, 0);
    const end = new Date(2026, 8, 30, 23, 59, 59, 999);
    const totals = buildRecognizedDayTotals([sale], start, end, {
      refunds: [refund],
      refundAttribution: 'unreconciled_sale_date',
      coveredApproved: new Set(['dambai:2026-09-02'])
    });
    expect(totals.get('dambai:2026-09-02')?.total).toBe(2090);
    expect(totals.get('dambai:2026-09-20')?.total).toBe(-2090);
  });

  it('does not double-count negative refund sale ledger rows in payment mix', () => {
    const refundSale = {
      _id: 'refund-sale-1',
      branchId: 'dambai',
      total: -2090,
      costTotal: 0,
      created_at: localDay(2026, 8, 20, 16),
      payment_methods: [{ type: 'refund', amount: -2090 }]
    };
    const refund = {
      _id: 'refund-1',
      branchId: 'dambai',
      saleId: 'sale-missing',
      status: 'approved',
      type: 'full',
      requestedAmount: 2090,
      cashRefundAmount: 2090,
      settlementMode: 'cash_refund',
      approved_at: localDay(2026, 8, 20, 16)
    };
    const start = localDay(2026, 8, 1, 0);
    const end = new Date(2026, 8, 30, 23, 59, 59, 999);
    const totals = buildRecognizedDayTotals([refundSale], start, end, { refunds: [refund] });
    expect(totals.get('dambai:2026-09-20')?.total).toBe(-2090);
    expect(totals.get('dambai:2026-09-20')?.paymentBreakdown?.refund).toBe(-2090);
  });

  it('matches the EBK Dambai pending-deposit bug math when negatives are included', () => {
    const sales = [
      {
        _id: 's1',
        branchId: 'dambai',
        total: 10000,
        costTotal: 8000,
        created_at: localDay(2026, 8, 2, 10),
        payment_methods: [{ type: 'cash', amount: 10000 }]
      },
      {
        _id: 's2',
        branchId: 'dambai',
        total: 2090,
        costTotal: 1930,
        created_at: localDay(2026, 8, 2, 18),
        payment_methods: [{ type: 'cash', amount: 2090 }]
      }
    ];
    const refund = {
      _id: 'r1',
      branchId: 'dambai',
      saleId: 's2',
      status: 'approved',
      type: 'full',
      requestedAmount: 2090,
      cashRefundAmount: 2090,
      settlementMode: 'cash_refund',
      approved_at: localDay(2026, 8, 20, 16)
    };
    const start = localDay(2026, 8, 1, 0);
    const end = new Date(2026, 8, 30, 23, 59, 59, 999);
    const byApprovalDay = buildRecognizedDayTotals(sales, start, end, { refunds: [refund] });
    const positiveOnlyBug = Array.from(byApprovalDay.values())
      .filter((row) => Number(row.total || 0) > 0)
      .reduce((sum, row) => sum + Number(row.total || 0), 0);
    const correctNet = Array.from(byApprovalDay.values())
      .reduce((sum, row) => sum + Number(row.total || 0), 0);
    expect(positiveOnlyBug).toBe(12090);
    expect(correctNet).toBe(10000);

    const bySaleDay = buildRecognizedDayTotals(sales, start, end, {
      refunds: [refund],
      refundAttribution: 'unreconciled_sale_date',
      coveredApproved: new Set()
    });
    expect(bySaleDay.get('dambai:2026-09-02')?.total).toBe(10000);
    expect(Array.from(bySaleDay.values()).reduce((sum, row) => sum + Number(row.total || 0), 0)).toBe(10000);
  });
});
