import 'dotenv/config';
import mongoose from 'mongoose';
import { getTenantConnection } from '../src/config/tenancy.js';
import { modelFor as BranchModelFor } from '../src/models/Branch.js';
import { modelFor as ProductModelFor } from '../src/models/Product.js';
import { modelFor as AuditModelFor } from '../src/models/Audit.js';

const TENANT_ID = 'EBK';
const TARGET_PRODUCTS = [
  {
    name: 'TECNO POP 20',
    sku: 'KN3 64GB',
    targetFixes: {
      warehouseStockByBranch: { '6WpAZoaymxgP2dRyU8PFp': 330 },
      wholesaleStockByBranch: { 'iaPCJ0Jzx32Ph0VjsWEMr': 17 }
    },
    evidence: {
      warehousePurchases: [210, 210],
      warehouseTransfersOut: [90],
      warehouseAdjustments: [],
      wholesaleSales: [5, 1, 1, 10, 2, 2, 10, 6, 10, 2, 2, 5, 17]
    }
  },
  {
    name: 'TECNO POP 20',
    sku: 'KN3 128GB',
    targetFixes: {
      warehouseStockByBranch: { '6WpAZoaymxgP2dRyU8PFp': 185 },
      wholesaleStockByBranch: { 'iaPCJ0Jzx32Ph0VjsWEMr': 44 }
    },
    evidence: {
      warehousePurchases: [115, 115],
      warehouseTransfersOut: [45],
      warehouseAdjustments: [],
      wholesaleSales: [1]
    }
  },
  {
    name: 'TECNO SPARK 50',
    sku: 'KN4 128GB',
    targetFixes: {
      warehouseStockByBranch: { '6WpAZoaymxgP2dRyU8PFp': 215 },
      wholesaleStockByBranch: { 'iaPCJ0Jzx32Ph0VjsWEMr': 104 }
    },
    evidence: {
      warehousePurchases: [435],
      warehouseTransfersOut: [220],
      warehouseAdjustments: [],
      wholesaleSales: [5, 6, 4, 14, 10, 1, 10, 1, 10, 20, 20, 1, 5, 3, 1, 1, 2, 1, 1]
    }
  },
  {
    name: 'INFINIX SMART 20',
    sku: 'X6840 64GB',
    targetFixes: {
      warehouseStockByBranch: { '6WpAZoaymxgP2dRyU8PFp': 44 },
      wholesaleStockByBranch: { 'iaPCJ0Jzx32Ph0VjsWEMr': 8 }
    },
    evidence: {
      warehousePurchases: [44, 45],
      warehouseTransfersOut: [44],
      warehouseAdjustments: [-1],
      wholesaleSales: [1, 1, 1, 10, 1, 3, 10, 2, 5, 2]
    }
  }
];

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

  const branchIds = Array.from(new Set(TARGET_PRODUCTS.flatMap((row) => [
    ...Object.keys(row.targetFixes.warehouseStockByBranch || {}),
    ...Object.keys(row.targetFixes.wholesaleStockByBranch || {})
  ])));
  const branches = await Branch.find({ id: { $in: branchIds } }).lean();
  const branchById = new Map(branches.map((branch) => [String(branch.id), branch]));

  const reports = [];
  for (const target of TARGET_PRODUCTS) {
    const product = await Product.findOne({ name: target.name, sku: target.sku });
    if (!product) {
      reports.push({ name: target.name, sku: target.sku, error: 'Product not found' });
      continue;
    }
    const before = {
      stockByBranch: mapToObject(product.stockByBranch),
      wholesaleStockByBranch: mapToObject(product.wholesaleStockByBranch),
      warehouseStockByBranch: mapToObject(product.warehouseStockByBranch)
    };
    const changes = buildChanges(before, target.targetFixes).map((row) => ({
      ...row,
      branchName: branchById.get(String(row.branchId))?.name || row.branchId
    }));
    reports.push({
      productId: product.id || String(product._id),
      name: product.name,
      sku: product.sku,
      evidence: target.evidence,
      before,
      targetFixes: target.targetFixes,
      changes
    });

    if (!applyMode) continue;
    for (const [branchId, value] of Object.entries(target.targetFixes.warehouseStockByBranch || {})) {
      setMapValue(product.warehouseStockByBranch, branchId, Number(value || 0));
    }
    for (const [branchId, value] of Object.entries(target.targetFixes.wholesaleStockByBranch || {})) {
      setMapValue(product.wholesaleStockByBranch, branchId, Number(value || 0));
    }
    product.markModified('warehouseStockByBranch');
    product.markModified('wholesaleStockByBranch');
    await product.save();
  }

  if (applyMode) {
    await Audit.create({
      actor: 'repair-script',
      actionType: 'stock_map_repair_apply',
      details: {
        scope: 'named_products_warehouse_wholesale_only',
        tenantId: TENANT_ID,
        repairs: reports.filter((row) => !row.error).map((row) => ({
          productId: row.productId,
          productName: row.name,
          sku: row.sku,
          changes: row.changes
        }))
      },
      remark: 'Applied targeted repair for named EBK warehouse and wholesale stock maps',
      branchId: ''
    });
  }

  console.log(JSON.stringify({
    mode: applyMode ? 'apply' : 'dry-run',
    tenantId: TENANT_ID,
    safety: {
      retailUntouched: true,
      focusedFixOnly: true,
      productCount: TARGET_PRODUCTS.length
    },
    reports
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
