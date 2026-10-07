import 'dotenv/config';
import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri, { dbName: 'db_EBK' });
  const db = mongoose.connection.db;
  const branchId = '-uvolneQronrD9XXasqhA';
  const start = new Date(2026, 8, 1);
  const end = new Date(2026, 8, 30, 23, 59, 59, 999);

  const refunds = await db.collection('refundrequests').find({
    branchId,
    status: 'approved',
    approved_at: { $gte: start, $lte: end }
  }).toArray();

  console.log('REFUNDS FULL');
  for (const r of refunds) {
    console.log(JSON.stringify({
      invoice: r.invoiceSerial,
      type: r.type,
      requestedAmount: r.requestedAmount,
      cashRefundAmount: r.cashRefundAmount,
      saleId: r.saleId,
      approved_at: r.approved_at,
      created_at: r.created_at,
      initiatorName: r.initiatorName,
      initiatorRole: r.initiatorRole,
      approverName: r.approverName,
      approverRole: r.approverRole,
      remark: r.remark,
      approvalRemark: r.approvalRemark,
      refundSaleId: r.refundSaleId
    }, null, 2));
  }

  const dayStart = new Date(2026, 8, 20);
  const dayEnd = new Date(2026, 8, 20, 23, 59, 59, 999);
  const sales20 = await db.collection('sales').find({
    branchId,
    created_at: { $gte: dayStart, $lte: dayEnd }
  }).project({ invoiceSerial: 1, total: 1, sellerName: 1, created_at: 1, payment_methods: 1 }).toArray();
  console.log('SALES ON SEPT 20', JSON.stringify(sales20, null, 2));

  // original sale for the 2090 refund
  const sale = await db.collection('sales').findOne({ _id: new mongoose.Types.ObjectId('6a986b2b614bdacfd5711fbf') });
  console.log('ORIGINAL 2090 SALE', JSON.stringify({
    invoice: sale?.invoiceSerial,
    total: sale?.total,
    created_at: sale?.created_at,
    sellerName: sale?.sellerName,
    customerName: sale?.customerName,
    items: sale?.items,
    payment_methods: sale?.payment_methods
  }, null, 2));

  // refund sale records (negative)
  const negSales = await db.collection('sales').find({
    branchId,
    created_at: { $gte: start, $lte: end },
    total: { $lt: 0 }
  }).toArray();
  console.log('NEGATIVE REFUND SALES');
  for (const s of negSales) {
    console.log(JSON.stringify({
      invoice: s.invoiceSerial,
      total: s.total,
      created_at: s.created_at,
      sellerName: s.sellerName,
      relatedSaleId: s.relatedSaleId || s.originalSaleId || s.refundOfSaleId,
      remark: s.remark
    }, null, 2));
  }

  // audits for the specific refund
  const audits = await db.collection('audits').find({
    $or: [
      { 'details.invoiceSerial': 'INV-EBK001-012504' },
      { 'details.invoice': 'INV-EBK001-012504' },
      { 'details.saleId': '6a986b2b614bdacfd5711fbf' },
      { summary: /012504/ },
      { message: /012504/ }
    ]
  }).toArray();
  console.log('AUDITS for 012504', audits.length);
  for (const a of audits) {
    console.log(JSON.stringify({
      at: a.createdAt,
      action: a.action || a.type,
      actor: a.actorName || a.userName || a.performedByName,
      details: a.details
    }, null, 2));
  }

  // broader refund audits in sept
  const refundAudits = await db.collection('audits').find({
    createdAt: { $gte: start, $lte: end },
    $or: [
      { action: /refund/i },
      { type: /refund/i },
      { entity: /refund/i },
      { 'details.type': /refund/i }
    ]
  }).toArray();
  console.log('REFUND AUDITS SEPT', refundAudits.length);
  for (const a of refundAudits) {
    console.log(JSON.stringify({
      at: a.createdAt,
      action: a.action || a.type,
      actor: a.actorName || a.userName || a.performedByName || a.username,
      branchId: a.branchId,
      invoice: a.details?.invoiceSerial || a.details?.invoice,
      amount: a.details?.requestedAmount || a.details?.amount || a.details?.total,
      detailsKeys: a.details ? Object.keys(a.details) : []
    }));
  }

  // Check if Wisdom Agbo is a user (maybe deleted?)
  const wisdom = await db.collection('users').find({ name: /wisdom|agbo/i }).toArray();
  console.log('WISDOM USER', wisdom);

  // Confirm pending formula bug numbers with Ghana TZ (UTC+0) as well
  function dayKeyUTC(d) {
    const dt = new Date(d);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  console.log('Refund 2090 approved local/UTC keys', {
    approved_at: refunds.find((r) => Number(r.requestedAmount) === 2090)?.approved_at,
    utcKey: dayKeyUTC(refunds.find((r) => Number(r.requestedAmount) === 2090)?.approved_at)
  });

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
