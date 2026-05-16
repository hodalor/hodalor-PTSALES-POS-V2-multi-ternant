import 'dotenv/config';
import mongoose from 'mongoose';
import { getTenantConnection } from '../src/config/tenancy.js';
import { modelFor as BranchModelFor } from '../src/models/Branch.js';
import { modelFor as ProductModelFor } from '../src/models/Product.js';
import { modelFor as AuditModelFor } from '../src/models/Audit.js';

const TENANT_ID = 'EBK';
const PRODUCT_NAME_REGEX = /philips fun 200/i;
const TARGET_FIXES = {
  warehouseStockByBranch: {
    '6WpAZoaymxgP2dRyU8PFp': 240
  },
  wholesaleStockByBranch: {
    'iaPCJ0Jzx32Ph0VjsWEMr': 128
  }
};

function mapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value.entries());
  return { ...value };
}

function setMapValue(mapLike, key, value) {
  if (typeof mapLike?.set === 'function') {
    mapLike.set(key, value);
    return;
  }
  mapLike[key] = value;
}

function buildChanges(before, target) {
  return Object.entries(target).flatMap(([field, entries]) => {
    const beforeMap = before[field] || {};
    return Object.entries(entries).map(([branchId, nextValue]) => ({
      field,
      branchId,
      before: Number(beforeMap[branchId] || 0),
      after: Number(nextValue || 0),
      deltaToApply: Number(nextValue || 0) - Number(beforeMap[branchId] || 0)
    }));
  });
}

async function main() {
  const applyMode = process.argv.includes('--apply');
  const conn = await getTenantConnection(TENANT_ID);
  const Branch = BranchModelFor(conn);
  const Product = ProductModelFor(conn);
  const Audit = AuditModelFor(conn);

  const product = await Product.findOne({ name: PRODUCT_NAME_REGEX });
  if (!product) throw new Error('PHILIPS FUN 200 not found');

  const branchIds = Array.from(new Set([
    ...Object.keys(TARGET_FIXES.warehouseStockByBranch),
    ...Object.keys(TARGET_FIXES.wholesaleStockByBranch)
  ]));
  const branches = await Branch.find({ id: { $in: branchIds } }).lean();
  const branchById = new Map(branches.map((branch) => [String(branch.id), branch]));

  const before = {
    stockByBranch: mapToObject(product.stockByBranch),
    wholesaleStockByBranch: mapToObject(product.wholesaleStockByBranch),
    warehouseStockByBranch: mapToObject(product.warehouseStockByBranch)
  };
  const changes = buildChanges(before, TARGET_FIXES).map((row) => ({
    ...row,
    branchName: branchById.get(String(row.branchId))?.name || row.branchId
  }));

  const report = {
    mode: applyMode ? 'apply' : 'dry-run',
    tenantId: TENANT_ID,
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku
    },
    safety: {
      retailUntouched: true,
      focusedFixOnly: true
    },
    before,
    targetFixes: TARGET_FIXES,
    changes
  };

  if (!applyMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const [branchId, value] of Object.entries(TARGET_FIXES.warehouseStockByBranch)) {
    setMapValue(product.warehouseStockByBranch, branchId, Number(value || 0));
  }
  for (const [branchId, value] of Object.entries(TARGET_FIXES.wholesaleStockByBranch)) {
    setMapValue(product.wholesaleStockByBranch, branchId, Number(value || 0));
  }
  product.markModified('warehouseStockByBranch');
  product.markModified('wholesaleStockByBranch');
  await product.save();

  await Audit.create({
    actor: 'repair-script',
    actionType: 'stock_map_repair_apply',
    details: {
      productId: product.id || String(product._id),
      productName: product.name,
      sku: product.sku,
      scope: 'warehouse_wholesale_only',
      changes
    },
    remark: 'Applied targeted repair for PHILIPS FUN 200 warehouse and wholesale stock maps',
    branchId: ''
  });

  console.log(JSON.stringify({
    ...report,
    applied: true,
    after: {
      stockByBranch: mapToObject(product.stockByBranch),
      wholesaleStockByBranch: mapToObject(product.wholesaleStockByBranch),
      warehouseStockByBranch: mapToObject(product.warehouseStockByBranch)
    }
  }, null, 2));
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
