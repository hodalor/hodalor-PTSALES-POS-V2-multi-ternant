import { modelFor as SettingsModelFor } from '../models/Settings.js';
import { ACTIVATION_EXTENSION_DAYS, buildRenewalHistoryEntry, computeExtendedSubscriptionDate, normalizeSubscriptionAmount, refreshTenantActivationCode, syncTenantSubscriptionSnapshot } from './tenantActivation.js';
import { sendActivationCodeEmail } from './mailer.js';
import { modelFor as TenantModelFor } from '../models/Tenant.js';
import { getEffectiveMonthlyAmount, getSubscriptionManagementConfig, getSubscriptionPeriodsForAmount } from './subscriptionManagement.js';

export const MOBILE_MONEY_NETWORKS = {
  GH: ['MTN', 'AIRTELTIGO', 'TELECEL'],
  ZM: ['AIRTEL', 'MTN', 'ZAMTEL'],
  MW: ['AIRTEL', 'TNM']
};

export function normalizeCountryCode(value) {
  const code = String(value || 'GH').trim().toUpperCase();
  return MOBILE_MONEY_NETWORKS[code] ? code : 'GH';
}

export function getMobileMoneyNetworks(countryCode) {
  return MOBILE_MONEY_NETWORKS[normalizeCountryCode(countryCode)] || [];
}

export async function getTenantRenewalInfo(conn, tenantDoc) {
  const Settings = SettingsModelFor(conn);
  const settings = await Settings.findOne({ key: 'default' }).lean();
  const currencies = Array.isArray(settings?.data?.currencies) ? settings.data.currencies : [];
  const activeCurrencyCode = String(settings?.data?.activeCurrencyCode || settings?.data?.currencyCode || 'GHS');
  const selected = currencies.find((item) => String(item.code) === activeCurrencyCode) || currencies[0] || null;
  const masterConn = tenantDoc?._masterConn;
  const subscriptionAmount = masterConn
    ? await getEffectiveMonthlyAmount(masterConn, tenantDoc)
    : normalizeSubscriptionAmount(tenantDoc?.subscriptionAmount);
  const periods = masterConn
    ? await getSubscriptionPeriodsForAmount(masterConn, subscriptionAmount)
    : [];
  return {
    tenantId: String(tenantDoc?.tenantId || ''),
    tenantName: String(tenantDoc?.name || ''),
    expired: !tenantDoc?.subscriptionPermanent && !!tenantDoc?.subscriptionExpiresAt && new Date(tenantDoc.subscriptionExpiresAt).getTime() <= Date.now(),
    currencyCode: String(selected?.code || activeCurrencyCode || 'GHS'),
    currencySymbol: String(selected?.symbol || settings?.data?.currencySymbol || ''),
    currencyPosition: String(selected?.position || settings?.data?.currencyPosition || 'prefix'),
    subscriptionAmount,
    billingEmail: String(tenantDoc?.billingEmail || ''),
    billingPhone: String(tenantDoc?.billingPhone || ''),
    billingAddress: String(tenantDoc?.billingAddress || ''),
    billingCountry: normalizeCountryCode(tenantDoc?.billingCountry),
    periods
  };
}

export async function calculateRenewalAmount(masterConn, tenantDoc, months, fallbackAmount) {
  const amount = normalizeSubscriptionAmount(fallbackAmount != null ? fallbackAmount : await getEffectiveMonthlyAmount(masterConn, tenantDoc));
  const config = await getSubscriptionManagementConfig(masterConn);
  const period = Number(months || 0);
  const periodRow = (config.periods || []).find((item) => Number(item.months) === period);
  if (!amount || !periodRow) return null;
  const total = Number(amount || 0) * period;
  return Number((total - ((total * Number(periodRow.discountPercent || 0)) / 100)).toFixed(2));
}

function calculateRenewalAmountFromInfo(info, months) {
  const period = (Array.isArray(info?.periods) ? info.periods : []).find((item) => Number(item.months) === Number(months || 0));
  return period ? Number(period.amount || 0) : null;
}

function normalizeAddonResourceType(value) {
  return String(value || '').trim().toLowerCase() === 'branch' ? 'branch' : 'user';
}

