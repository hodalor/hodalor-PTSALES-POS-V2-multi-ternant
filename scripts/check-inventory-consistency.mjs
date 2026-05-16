import 'dotenv/config';
import mongoose from 'mongoose';
import { getTenantConnection } from '../src/config/tenancy.js';
import { modelFor as ProductModelFor } from '../src/models/Product.js';
import { modelFor as AuditModelFor } from '../src/models/Audit.js';
import { modelFor as BranchModelFor } from '../src/models/Branch.js';
import { modelFor as PurchaseRequestModelFor } from '../src/models/PurchaseRequest.js';
import { modelFor as TransferRequestModelFor } from '../src/models/TransferRequest.js';
import { modelFor as AdjustmentRequestModelFor } from '../src/models/AdjustmentRequest.js';
import { modelFor as WholesaleOperationModelFor } from '../src/models/WholesaleOperation.js';
import { modelFor as SaleModelFor } from '../src/models/Sale.js';
import { modelFor as RefundRequestModelFor } from '../src/models/RefundRequest.js';
import { buildInventoryConsistencyReport } from '../src/utils/inventoryConsistency.js';

async function main() {
  const tenantId = process.argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1] || 'EBK';
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || '200';
  const mismatchOnly = !process.argv.includes('--include-matches');
  const limit = Math.min(1000, Math.max(1, Number(limitArg || 200)));

  const conn = await getTenantConnection(tenantId);
  const Product = ProductModelFor(conn);
  const Audit = AuditModelFor(conn);
  const Branch = BranchModelFor(conn);
  const PurchaseRequest = PurchaseRequestModelFor(conn);
  const TransferRequest = TransferRequestModelFor(conn);
  const AdjustmentRequest = AdjustmentRequestModelFor(conn);
  const WholesaleOperation = WholesaleOperationModelFor(conn);
  const Sale = SaleModelFor(conn);
  const RefundRequest = RefundRequestModelFor(conn);

  const [products, audits, branches, purchases, transfers, adjustments, wholesaleOperations, sales, refunds] = await Promise.all([
    Product.find({}).lean(),
    Audit.find({}).sort({ ts: -1 }).limit(20000).lean(),
    Branch.find({}).lean(),
    PurchaseRequest.find({ status: 'approved' }).lean(),
    TransferRequest.find({ status: 'approved' }).lean(),
    AdjustmentRequest.find({ status: 'approved' }).lean(),
    WholesaleOperation.find({ status: 'approved' }).lean(),
    Sale.find({}).lean(),
    RefundRequest.find({ approved_at: { $ne: null }, restockMode: { $ne: 'none' } }).lean()
  ]);

  const report = buildInventoryConsistencyReport({ products, audits, branches, purchases, transfers, adjustments, wholesaleOperations, sales, refunds, mismatchOnly, limit });
  console.log(JSON.stringify({ tenantId, ...report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch {}
  });
