import 'dotenv/config';
import mongoose from 'mongoose';
import { listRecognizedSalesTotalsByDay } from '../src/utils/saleAccounting.js';

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'db_EBK' });
  await import('../src/models/Sale.js');
  await import('../src/models/RefundRequest.js');
  await import('../src/models/CreditSale.js');
  await import('../src/models/CreditRepayment.js');

  const branchId = '-uvolneQronrD9XXasqhA';
  const start = new Date(2026, 8, 1, 0, 0, 0, 0);
  const end = new Date(2026, 8, 30, 23, 59, 59, 999);

  const oldStyle = await listRecognizedSalesTotalsByDay([branchId], start, end, { activityFilter: 'all' });
  const oldBug = round2(Array.from(oldStyle.values()).filter((r) => Number(r.total) > 0).reduce((s, r) => s + Number(r.total), 0));
  const oldNet = round2(Array.from(oldStyle.values()).reduce((s, r) => s + Number(r.total), 0));

  const fixed = await listRecognizedSalesTotalsByDay([branchId], start, end, {
    activityFilter: 'all',
    refundAttribution: 'unreconciled_sale_date',
    coveredApproved: new Set()
  });
  const fixedAwaiting = round2(Math.max(0, Array.from(fixed.values()).filter((r) => Math.abs(Number(r.total)) >= 0.005).reduce((s, r) => s + Number(r.total), 0)));

  console.log(JSON.stringify({
    oldBugPositiveOnly: oldBug,
    oldNetIncludingNegatives: oldNet,
    fixedAwaiting,
    expectedUiSales: 125546,
    expectedOldPendingBug: 127636,
    fixedMatchesSales: fixedAwaiting === 125546
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