function normalizeAddonQuantity(value) {
  const qty = Math.floor(Number(value || 0));
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

function getAddonRate(config, resourceType) {
  const addOns = config?.addOns || {};
  return resourceType === 'branch'
    ? Number(addOns.additionalBranchRate || 0)
    : Number(addOns.additionalUserRate || 0);
}

function getTenantAddonPricing(config, tenantDoc = {}) {
  const globalUserRate = Number(config?.addOns?.additionalUserRate || 0);
  const globalBranchRate = Number(config?.addOns?.additionalBranchRate || 0);
  const tenantUserRate = Number(tenantDoc?.additionalUserRateOverride);
  const tenantBranchRate = Number(tenantDoc?.additionalBranchRateOverride);
  return {
    additionalUserRate: Number.isFinite(tenantUserRate) && tenantUserRate >= 0 ? tenantUserRate : globalUserRate,
    additionalBranchRate: Number.isFinite(tenantBranchRate) && tenantBranchRate >= 0 ? tenantBranchRate : globalBranchRate
  };
}

function calculateAddonAmount(config, resourceType, quantity) {
  const rate = getAddonRate(config, resourceType);
  const qty = normalizeAddonQuantity(quantity);
  if (!rate || !qty) return null;
  return Number((rate * qty).toFixed(2));
}

function resolveLimitUpgradeRedirectUrl(payload = {}) {
  const explicit = String(payload.returnUrl || '').trim();
  if (/^https?:\/\//i.test(explicit)) return explicit;
  return String(process.env.TENANT_LIMIT_PAYMENT_REDIRECT_URL || process.env.RENEWAL_PAYMENT_REDIRECT_URL || '').trim();
}

function parseAddonTxRef(value) {
  const parts = String(value || '').split('_');
  if (parts.length < 7 || parts[0] !== 'limit' || parts[1] !== 'addon') return null;
  return {
    tenantId: parts[2] || '',
    resourceType: normalizeAddonResourceType(parts[3]),
    quantity: normalizeAddonQuantity(parts[4]),
    channel: String(parts[5] || 'card'),
    raw: String(value || '')
  };
}

async function getTenantBillingContext(conn, tenantDoc) {
  const Settings = SettingsModelFor(conn);
  const settings = await Settings.findOne({ key: 'default' }).lean();
  const currencies = Array.isArray(settings?.data?.currencies) ? settings.data.currencies : [];
  const activeCurrencyCode = String(settings?.data?.activeCurrencyCode || settings?.data?.currencyCode || 'GHS');
  const selected = currencies.find((item) => String(item.code) === activeCurrencyCode) || currencies[0] || null;
  return {
    currencyCode: String(selected?.code || activeCurrencyCode || 'GHS'),
    currencySymbol: String(selected?.symbol || settings?.data?.currencySymbol || ''),
    currencyPosition: String(selected?.position || settings?.data?.currencyPosition || 'prefix'),
    billingEmail: String(tenantDoc?.billingEmail || ''),
    billingPhone: String(tenantDoc?.billingPhone || ''),
    billingAddress: String(tenantDoc?.billingAddress || ''),
    billingCountry: normalizeCountryCode(tenantDoc?.billingCountry)
  };
}

export async function getTenantLimitUpgradeInfo(conn, tenantDoc, usageSummary = null) {
  const billing = await getTenantBillingContext(conn, tenantDoc);
  const masterConn = tenantDoc?._masterConn;
  const config = masterConn ? await getSubscriptionManagementConfig(masterConn) : { addOns: {} };
  const addOnPricing = getTenantAddonPricing(config, tenantDoc);
  return {
    tenantId: String(tenantDoc?.tenantId || ''),
    tenantName: String(tenantDoc?.name || ''),
    ...billing,
    addOnPricing,
    usage: usageSummary?.usage || null,
    limits: usageSummary?.limits || null
  };
}

function getPayPalBaseUrl() {
  const explicit = String(process.env.PAYPAL_API_BASE || '').trim();
  if (explicit) return explicit;
  const mode = String(process.env.PAYPAL_MODE || 'sandbox').trim().toLowerCase();
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function getPayPalAccessToken() {
  const clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('PayPal is not configured yet');
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.access_token) throw new Error(json?.error_description || 'Failed to authenticate PayPal');
  return json.access_token;
}

function getPaystackBaseUrl() {
  const explicit = String(process.env.PAYSTACK_API_BASE || '').trim();
  return explicit || 'https://api.paystack.co';
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function readXmlTag(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function splitCustomerName(value) {
  const raw = String(value || '').trim();
  if (!raw) return { firstName: 'Tenant', lastName: 'Admin' };
  const parts = raw.split(/\s+/);
  return {
    firstName: parts[0] || 'Tenant',
    lastName: parts.slice(1).join(' ') || 'Admin'
  };
}

export async function createDpoRenewalPayment(info, payload = {}) {
  const companyToken = String(process.env.DPO_COMPANY_TOKEN || '').trim();
  const serviceType = String(process.env.DPO_SERVICE_TYPE || '').trim();
  const apiUrl = String(process.env.DPO_API_URL || 'https://secure.3gdirectpay.com/API/v6/').trim();
  const paymentUrl = String(process.env.DPO_PAYMENT_URL || 'https://secure.3gdirectpay.com/payv2.php').trim();
  const ptl = String(process.env.DPO_PTL || '15').trim();
  if (!companyToken || !serviceType) throw new Error('Payment provider is not configured yet');
  const amount = calculateRenewalAmountFromInfo(info, payload.months);
  if (!amount) throw new Error('Invalid renewal period or subscription amount');
  const channel = String(payload.method || 'card').trim().toLowerCase() === 'mobile_money' ? 'mobile_money' : 'card';
  const txRef = `renewal_${info.tenantId}_${payload.months}_${channel}_${Date.now()}`;
  const redirectUrl = String(process.env.RENEWAL_PAYMENT_REDIRECT_URL || '').trim();
  if (!redirectUrl) throw new Error('Missing renewal payment redirect URL');
  const { firstName, lastName } = splitCustomerName(payload.customerName || info.tenantName || info.tenantId);
  const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${xmlEscape(companyToken)}</CompanyToken>
  <Request>createToken</Request>
  <Transaction>
    <PaymentAmount>${xmlEscape(amount)}</PaymentAmount>
    <PaymentCurrency>${xmlEscape(info.currencyCode)}</PaymentCurrency>
    <CompanyRef>${xmlEscape(txRef)}</CompanyRef>
    <RedirectURL>${xmlEscape(redirectUrl)}</RedirectURL>
    <BackURL>${xmlEscape(redirectUrl)}</BackURL>
    <CompanyRefUnique>1</CompanyRefUnique>
    <PTL>${xmlEscape(ptl)}</PTL>
  </Transaction>
  <Services>
    <Service>
      <ServiceType>${xmlEscape(serviceType)}</ServiceType>
      <ServiceDescription>${xmlEscape(`${info.tenantName || info.tenantId} Subscription Renewal`)}</ServiceDescription>
      <ServiceDate>${xmlEscape(new Date().toISOString().slice(0, 10))}</ServiceDate>
    </Service>
  </Services>
  <customerFirstName>${xmlEscape(firstName)}</customerFirstName>
  <customerLastName>${xmlEscape(lastName)}</customerLastName>
  <customerEmail>${xmlEscape(payload.email || info.billingEmail || 'billing@example.com')}</customerEmail>
  <customerPhone>${xmlEscape(payload.phone || info.billingPhone || '')}</customerPhone>
  <customerAddress>${xmlEscape(payload.address || info.billingAddress || '')}</customerAddress>
  <customerCity>${xmlEscape(info.tenantName || 'City')}</customerCity>
  <customerCountry>${xmlEscape(info.billingCountry || 'GH')}</customerCountry>
  <customerZip>00000</customerZip>
</API3G>`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml'
    },
    body: requestXml
  });
  const xml = await response.text();
  const result = readXmlTag(xml, 'Result');
  const resultExplanation = readXmlTag(xml, 'ResultExplanation');
  const transToken = readXmlTag(xml, 'TransToken');
  if (!response.ok || result !== '000' || !transToken) {
    throw new Error(resultExplanation || 'Failed to initialize payment');
  }
  return {
    provider: 'dpo_pay',
    txRef,
    transactionToken: transToken,
    checkoutUrl: `${paymentUrl}?ID=${encodeURIComponent(transToken)}`,
    amount,
    currencyCode: info.currencyCode
  };
}

export async function createPayPalRenewalPayment(info, payload = {}) {
  const amount = calculateRenewalAmountFromInfo(info, payload.months);
  if (!amount) throw new Error('Invalid renewal period or subscription amount');
  const txRef = `renewal_${info.tenantId}_${payload.months}_card_${Date.now()}`;
  const redirectUrl = String(process.env.RENEWAL_PAYMENT_REDIRECT_URL || '').trim();
  if (!redirectUrl) throw new Error('Missing renewal payment redirect URL');
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: txRef,
        custom_id: txRef,
        description: `${info.tenantName || info.tenantId} Subscription Renewal`,
        amount: {
          currency_code: info.currencyCode,
          value: amount.toFixed(2)
        }
      }],
      application_context: {
        return_url: redirectUrl,
        cancel_url: redirectUrl,
        brand_name: info.tenantName || info.tenantId,
        user_action: 'PAY_NOW'
      },
      payer: {
        name: (() => {
          const { firstName, lastName } = splitCustomerName(payload.customerName || info.tenantName || info.tenantId);
          return { given_name: firstName, surname: lastName };
        })(),
        email_address: payload.email || info.billingEmail || undefined,
        address: {
          address_line_1: payload.address || info.billingAddress || undefined,
          country_code: info.billingCountry || 'GH'
        }
      }
    })
  });
  const json = await response.json().catch(() => ({}));
  const approveLink = Array.isArray(json?.links) ? json.links.find((item) => item.rel === 'approve') : null;
  if (!response.ok || !json?.id || !approveLink?.href) {
    throw new Error(json?.message || json?.details?.[0]?.description || 'Failed to initialize PayPal payment');
  }
  return {
    provider: 'paypal',
    txRef,
    orderId: json.id,
    checkoutUrl: approveLink.href,
    amount,
    currencyCode: info.currencyCode
  };
}

export async function createPaystackRenewalPayment(info, payload = {}) {
  const secretKey = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secretKey) throw new Error('Paystack is not configured yet');
  const amount = calculateRenewalAmountFromInfo(info, payload.months);
  if (!amount) throw new Error('Invalid renewal period or subscription amount');
  const channel = String(payload.method || 'card').trim().toLowerCase() === 'mobile_money' ? 'mobile_money' : 'card';
  const txRef = `renewal_${info.tenantId}_${payload.months}_${channel}_${Date.now()}`;
  const redirectUrl = String(process.env.RENEWAL_PAYMENT_REDIRECT_URL || '').trim();
  if (!redirectUrl) throw new Error('Missing renewal payment redirect URL');
  const method = String(payload.method || 'card').toLowerCase();
  const channels = method === 'mobile_money' ? ['mobile_money'] : ['card'];
  const mobileMoney = method === 'mobile_money'
    ? {
        phone: String(payload.phone || info.billingPhone || '').trim(),
        provider: String(payload.network || '').trim().toUpperCase()
      }
    : null;
  if (method === 'mobile_money' && (!mobileMoney?.phone || !mobileMoney?.provider)) {
    throw new Error('Phone number and mobile network are required for mobile money payment');
  }
  const response = await fetch(`${getPaystackBaseUrl()}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: payload.email || info.billingEmail || 'billing@example.com',
      amount: Math.round(amount * 100),
      currency: info.currencyCode,
      reference: txRef,
      callback_url: redirectUrl,
      channels,
      ...(mobileMoney ? { mobile_money: mobileMoney } : {}),
      metadata: {
        tenantId: info.tenantId,
        months: Number(payload.months),
        method,
        network: String(payload.network || ''),
        billingPhone: payload.phone || info.billingPhone || '',
        billingAddress: payload.address || info.billingAddress || ''
      }
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.status || !json?.data?.authorization_url) {
    throw new Error(json?.message || 'Failed to initialize Paystack payment');
  }
  return {
    provider: 'paystack',
    txRef,
    checkoutUrl: json.data.authorization_url,
    amount,
    currencyCode: info.currencyCode,
    accessCode: json.data.access_code || ''
  };
}

export async function verifyDpoRenewalPayment(masterConn, tenantConn, tenantDoc, transactionToken, txRef) {
  const companyToken = String(process.env.DPO_COMPANY_TOKEN || '').trim();
  const apiUrl = String(process.env.DPO_API_URL || 'https://secure.3gdirectpay.com/API/v6/').trim();
  if (!companyToken) throw new Error('Payment provider is not configured yet');
  const verifyXml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${xmlEscape(companyToken)}</CompanyToken>
  <Request>verifyToken</Request>
  <TransactionToken>${xmlEscape(transactionToken)}</TransactionToken>
</API3G>`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: verifyXml
  });
  const xml = await response.text();
  const result = readXmlTag(xml, 'Result');
  const resultExplanation = readXmlTag(xml, 'ResultExplanation');
  const companyRef = readXmlTag(xml, 'CompanyRef');
  const paymentAmount = Number(readXmlTag(xml, 'TransactionAmount') || 0);
  const paymentCurrency = readXmlTag(xml, 'TransactionCurrency');
  const approval = readXmlTag(xml, 'TransactionApproval');
  if (!response.ok || result !== '000') throw new Error(resultExplanation || 'Failed to verify payment');
  if (String(companyRef || '') !== String(txRef || '')) throw new Error('Payment reference mismatch');
  const metaParts = String(companyRef || '').split('_');
  const months = Number(metaParts[2] || 0);
  const channel = String(metaParts[3] || 'card');
  const amount = await calculateRenewalAmount(masterConn, tenantDoc, months);
  if (!amount || paymentAmount < amount) throw new Error('Payment amount does not match expected renewal amount');
  const days = months * ACTIVATION_EXTENSION_DAYS;
  const nextExpiry = computeExtendedSubscriptionDate(tenantDoc?.subscriptionExpiresAt, Date.now(), days);
  const updated = await TenantModelFor(masterConn).findOneAndUpdate(
    { tenantId: String(tenantDoc?.tenantId || '') },
    {
      $set: {
        subscriptionExpiresAt: nextExpiry,
        subscriptionPermanent: false,
        activationLastUsedAt: new Date()
      },
      $push: {
        paymentHistory: {
          provider: 'dpo_pay',
          method: 'hosted_checkout',
          channel,
          status: 'successful',
          transactionRef: String(txRef || ''),
          providerTransactionId: String(transactionToken || ''),
          network: '',
          currencyCode: String(paymentCurrency || ''),
          amount,
          months,
          createdAt: new Date()
        },
        renewalHistory: buildRenewalHistoryEntry({
          source: 'self_service_payment',
          amount,
          daysAdded: days,
          previousExpiry: tenantDoc?.subscriptionExpiresAt || null,
          newExpiry: nextExpiry,
          permanentBefore: !!tenantDoc?.subscriptionPermanent,
          permanentAfter: false,
          note: `Online renewal payment for ${months} month(s)`,
          actorName: String(tenantDoc?.tenantId || '')
        })
      }
    },
    { new: true }
  );
  const refreshed = await refreshTenantActivationCode(masterConn, tenantDoc?.tenantId);
  await syncTenantSubscriptionSnapshot(tenantConn, {
    subscriptionPlan: updated?.subscriptionPlan || tenantDoc?.subscriptionPlan || 'basic',
    subscriptionExpiresAt: updated?.subscriptionExpiresAt || nextExpiry,
    subscriptionPermanent: false,
    subscriptionAmount: updated?.subscriptionAmount ?? tenantDoc?.subscriptionAmount ?? null
  });
  await sendActivationCodeEmail({
    to: updated?.billingEmail || '',
    tenantName: updated?.name,
    tenantId: updated?.tenantId,
    activationCode: refreshed?.activationCode || '',
    activationCodeExpiresAt: refreshed?.activationCodeExpiresAt || null,
    currencyCode: String(paymentCurrency || ''),
    amount,
    months
  }).catch(() => {});
  return {
    updated,
    refreshedCode: refreshed?.activationCode || '',
    refreshedCodeExpiresAt: refreshed?.activationCodeExpiresAt || null,
    months,
    amount,
    approval
  };
}

export async function verifyPayPalRenewalPayment(masterConn, tenantConn, tenantDoc, orderId, txRef) {
  const accessToken = await getPayPalAccessToken();
  const captureResponse = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  const json = await captureResponse.json().catch(() => ({}));
  if (!captureResponse.ok || String(json?.status || '').toUpperCase() !== 'COMPLETED') {
    throw new Error(json?.message || json?.details?.[0]?.description || 'Failed to capture PayPal payment');
  }
  const purchaseUnit = Array.isArray(json?.purchase_units) ? json.purchase_units[0] : null;
  const amountValue = Number(purchaseUnit?.payments?.captures?.[0]?.amount?.value || purchaseUnit?.amount?.value || 0);
  const currencyCode = String(purchaseUnit?.payments?.captures?.[0]?.amount?.currency_code || purchaseUnit?.amount?.currency_code || '');
  const customId = String(purchaseUnit?.custom_id || purchaseUnit?.reference_id || '');
  if (customId !== String(txRef || '')) throw new Error('Payment reference mismatch');
  const metaParts = customId.split('_');
  const months = Number(metaParts[2] || 0);
  const channel = String(metaParts[3] || 'card');
  const amount = await calculateRenewalAmount(masterConn, tenantDoc, months);
  if (!amount || amountValue < amount) throw new Error('Payment amount does not match expected renewal amount');
  const days = months * ACTIVATION_EXTENSION_DAYS;
  const nextExpiry = computeExtendedSubscriptionDate(tenantDoc?.subscriptionExpiresAt, Date.now(), days);
  const updated = await TenantModelFor(masterConn).findOneAndUpdate(
    { tenantId: String(tenantDoc?.tenantId || '') },
    {
      $set: {
        subscriptionExpiresAt: nextExpiry,
        subscriptionPermanent: false,
        activationLastUsedAt: new Date()
      },
      $push: {
        paymentHistory: {
          provider: 'paypal',
          method: 'paypal_checkout',
          channel,
          status: 'successful',
          transactionRef: String(txRef || ''),
          providerTransactionId: String(orderId || ''),
          network: '',
          currencyCode,
          amount,
          months,
          createdAt: new Date()
        },
        renewalHistory: buildRenewalHistoryEntry({
          source: 'self_service_payment',
          amount,
          daysAdded: days,
          previousExpiry: tenantDoc?.subscriptionExpiresAt || null,
          newExpiry: nextExpiry,
          permanentBefore: !!tenantDoc?.subscriptionPermanent,
          permanentAfter: false,
          note: `PayPal renewal payment for ${months} month(s)`,
          actorName: String(tenantDoc?.tenantId || '')
        })
      }
    },
    { new: true }
  );
  const refreshed = await refreshTenantActivationCode(masterConn, tenantDoc?.tenantId);
  await syncTenantSubscriptionSnapshot(tenantConn, {
    subscriptionPlan: updated?.subscriptionPlan || tenantDoc?.subscriptionPlan || 'basic',
    subscriptionExpiresAt: updated?.subscriptionExpiresAt || nextExpiry,
    subscriptionPermanent: false,
    subscriptionAmount: updated?.subscriptionAmount ?? tenantDoc?.subscriptionAmount ?? null
  });
  await sendActivationCodeEmail({
    to: updated?.billingEmail || '',
    tenantName: updated?.name,
    tenantId: updated?.tenantId,
    activationCode: refreshed?.activationCode || '',
    activationCodeExpiresAt: refreshed?.activationCodeExpiresAt || null,
    currencyCode,
    amount,
    months
  }).catch(() => {});
  return {
    updated,
    refreshedCode: refreshed?.activationCode || '',
    refreshedCodeExpiresAt: refreshed?.activationCodeExpiresAt || null,
    months,
    amount,
    approval: String(purchaseUnit?.payments?.captures?.[0]?.id || '')
  };
}

export async function verifyPaystackRenewalPayment(masterConn, tenantConn, tenantDoc, reference) {
  const secretKey = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secretKey) throw new Error('Paystack is not configured yet');
  const response = await fetch(`${getPaystackBaseUrl()}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`
    }
  });
  const json = await response.json().catch(() => ({}));
  const data = json?.data || {};
  if (!response.ok || !json?.status || String(data?.status || '').toLowerCase() !== 'success') {
    throw new Error(json?.message || 'Failed to verify Paystack payment');
  }
  const txRef = String(data.reference || '');
  const metaParts = txRef.split('_');
  const months = Number(metaParts[2] || 0);
  const channel = String(metaParts[3] || data.channel || data.metadata?.method || 'card');
  const amount = await calculateRenewalAmount(masterConn, tenantDoc, months);
  const paidAmount = Number(data.amount || 0) / 100;
  const currencyCode = String(data.currency || '');
  if (!amount || paidAmount < amount) throw new Error('Payment amount does not match expected renewal amount');
  const days = months * ACTIVATION_EXTENSION_DAYS;
  const nextExpiry = computeExtendedSubscriptionDate(tenantDoc?.subscriptionExpiresAt, Date.now(), days);
  const updated = await TenantModelFor(masterConn).findOneAndUpdate(
    { tenantId: String(tenantDoc?.tenantId || '') },
    {
      $set: {
        subscriptionExpiresAt: nextExpiry,
        subscriptionPermanent: false,
        activationLastUsedAt: new Date()
      },
      $push: {
        paymentHistory: {
          provider: 'paystack',
          method: String(data.channel || data.metadata?.method || 'hosted_checkout'),
          channel,
          status: 'successful',
          transactionRef: txRef,
          providerTransactionId: String(data.id || ''),
          network: String(data.metadata?.network || ''),
          currencyCode,
          amount,
          months,
          createdAt: new Date()
        },
        renewalHistory: buildRenewalHistoryEntry({
          source: 'self_service_payment',
          amount,
          daysAdded: days,
          previousExpiry: tenantDoc?.subscriptionExpiresAt || null,
          newExpiry: nextExpiry,
          permanentBefore: !!tenantDoc?.subscriptionPermanent,
          permanentAfter: false,
          note: `Paystack renewal payment for ${months} month(s)`,
          actorName: String(tenantDoc?.tenantId || '')
        })
      }
    },
    { new: true }
  );
  const refreshed = await refreshTenantActivationCode(masterConn, tenantDoc?.tenantId);
  await syncTenantSubscriptionSnapshot(tenantConn, {
    subscriptionPlan: updated?.subscriptionPlan || tenantDoc?.subscriptionPlan || 'basic',
    subscriptionExpiresAt: updated?.subscriptionExpiresAt || nextExpiry,
    subscriptionPermanent: false,
    subscriptionAmount: updated?.subscriptionAmount ?? tenantDoc?.subscriptionAmount ?? null
  });
  await sendActivationCodeEmail({
    to: updated?.billingEmail || '',
    tenantName: updated?.name,
    tenantId: updated?.tenantId,
    activationCode: refreshed?.activationCode || '',
    activationCodeExpiresAt: refreshed?.activationCodeExpiresAt || null,
    currencyCode,
    amount,
    months
  }).catch(() => {});
  return {
    updated,
    refreshedCode: refreshed?.activationCode || '',
    refreshedCodeExpiresAt: refreshed?.activationCodeExpiresAt || null,
    months,
    amount,
    approval: String(data.gateway_response || '')
  };
}

export async function createDpoLimitUpgradePayment(info, payload = {}) {
  const companyToken = String(process.env.DPO_COMPANY_TOKEN || '').trim();
  const serviceType = String(process.env.DPO_SERVICE_TYPE || '').trim();
  const apiUrl = String(process.env.DPO_API_URL || 'https://secure.3gdirectpay.com/API/v6/').trim();
  const paymentUrl = String(process.env.DPO_PAYMENT_URL || 'https://secure.3gdirectpay.com/payv2.php').trim();
  const ptl = String(process.env.DPO_PTL || '15').trim();
  if (!companyToken || !serviceType) throw new Error('Payment provider is not configured yet');
  const resourceType = normalizeAddonResourceType(payload.resourceType);
  const quantity = normalizeAddonQuantity(payload.quantity);
  const config = { addOns: info?.addOnPricing || {} };
  const amount = calculateAddonAmount(config, resourceType, quantity);
  if (!amount) throw new Error(`Additional ${resourceType} payment is not configured yet`);
  const channel = String(payload.method || 'card').trim().toLowerCase() === 'mobile_money' ? 'mobile_money' : 'card';
  const txRef = `limit_addon_${info.tenantId}_${resourceType}_${quantity}_${channel}_${Date.now()}`;
  const redirectUrl = resolveLimitUpgradeRedirectUrl(payload);
  if (!redirectUrl) throw new Error('Missing tenant limit payment redirect URL');
  const { firstName, lastName } = splitCustomerName(payload.customerName || info.tenantName || info.tenantId);
  const requestXml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${xmlEscape(companyToken)}</CompanyToken>
  <Request>createToken</Request>
  <Transaction>
    <PaymentAmount>${xmlEscape(amount)}</PaymentAmount>
    <PaymentCurrency>${xmlEscape(info.currencyCode)}</PaymentCurrency>
    <CompanyRef>${xmlEscape(txRef)}</CompanyRef>
    <RedirectURL>${xmlEscape(redirectUrl)}</RedirectURL>
    <BackURL>${xmlEscape(redirectUrl)}</BackURL>
    <CompanyRefUnique>1</CompanyRefUnique>
    <PTL>${xmlEscape(ptl)}</PTL>
  </Transaction>
  <Services>
    <Service>
      <ServiceType>${xmlEscape(serviceType)}</ServiceType>
      <ServiceDescription>${xmlEscape(`${info.tenantName || info.tenantId} Additional ${resourceType} slot(s) x${quantity}`)}</ServiceDescription>
      <ServiceDate>${xmlEscape(new Date().toISOString().slice(0, 10))}</ServiceDate>
    </Service>
  </Services>
  <customerFirstName>${xmlEscape(firstName)}</customerFirstName>
  <customerLastName>${xmlEscape(lastName)}</customerLastName>
  <customerEmail>${xmlEscape(payload.email || info.billingEmail || 'billing@example.com')}</customerEmail>
  <customerPhone>${xmlEscape(payload.phone || info.billingPhone || '')}</customerPhone>
  <customerAddress>${xmlEscape(payload.address || info.billingAddress || '')}</customerAddress>
  <customerCity>${xmlEscape(info.tenantName || 'City')}</customerCity>
  <customerCountry>${xmlEscape(info.billingCountry || 'GH')}</customerCountry>
  <customerZip>00000</customerZip>
</API3G>`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: requestXml
  });
  const xml = await response.text();
  const result = readXmlTag(xml, 'Result');
  const resultExplanation = readXmlTag(xml, 'ResultExplanation');
  const transToken = readXmlTag(xml, 'TransToken');
  if (!response.ok || result !== '000' || !transToken) {
    throw new Error(resultExplanation || 'Failed to initialize payment');
  }
  return {
    provider: 'dpo_pay',
    txRef,
    transactionToken: transToken,
    checkoutUrl: `${paymentUrl}?ID=${encodeURIComponent(transToken)}`,
    amount,
    currencyCode: info.currencyCode,
    resourceType,
    quantity
  };
}

export async function createPayPalLimitUpgradePayment(info, payload = {}) {
  const resourceType = normalizeAddonResourceType(payload.resourceType);
  const quantity = normalizeAddonQuantity(payload.quantity);
  const config = { addOns: info?.addOnPricing || {} };
  const amount = calculateAddonAmount(config, resourceType, quantity);
  if (!amount) throw new Error(`Additional ${resourceType} payment is not configured yet`);
  const txRef = `limit_addon_${info.tenantId}_${resourceType}_${quantity}_card_${Date.now()}`;
  const redirectUrl = resolveLimitUpgradeRedirectUrl(payload);
  if (!redirectUrl) throw new Error('Missing tenant limit payment redirect URL');
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: txRef,
        custom_id: txRef,
        description: `${info.tenantName || info.tenantId} Additional ${resourceType} slot(s) x${quantity}`,
        amount: {
          currency_code: info.currencyCode,
          value: amount.toFixed(2)
        }
      }],
      application_context: {
        return_url: redirectUrl,
        cancel_url: redirectUrl,
        brand_name: info.tenantName || info.tenantId,
        user_action: 'PAY_NOW'
      },
      payer: {
        name: (() => {
          const { firstName, lastName } = splitCustomerName(payload.customerName || info.tenantName || info.tenantId);
          return { given_name: firstName, surname: lastName };
        })(),
        email_address: payload.email || info.billingEmail || undefined,
        address: {
          address_line_1: payload.address || info.billingAddress || undefined,
          country_code: info.billingCountry || 'GH'
        }
      }
    })
  });
  const json = await response.json().catch(() => ({}));
  const approveLink = Array.isArray(json?.links) ? json.links.find((item) => item.rel === 'approve') : null;
  if (!response.ok || !json?.id || !approveLink?.href) {
    throw new Error(json?.message || json?.details?.[0]?.description || 'Failed to initialize PayPal payment');
  }
  return {
    provider: 'paypal',
    txRef,
    orderId: json.id,
    checkoutUrl: approveLink.href,
    amount,
    currencyCode: info.currencyCode,
    resourceType,
    quantity
  };
}

