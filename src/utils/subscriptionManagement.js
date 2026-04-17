import { modelFor as SettingsModelFor } from '../models/Settings.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';
import { ALL_FEATURES, PLAN_FEATURES } from '../config/tenantAccess.js';

const SUBSCRIPTION_MANAGEMENT_KEY = 'subscription_management';

function slugifyPlanKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'plan';
}

function roundMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
}

export function calculateDiscountedAmount(monthlyAmount, months, discountPercent = 0) {
  const base = Number(monthlyAmount || 0) * Number(months || 0);
  const discount = Number(discountPercent || 0);
  return roundMoney(base - ((base * discount) / 100));
}

export function calculateDiscountPercentFromAmount(monthlyAmount, months, amount) {
  const base = Number(monthlyAmount || 0) * Number(months || 0);
  const total = Number(amount || 0);
  if (!base || !Number.isFinite(total)) return 0;
  return Number((((base - total) / base) * 100).toFixed(4));
}

function defaultPlans() {
  return [
    { key: 'basic', label: 'Basic', monthlyAmount: 0, features: PLAN_FEATURES.basic || [] },
    { key: 'pro', label: 'Pro', monthlyAmount: 0, features: PLAN_FEATURES.pro || [] },
    { key: 'enterprise', label: 'Enterprise', monthlyAmount: 0, features: PLAN_FEATURES.enterprise || ALL_FEATURES.slice() }
  ];
}

function defaultPeriods() {
  return [
    { months: 1, discountPercent: 0 },
    { months: 3, discountPercent: 0 },
    { months: 6, discountPercent: 0 },
    { months: 12, discountPercent: 0 }
  ];
}

function normalizePlan(plan = {}, existingKeys = new Set()) {
  let key = slugifyPlanKey(plan.key || plan.label);
  let suffix = 2;
  while (existingKeys.has(key)) {
    key = `${key}_${suffix}`;
    suffix += 1;
  }
  existingKeys.add(key);
  const label = String(plan.label || key).trim() || key;
  const monthlyAmount = plan.monthlyAmount === '' || plan.monthlyAmount == null ? 0 : roundMoney(plan.monthlyAmount);
  const features = Array.isArray(plan.features) ? plan.features.map((item) => String(item || '').trim()).filter((item) => ALL_FEATURES.includes(item)) : [];
  return { key, label, monthlyAmount, features };
}

function normalizePeriod(period = {}) {
  const months = Math.max(1, Number(period.months || 0));
  const discountPercent = Number(period.discountPercent || 0);
  return {
    months,
    discountPercent: Number.isFinite(discountPercent) ? discountPercent : 0
  };
}

export async function getSubscriptionManagementConfig(masterConn) {
  const Settings = SettingsModelFor(masterConn);
  const doc = await Settings.findOne({ key: SUBSCRIPTION_MANAGEMENT_KEY });
  const rawPlans = Array.isArray(doc?.data?.plans) && doc.data.plans.length > 0 ? doc.data.plans : defaultPlans();
  const rawPeriods = Array.isArray(doc?.data?.periods) && doc.data.periods.length > 0 ? doc.data.periods : defaultPeriods();
  const keySet = new Set();
  const plans = rawPlans.map((plan) => normalizePlan(plan, keySet));
  const periods = rawPeriods.map(normalizePeriod).sort((a, b) => a.months - b.months);
  return { plans, periods };
}

export async function saveSubscriptionManagementConfig(masterConn, payload = {}) {
  const Settings = SettingsModelFor(masterConn);
  const keySet = new Set();
  const plans = (Array.isArray(payload.plans) ? payload.plans : defaultPlans()).map((plan) => normalizePlan(plan, keySet));
  const periods = (Array.isArray(payload.periods) ? payload.periods : defaultPeriods()).map(normalizePeriod).sort((a, b) => a.months - b.months);
  const monthValues = periods.map((period) => Number(period.months));
  if (new Set(monthValues).size !== monthValues.length) {
    throw new Error('Duplicate month rows are not allowed');
  }

  const TenantModel = TenantModelFor(masterConn);
  const existingConfig = await getSubscriptionManagementConfig(masterConn);
  const removedPlans = existingConfig.plans.map((plan) => plan.key).filter((key) => !plans.some((plan) => plan.key === key));
  if (removedPlans.length > 0) {
    const inUse = await TenantModel.exists({ subscriptionPlan: { $in: removedPlans } });
    if (inUse) throw new Error('Cannot remove a plan that is already assigned to a tenant');
  }

  await Settings.findOneAndUpdate(
    { key: SUBSCRIPTION_MANAGEMENT_KEY },
    { key: SUBSCRIPTION_MANAGEMENT_KEY, data: { plans, periods } },
    { upsert: true, new: true }
  );
  return { plans, periods };
}

export async function resolveSubscriptionPlan(masterConn, planKey) {
  const config = await getSubscriptionManagementConfig(masterConn);
  const wanted = String(planKey || '').trim().toLowerCase();
  return config.plans.find((plan) => plan.key === wanted) || config.plans[0] || defaultPlans()[0];
}

export async function getEffectiveMonthlyAmount(masterConn, tenantDoc) {
  const tenantAmount = tenantDoc?.subscriptionAmount;
  if (tenantAmount != null && tenantAmount !== '') return roundMoney(tenantAmount);
  const plan = await resolveSubscriptionPlan(masterConn, tenantDoc?.subscriptionPlan);
  return roundMoney(plan?.monthlyAmount || 0);
}

export async function getSubscriptionPeriodsForAmount(masterConn, monthlyAmount) {
  const config = await getSubscriptionManagementConfig(masterConn);
  return config.periods.map((period) => ({
    ...period,
    amount: calculateDiscountedAmount(monthlyAmount, period.months, period.discountPercent)
  }));
}
