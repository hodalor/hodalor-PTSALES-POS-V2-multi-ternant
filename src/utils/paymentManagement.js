import { modelFor as SettingsModelFor } from '../models/Settings.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';

export const PAYMENT_GATEWAY_CATALOG = [
  { key: 'paypal', label: 'PayPal / Card', description: 'PayPal wallet and eligible card checkout.' },
  { key: 'paystack', label: 'Paystack', description: 'Hosted checkout for card and supported Paystack channels.' },
  { key: 'dpo_pay', label: 'DPO Pay', description: 'Hosted checkout with country-specific mobile money options.' }
];

const DEFAULT_ENABLED_GATEWAYS = PAYMENT_GATEWAY_CATALOG.map((item) => item.key);
const PAYMENT_MANAGEMENT_KEY = 'payment_management';

export function normalizeEnabledGateways(value, { allowEmpty = false } = {}) {
  const allowed = new Set(PAYMENT_GATEWAY_CATALOG.map((item) => item.key));
  const list = Array.isArray(value) ? value.map((item) => String(item || '').trim().toLowerCase()).filter((item) => allowed.has(item)) : [];
  if (list.length > 0) return Array.from(new Set(list));
  return allowEmpty ? [] : DEFAULT_ENABLED_GATEWAYS.slice();
}

export async function getPaymentManagementConfig(masterConn) {
  const Settings = SettingsModelFor(masterConn);
  const doc = await Settings.findOne({ key: PAYMENT_MANAGEMENT_KEY });
  const hasStoredList = Array.isArray(doc?.data?.enabledGateways);
  const enabledGateways = hasStoredList
    ? normalizeEnabledGateways(doc?.data?.enabledGateways, { allowEmpty: true })
    : DEFAULT_ENABLED_GATEWAYS.slice();
  return {
    enabledGateways,
    gateways: PAYMENT_GATEWAY_CATALOG.map((item) => ({ ...item, enabled: enabledGateways.includes(item.key) }))
  };
}

export async function savePaymentManagementConfig(masterConn, payload = {}) {
  const Settings = SettingsModelFor(masterConn);
  const enabledGateways = normalizeEnabledGateways(payload.enabledGateways, { allowEmpty: true });
  await Settings.findOneAndUpdate(
    { key: PAYMENT_MANAGEMENT_KEY },
    { key: PAYMENT_MANAGEMENT_KEY, data: { enabledGateways } },
    { upsert: true, new: true }
  );
  return getPaymentManagementConfig(masterConn);
}

export function inferPaymentChannel(entry = {}) {
  const explicit = String(entry.channel || '').trim().toLowerCase();
  if (explicit) return explicit;
  const method = String(entry.method || '').toLowerCase();
  const network = String(entry.network || '').trim();
  if (network) return 'mobile_money';
  if (method.includes('mobile')) return 'mobile_money';
  if (method.includes('card') || method.includes('paypal')) return 'card';
  if (String(entry.provider || '').toLowerCase() === 'paypal') return 'card';
  return 'other';
}

export function flattenTenantPaymentHistory(tenants = []) {
  return tenants.flatMap((tenant) => {
    const tenantId = String(tenant?.tenantId || '');
    const tenantName = String(tenant?.name || '');
    const rows = Array.isArray(tenant?.paymentHistory) ? tenant.paymentHistory : [];
    return rows.map((entry, index) => ({
      id: `${tenantId}:${entry?.transactionRef || index}:${index}`,
      tenantId,
      tenantName,
      provider: String(entry?.provider || ''),
      method: String(entry?.method || ''),
      channel: inferPaymentChannel(entry),
      status: String(entry?.status || ''),
      transactionRef: String(entry?.transactionRef || ''),
      providerTransactionId: String(entry?.providerTransactionId || ''),
      network: String(entry?.network || ''),
      currencyCode: String(entry?.currencyCode || ''),
      amount: Number(entry?.amount || 0),
      months: Number(entry?.months || 0),
      createdAt: entry?.createdAt || null
    }));
  }).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

export function summarizePayments(rows = []) {
  const totalCollected = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const cardCollected = rows.filter((row) => row.channel === 'card').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const mobileMoneyCollected = rows.filter((row) => row.channel === 'mobile_money').reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return {
    totalCollected,
    transactionCount: rows.length,
    cardCollected,
    mobileMoneyCollected,
    gatewayCount: Array.from(new Set(rows.map((row) => row.provider).filter(Boolean))).length
  };
}

export async function getPaymentManagementDashboard(masterConn) {
  const TenantModel = TenantModelFor(masterConn);
  const tenants = await TenantModel.find({}, { tenantId: 1, name: 1, paymentHistory: 1 }).lean();
  const paymentHistory = flattenTenantPaymentHistory(tenants);
  const config = await getPaymentManagementConfig(masterConn);
  return {
    ...config,
    paymentHistory,
    summary: summarizePayments(paymentHistory)
  };
}