export async function createPaystackLimitUpgradePayment(info, payload = {}) {
  const secretKey = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secretKey) throw new Error('Paystack is not configured yet');
  const resourceType = normalizeAddonResourceType(payload.resourceType);
  const quantity = normalizeAddonQuantity(payload.quantity);
  const config = { addOns: info?.addOnPricing || {} };
  const amount = calculateAddonAmount(config, resourceType, quantity);
  if (!amount) throw new Error(`Additional ${resourceType} payment is not configured yet`);
  const method = String(payload.method || 'card').toLowerCase();
  const channel = method === 'mobile_money' ? 'mobile_money' : 'card';
  const txRef = `limit_addon_${info.tenantId}_${resourceType}_${quantity}_${channel}_${Date.now()}`;
  const redirectUrl = resolveLimitUpgradeRedirectUrl(payload);
  if (!redirectUrl) throw new Error('Missing tenant limit payment redirect URL');
  const channels = method === 'mobile_money' ? ['mobile_money'] : ['card'];
  const mobileMoney = method === 'mobile_money'
    ? {
        phone: String(payload.phone || info.billingPhone || '').trim(),
        provider: String(payload.network || '').trim().toUpperCase()
      }
    : null;
  if (method === 'mobile_money' && (!mobileMoney?.phone || !mobileMoney?.provider)) {
    throw new Error('Phone number and mobile network are required for mobile money payment');
  }
  const response = await fetch(`${getPaystackBaseUrl()}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: payload.email || info.billingEmail || 'billing@example.com',
      amount: Math.round(amount * 100),
      currency: info.currencyCode,
      reference: txRef,
      callback_url: redirectUrl,
      channels,
      ...(mobileMoney ? { mobile_money: mobileMoney } : {}),
      metadata: {
        tenantId: info.tenantId,
        resourceType,
        quantity,
        method,
        network: String(payload.network || ''),
        billingPhone: payload.phone || info.billingPhone || '',
        billingAddress: payload.address || info.billingAddress || ''
      }
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.status || !json?.data?.authorization_url) {
    throw new Error(json?.message || 'Failed to initialize Paystack payment');
  }
  return {
    provider: 'paystack',
    txRef,
    checkoutUrl: json.data.authorization_url,
    amount,
    currencyCode: info.currencyCode,
    accessCode: json.data.access_code || '',
    resourceType,
    quantity
  };
}

async function applyTenantLimitUpgrade(masterConn, tenantDoc, payment = {}) {
  const meta = parseAddonTxRef(payment.txRef);
  if (!meta?.tenantId || !meta.quantity) throw new Error('Invalid tenant limit payment reference');
  const config = await getSubscriptionManagementConfig(masterConn);
  const addOnPricing = getTenantAddonPricing(config, tenantDoc);
  const effectiveConfig = { addOns: addOnPricing };
  const unitRate = getAddonRate(effectiveConfig, meta.resourceType);
  const expectedAmount = calculateAddonAmount(effectiveConfig, meta.resourceType, meta.quantity);
  if (!expectedAmount || !unitRate) throw new Error(`Additional ${meta.resourceType} payment is not configured yet`);
  if (Number(payment.amount || 0) < expectedAmount) throw new Error('Payment amount does not match expected tenant limit amount');
  const incField = meta.resourceType === 'branch' ? 'additionalBranchSlots' : 'additionalUserSlots';
  const updated = await TenantModelFor(masterConn).findOneAndUpdate(
    { tenantId: String(tenantDoc?.tenantId || '') },
    {
      $inc: { [incField]: meta.quantity },
      $push: {
        paymentHistory: {
          provider: String(payment.provider || ''),
          method: String(payment.method || ''),
          channel: String(payment.channel || meta.channel || ''),
          purpose: 'tenant_limit_upgrade',
          resourceType: meta.resourceType,
          quantity: meta.quantity,
          unitRate,
          status: 'successful',
          transactionRef: String(payment.txRef || ''),
          providerTransactionId: String(payment.providerTransactionId || ''),
          network: String(payment.network || ''),
          currencyCode: String(payment.currencyCode || ''),
          amount: expectedAmount,
          months: null,
          createdAt: new Date()
        }
      }
    },
    { new: true }
  );
  return {
    updated,
    resourceType: meta.resourceType,
    quantity: meta.quantity,
    amount: expectedAmount
  };
}

export async function verifyDpoLimitUpgradePayment(masterConn, tenantDoc, transactionToken, txRef) {
  const companyToken = String(process.env.DPO_COMPANY_TOKEN || '').trim();
  const apiUrl = String(process.env.DPO_API_URL || 'https://secure.3gdirectpay.com/API/v6/').trim();
  if (!companyToken) throw new Error('Payment provider is not configured yet');
  const verifyXml = `<?xml version="1.0" encoding="utf-8"?>
<API3G>
  <CompanyToken>${xmlEscape(companyToken)}</CompanyToken>
  <Request>verifyToken</Request>
  <TransactionToken>${xmlEscape(transactionToken)}</TransactionToken>
</API3G>`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: verifyXml
  });
  const xml = await response.text();
  const result = readXmlTag(xml, 'Result');
  const resultExplanation = readXmlTag(xml, 'ResultExplanation');
  const companyRef = readXmlTag(xml, 'CompanyRef');
  const paymentAmount = Number(readXmlTag(xml, 'TransactionAmount') || 0);
  const paymentCurrency = readXmlTag(xml, 'TransactionCurrency');
  if (!response.ok || result !== '000') throw new Error(resultExplanation || 'Failed to verify payment');
  if (String(companyRef || '') !== String(txRef || '')) throw new Error('Payment reference mismatch');
  return applyTenantLimitUpgrade(masterConn, tenantDoc, {
    provider: 'dpo_pay',
    method: 'hosted_checkout',
    channel: parseAddonTxRef(companyRef)?.channel || '',
    txRef: companyRef,
    providerTransactionId: String(transactionToken || ''),
    network: '',
    currencyCode: String(paymentCurrency || ''),
    amount: paymentAmount
  });
}

export async function verifyPayPalLimitUpgradePayment(masterConn, tenantDoc, orderId, txRef) {
  const accessToken = await getPayPalAccessToken();
  const captureResponse = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  const json = await captureResponse.json().catch(() => ({}));
  if (!captureResponse.ok || String(json?.status || '').toUpperCase() !== 'COMPLETED') {
    throw new Error(json?.message || json?.details?.[0]?.description || 'Failed to capture PayPal payment');
  }
  const purchaseUnit = Array.isArray(json?.purchase_units) ? json.purchase_units[0] : null;
  const amountValue = Number(purchaseUnit?.payments?.captures?.[0]?.amount?.value || purchaseUnit?.amount?.value || 0);
  const currencyCode = String(purchaseUnit?.payments?.captures?.[0]?.amount?.currency_code || purchaseUnit?.amount?.currency_code || '');
  const customId = String(purchaseUnit?.custom_id || purchaseUnit?.reference_id || '');
  if (customId !== String(txRef || '')) throw new Error('Payment reference mismatch');
  return applyTenantLimitUpgrade(masterConn, tenantDoc, {
    provider: 'paypal',
    method: 'paypal_checkout',
    channel: parseAddonTxRef(customId)?.channel || 'card',
    txRef: customId,
    providerTransactionId: String(orderId || ''),
    network: '',
    currencyCode,
    amount: amountValue
  });
}

export async function verifyPaystackLimitUpgradePayment(masterConn, tenantDoc, reference) {
  const secretKey = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!secretKey) throw new Error('Paystack is not configured yet');
  const response = await fetch(`${getPaystackBaseUrl()}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`
    }
  });
  const json = await response.json().catch(() => ({}));
  const data = json?.data || {};
  if (!response.ok || !json?.status || String(data?.status || '').toLowerCase() !== 'success') {
    throw new Error(json?.message || 'Failed to verify Paystack payment');
  }
  return applyTenantLimitUpgrade(masterConn, tenantDoc, {
    provider: 'paystack',
    method: String(data.channel || data.metadata?.method || 'hosted_checkout'),
    channel: parseAddonTxRef(String(data.reference || ''))?.channel || String(data.channel || data.metadata?.method || ''),
    txRef: String(data.reference || ''),
    providerTransactionId: String(data.id || ''),
    network: String(data.metadata?.network || ''),
    currencyCode: String(data.currency || ''),
    amount: Number(data.amount || 0) / 100
  });
}
