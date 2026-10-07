import 'dotenv/config';
import mongoose from 'mongoose';
import { listRecognizedSalesTotalsByDay } from '../src/utils/saleAccounting.js';

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}
function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  const master = await mongoose.createConnection(uri, { dbName: 'master' }).asPromise();
  const tenants = await master.db.collection('tenants').find(
    { tenantId: { $regex: /^ebk$/i } },
    { projection: { tenantId: 1, name: 1, dbName: 1, createdAt: 1 } }
  ).toArray();
  console.log('TENANTS', JSON.stringify(tenants, null, 2));
  const tenantId = tenants[0]?.tenantId || 'EBK';
  const dbName = tenants[0]?.dbName || `db_${tenantId}`;
  await master.close();

  await mongoose.connect(uri, { dbName });
  const db = mongoose.connection.db;

  const branches = await db.collection('branches').find({}).toArray();
  const dambai = branches.filter((b) => /^dambai branch$/i.test(String(b.name || '').trim()));
  console.log('BRANCHES', branches.map((b) => ({ id: b.id || String(b._id), name: b.name, code: b.code })));
  console.log('DAMBAI', dambai.map((b) => ({ id: b.id || String(b._id), name: b.name })));
  const branchId = String(dambai[0]?.id || '-uvolneQronrD9XXasqhA');
  if (!branchId) throw new Error('Dambai branch not found');

  const start = startOfLocalDay(new Date(2026, 8, 1));
  const end = endOfLocalDay(new Date(2026, 8, 30));
  console.log({ branchId, start: start.toString(), end: end.toString(), tzOffsetMin: new Date().getTimezoneOffset() });

  // Ensure default models are registered on this connection
  await import('../src/models/Sale.js');
  await import('../src/models/RefundRequest.js');
  await import('../src/models/CreditSale.js');
  await import('../src/models/CreditRepayment.js');

  const dayTotals = await listRecognizedSalesTotalsByDay([branchId], start, end, { activityFilter: 'all' });
  const dayRows = Array.from(dayTotals.values()).sort((a, b) => a.date.localeCompare(b.date));
  const positiveDays = dayRows.filter((r) => Number(r.total || 0) > 0);
  const negativeDays = dayRows.filter((r) => Number(r.total || 0) < 0);
  const awaitingAmount = round2(positiveDays.reduce((s, r) => s + Number(r.total || 0), 0));
  const sumAll = round2(dayRows.reduce((s, r) => s + Number(r.total || 0), 0));

  console.log('\n=== PENDING DEPOSIT SOURCE ===');
  console.log({
    dayCount: dayRows.length,
    awaitingAmountPositiveDaysOnly: awaitingAmount,
    sumAllIncludingNegative: sumAll,
    negativeDays: negativeDays.map((r) => ({ date: r.date, total: round2(r.total) }))
  });
  console.log('DAY\tTOTAL\tBREAKDOWN');
  for (const row of dayRows) {
    console.log(`${row.date}\t${round2(row.total)}\t${JSON.stringify(row.paymentBreakdown || {})}`);
  }

  const sales = await db.collection('sales').find({
    branchId,
    created_at: { $gte: start, $lte: end }
  }).toArray();

  const refundsInPeriod = await db.collection('refundrequests').find({
    branchId,
    status: 'approved',
    approved_at: { $gte: start, $lte: end }
  }).toArray().catch(async () => db.collection('refundRequests').find({
    branchId,
    status: 'approved',
    approved_at: { $gte: start, $lte: end }
  }).toArray());

  // discover collection name
  const collNames = (await db.listCollections().toArray()).map((c) => c.name);
  console.log('\nCOLLECTIONS', collNames.filter((n) => /sale|refund|reconcil|audit|bin|discount|user|branch/i.test(n)));

  const refundColl = collNames.includes('refundrequests')
    ? 'refundrequests'
    : collNames.includes('refundRequests')
      ? 'refundRequests'
      : collNames.find((n) => /refund/i.test(n));

  const approvedRefundsPeriod = refundColl
    ? await db.collection(refundColl).find({
      branchId,
      status: 'approved',
      approved_at: { $gte: start, $lte: end }
    }).toArray()
    : [];

  const saleIds = sales.map((s) => String(s._id));
  const allRefundsForSeptSales = refundColl
    ? await db.collection(refundColl).find({
      status: 'approved',
      saleId: { $in: saleIds }
    }).toArray()
    : [];

  const refundedSaleIds = new Set(allRefundsForSeptSales.map((r) => String(r.saleId)));
  const nonRefundedSales = sales.filter((s) => !refundedSaleIds.has(String(s._id)));
  const refundedSales = sales.filter((s) => refundedSaleIds.has(String(s._id)));

  const salesGross = round2(sales.reduce((s, x) => s + Number(x.total || 0), 0));
  const collectedLikeSalesPage = round2(nonRefundedSales.reduce((s, x) => s + Number(x.total || 0), 0));
  const refundRequested = round2(approvedRefundsPeriod.reduce((s, x) => s + Math.abs(Number(x.requestedAmount || 0)), 0));
  const refundCash = round2(approvedRefundsPeriod.reduce((s, x) => {
    const cash = Number(x.cashRefundAmount);
    if (Number.isFinite(cash) && cash > 0) return s + Math.abs(cash);
    return s + Math.abs(Number(x.requestedAmount || 0));
  }, 0));

  console.log('\n=== SALES vs PENDING ===');
  console.log({
    salesCount: sales.length,
    salesGross,
    collectedLikeSalesPageExcludingRefundedSales: collectedLikeSalesPage,
    refundedSalesCount: refundedSales.length,
    refundedSalesGross: round2(refundedSales.reduce((s, x) => s + Number(x.total || 0), 0)),
    refundsInPeriod: approvedRefundsPeriod.length,
    refundRequested,
    refundCash,
    pendingDeposit: awaitingAmount,
    pendingMinusCollected: round2(awaitingAmount - collectedLikeSalesPage),
    pendingMinusGross: round2(awaitingAmount - salesGross),
    grossMinusRefundCash: round2(salesGross - refundCash),
    expectedUiCollected: 125546,
    expectedUiPending: 127636,
    expectedUiRefunded: 5406
  });

  console.log('\n=== REFUNDED SALES DETAIL ===');
  for (const sale of refundedSales) {
    const saleRefunds = allRefundsForSeptSales.filter((r) => String(r.saleId) === String(sale._id));
    console.log(JSON.stringify({
      saleId: String(sale._id),
      invoice: sale.invoiceSerial || sale.receiptNumber,
      created_at: sale.created_at,
      total: sale.total,
      sellerName: sale.sellerName,
      sellerId: sale.sellerId || sale.userId,
      customerName: sale.customerName,
      discount: sale.discount ?? sale.discountTotal ?? sale.discountAmount,
      payment_methods: sale.payment_methods,
      refunds: saleRefunds.map((r) => ({
        id: String(r._id),
        type: r.type,
        requestedAmount: r.requestedAmount,
        cashRefundAmount: r.cashRefundAmount,
        settlementMode: r.settlementMode,
        approved_at: r.approved_at,
        approvedByName: r.approvedByName || r.approved_by_name,
        requestedByName: r.requestedByName || r.requested_by_name || r.createdByName
      }))
    }, null, 2));
  }

  console.log('\n=== ALL APPROVED REFUNDS IN SEPT ===');
  for (const r of approvedRefundsPeriod) {
    console.log(JSON.stringify({
      id: String(r._id),
      saleId: r.saleId,
      invoice: r.invoiceSerial,
      type: r.type,
      requestedAmount: r.requestedAmount,
      cashRefundAmount: r.cashRefundAmount,
      settlementMode: r.settlementMode,
      approved_at: r.approved_at,
      approvedByName: r.approvedByName || r.approved_by_name,
      requestedByName: r.requestedByName || r.requested_by_name || r.createdByName
    }));
  }

  const reconColl = collNames.find((n) => /cashreconcil/i.test(n)) || 'cashreconciliations';
  const recons = await db.collection(reconColl).find({ branchId }).toArray().catch(() => []);
  const septRecons = recons.filter((row) => (row.selectedDates || []).some((d) => d >= '2026-09-01' && d <= '2026-09-30'));
  console.log('\n=== RECONS overlapping Sept ===', septRecons.length);
  for (const r of septRecons) {
    console.log(JSON.stringify({
      id: String(r._id),
      status: r.status,
      expectedAmount: r.expectedAmount,
      depositedAmount: r.depositedAmount,
      selectedDates: r.selectedDates,
      createdByName: r.createdByName || r.submittedByName,
      createdAt: r.createdAt
    }));
  }

  const binColl = collNames.find((n) => /superbin|bin/i.test(n));
  if (binColl) {
    const bins = await db.collection(binColl).find({}).sort({ createdAt: -1 }).limit(500).toArray();
    const relevant = bins.filter((row) => {
      const doc = row.document || row.data || row.payload || {};
      const bid = String(doc.branchId || row.branchId || '');
      if (bid && bid !== branchId) return false;
      const kind = String(row.collectionName || row.entityType || row.sourceCollection || '');
      if (kind && !/sale/i.test(kind)) return false;
      return true;
    });
    console.log('\n=== SUPERBIN sales for branch ===', relevant.length);
    for (const row of relevant.slice(0, 80)) {
      const doc = row.document || row.data || row.payload || {};
      const created = doc.created_at ? new Date(doc.created_at) : null;
      const inSept = created && created >= start && created <= end;
      console.log(JSON.stringify({
        id: String(row._id),
        inSeptSaleDate: !!inSept,
        deletedAt: row.createdAt || row.deletedAt,
        deletedBy: row.deletedByName || row.actorName || row.userName || row.performedByName,
        invoice: doc.invoiceSerial || doc.receiptNumber,
        total: doc.total,
        created_at: doc.created_at,
        sellerName: doc.sellerName
      }));
    }
  }

  const auditColl = collNames.find((n) => /^audits$/i.test(n)) || collNames.find((n) => /audit/i.test(n));
  if (auditColl) {
    const audits = await db.collection(auditColl).find({
      createdAt: { $gte: new Date(2026, 7, 20), $lte: new Date(2026, 9, 10) }
    }).sort({ createdAt: -1 }).limit(400).toArray();
    const interesting = audits.filter((a) => {
      const blob = JSON.stringify(a).toLowerCase();
      return /refund|delete|discount|reconcil|sale/.test(blob) && (/dambai|branch/.test(blob) || String(a.branchId || '') === branchId || true);
    });
    console.log('\n=== AUDITS window ===', interesting.length);
    for (const a of interesting.slice(0, 100)) {
      console.log(JSON.stringify({
        at: a.createdAt,
        action: a.action || a.type,
        entity: a.entity || a.entityType,
        actor: a.actorName || a.userName || a.performedByName || a.username,
        branchId: a.branchId,
        summary: (a.summary || a.message || '').toString().slice(0, 180),
        details: typeof a.details === 'object' ? {
          invoice: a.details?.invoiceSerial || a.details?.invoice,
          total: a.details?.total || a.details?.amount,
          saleId: a.details?.saleId
        } : String(a.details || '').slice(0, 180)
      }));
    }
  }

  const discountColl = collNames.find((n) => /discount/i.test(n));
  if (discountColl) {
    const discounts = await db.collection(discountColl).find({
      $or: [
        { createdAt: { $gte: start, $lte: end } },
        { approvedAt: { $gte: start, $lte: end } },
        { created_at: { $gte: start, $lte: end } }
      ]
    }).toArray();
    const branchDiscounts = discounts.filter((d) => !d.branchId || String(d.branchId) === branchId);
    console.log('\n=== DISCOUNTS ===', branchDiscounts.length);
    for (const d of branchDiscounts.slice(0, 60)) {
      console.log(JSON.stringify({
        id: String(d._id),
        status: d.status,
        amount: d.amount || d.discountAmount || d.requestedAmount || d.discount,
        requestedByName: d.requestedByName,
        approvedByName: d.approvedByName,
        createdAt: d.createdAt || d.created_at,
        approvedAt: d.approvedAt || d.approved_at,
        invoice: d.invoiceSerial,
        branchId: d.branchId
      }));
    }
  }

  const users = await db.collection('users').find({}).project({ name: 1, username: 1, role: 1, branchId: 1 }).toArray();
  console.log('\n=== USERS ===');
  console.log(users.map((u) => ({ id: String(u._id), name: u.name, username: u.username, role: u.role, branchId: u.branchId })));

  const bySeller = new Map();
  for (const s of sales) {
    const key = String(s.sellerName || s.sellerId || 'unknown');
    if (!bySeller.has(key)) bySeller.set(key, { seller: key, count: 0, total: 0 });
    const row = bySeller.get(key);
    row.count += 1;
    row.total += Number(s.total || 0);
  }
  console.log('\n=== SALES BY SELLER ===');
  console.log(Array.from(bySeller.values()).map((r) => ({ ...r, total: round2(r.total) })).sort((a, b) => b.total - a.total));

  // Sales with discounts in Sept
  const discounted = sales.filter((s) => Number(s.discount || s.discountTotal || s.discountAmount || 0) > 0
    || (Array.isArray(s.items) && s.items.some((it) => Number(it.discount || 0) > 0)));
  console.log('\n=== DISCOUNTED SALES COUNT ===', discounted.length);
  console.log('discounted total', round2(discounted.reduce((s, x) => s + Number(x.total || 0), 0)));
  for (const s of discounted.slice(0, 40)) {
    console.log(JSON.stringify({
      invoice: s.invoiceSerial || s.receiptNumber,
      total: s.total,
      discount: s.discount ?? s.discountTotal ?? s.discountAmount,
      sellerName: s.sellerName,
      created_at: s.created_at
    }));
  }

  // Compare: if sales page excludes refunded sales entirely, remaining of refunded sales in pending = sale - refundCash
  const gapFromRefundExclusions = refundedSales.map((sale) => {
    const saleRefunds = allRefundsForSeptSales.filter((r) => String(r.saleId) === String(sale._id));
    const cash = round2(saleRefunds.reduce((s, r) => {
      const c = Number(r.cashRefundAmount);
      if (Number.isFinite(c) && c > 0) return s + Math.abs(c);
      return s + Math.abs(Number(r.requestedAmount || 0));
    }, 0));
    return {
      invoice: sale.invoiceSerial || sale.receiptNumber,
      saleTotal: Number(sale.total || 0),
      refundCash: cash,
      keptInPending: round2(Number(sale.total || 0) - cash),
      sellerName: sale.sellerName,
      created_at: sale.created_at
    };
  });
  console.log('\n=== REFUND EXCLUSION GAP MATH ===');
  console.log(JSON.stringify(gapFromRefundExclusions, null, 2));
  console.log({
    sumKeptInPending: round2(gapFromRefundExclusions.reduce((s, r) => s + r.keptInPending, 0)),
    sumSaleTotalExcludedFromSalesPage: round2(gapFromRefundExclusions.reduce((s, r) => s + r.saleTotal, 0)),
    sumRefundCash: round2(gapFromRefundExclusions.reduce((s, r) => s + r.refundCash, 0))
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
