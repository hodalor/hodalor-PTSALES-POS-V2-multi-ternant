import { z } from 'zod';
import { zLooseBoolean, zLooseNumber } from './logOnlyValidation.js';

const requiredIdSchema = z.union([z.string(), z.number()]).transform((value) => String(value || '').trim()).refine((value) => value.length > 0, 'id is required');

const saleItemSchema = z.object({
  productId: requiredIdSchema,
  qty: zLooseNumber.refine((value) => Number.isFinite(value) && value > 0, 'qty must be greater than zero'),
  variantId: z.optional(z.union([z.string(), z.number()])).transform((value) => String(value || '').trim()),
  price: z.optional(zLooseNumber),
  requestedPrice: z.optional(zLooseNumber),
  soldUnitIds: z.optional(z.array(z.union([z.string(), z.number()])).default([])),
  unitIds: z.optional(z.array(z.union([z.string(), z.number()])).default([]))
}).passthrough();

export const saleCreateSchema = z.object({
  branchId: requiredIdSchema,
  items: z.array(saleItemSchema).min(1),
  clientId: z.optional(z.union([z.string(), z.number()])),
  posType: z.optional(z.union([z.string(), z.number()])),
  inventoryType: z.optional(z.union([z.string(), z.number()])),
  customerId: z.optional(z.union([z.string(), z.number()])),
  discountApprovalId: z.optional(z.union([z.string(), z.number()])),
  discount: z.optional(zLooseNumber),
  total: z.optional(zLooseNumber),
  subtotal: z.optional(zLooseNumber),
  payment_methods: z.optional(z.array(z.object({
    type: z.optional(z.union([z.string(), z.number()])),
    amount: z.optional(zLooseNumber)
  }).passthrough())),
  creditSale: z.optional(z.object({
    enabled: z.optional(zLooseBoolean),
    amountPaidNow: z.optional(zLooseNumber)
  }).passthrough())
}).passthrough();

export const creditRepaymentCreateSchema = z.object({
  creditSaleId: requiredIdSchema,
  amount: zLooseNumber.refine((value) => Number.isFinite(value) && value > 0, 'amount must be greater than zero'),
  paymentMethod: z.optional(z.union([z.string(), z.number()])),
  remark: z.optional(z.union([z.string(), z.number()])),
  paidAt: z.optional(z.union([z.string(), z.date()])),
  clientId: z.optional(z.union([z.string(), z.number()]))
}).passthrough();

const productVariantSchema = z.object({
  label: z.optional(z.union([z.string(), z.number()])),
  sku: z.optional(z.union([z.string(), z.number()])),
  price: z.optional(zLooseNumber),
  retailPrice: z.optional(zLooseNumber),
  wholesalePrice: z.optional(zLooseNumber),
  warehousePrice: z.optional(zLooseNumber),
  agentPrice: z.optional(zLooseNumber),
  costPrice: z.optional(zLooseNumber),
  stockByBranch: z.optional(z.record(z.any())),
  wholesaleStockByBranch: z.optional(z.record(z.any())),
  warehouseStockByBranch: z.optional(z.record(z.any()))
}).passthrough();

export const productWriteSchema = z.object({
  name: z.optional(z.union([z.string(), z.number()])),
  sku: z.optional(z.union([z.string(), z.number()])),
  brand: z.optional(z.union([z.string(), z.number()])),
  price: z.optional(zLooseNumber),
  retailPrice: z.optional(zLooseNumber),
  wholesalePrice: z.optional(zLooseNumber),
  warehousePrice: z.optional(zLooseNumber),
  agentPrice: z.optional(zLooseNumber),
  costPrice: z.optional(zLooseNumber),
  lowStock: z.optional(zLooseNumber),
  wholesaleLowStock: z.optional(zLooseNumber),
  warehouseLowStock: z.optional(zLooseNumber),
  minimumCreditPercentage: z.optional(zLooseNumber),
  allowCredit: z.optional(zLooseBoolean),
  trackType: z.optional(z.union([z.string(), z.number()])),
  stockByBranch: z.optional(z.record(z.any())),
  wholesaleStockByBranch: z.optional(z.record(z.any())),
  warehouseStockByBranch: z.optional(z.record(z.any())),
  variants: z.optional(z.array(productVariantSchema))
}).passthrough();

export const renewalStartSchema = z.object({
  months: zLooseNumber.refine((value) => Number.isFinite(value) && value > 0, 'months must be greater than zero'),
  method: z.optional(z.union([z.string(), z.number()])),
  returnUrl: z.optional(z.union([z.string(), z.number()]))
}).passthrough();

export const limitUpgradeStartSchema = z.object({
  resourceType: z.union([z.string(), z.number()]).transform((value) => String(value || '').trim().toLowerCase()),
  quantity: zLooseNumber.refine((value) => Number.isFinite(value) && value > 0, 'quantity must be greater than zero'),
  method: z.optional(z.union([z.string(), z.number()])),
  returnUrl: z.optional(z.union([z.string(), z.number()]))
}).passthrough();
