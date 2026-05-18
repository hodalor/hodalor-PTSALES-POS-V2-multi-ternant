import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import Modal from './Modal';
import * as tenantsApi from '../api/tenants';
import { savePendingTenantLimitPayment } from '../utils/tenantLimitPayments';
import { getApiBase, isLikelyNetworkErrorMessage } from '../api/client';

function formatMoney(amount, currencySymbol = '', currencyCode = '', currencyPosition = 'prefix') {
  const numeric = Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currencyPosition === 'suffix'
    ? `${numeric} ${currencySymbol || currencyCode}`.trim()
    : `${currencySymbol || currencyCode}${numeric}`.trim();
}

export default function TenantLimitUpgradeModal({ open, onClose, context, resourceType = 'user', toast, onStarted }) {
  const auth = useSelector((s) => s.auth);
  const [provider, setProvider] = useState('paystack');
  const [method, setMethod] = useState('card');
  const [quantity, setQuantity] = useState('1');
  const [network, setNetwork] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const enabledGateways = Array.isArray(context?.enabledGateways) ? context.enabledGateways : [];
  const mobileMoneyNetworks = Array.isArray(context?.mobileMoneyNetworks) ? context.mobileMoneyNetworks : [];
  const roleLower = String(auth?.role || auth?.user?.role || '').toLowerCase();
  const isMasterSuperAdmin = roleLower === 'superadmin' && String(auth?.user?.tenantId || '').toLowerCase() === 'master';
  const resolvedResourceType = String(resourceType || context?.resourceType || 'user').toLowerCase() === 'branch' ? 'branch' : 'user';
  const unitRate = resolvedResourceType === 'branch'
    ? Number(context?.addOnPricing?.additionalBranchRate || 0)
    : Number(context?.addOnPricing?.additionalUserRate || 0);
  const qty = Math.max(1, Number(quantity || 1));
  const total = Number((unitRate * qty).toFixed(2));
  const title = resolvedResourceType === 'branch' ? 'Branch Limit Reached' : 'User Limit Reached';
  const usageText = useMemo(() => {
    if (!context?.usage || !context?.limits) return '';
    const used = resolvedResourceType === 'branch' ? context.usage.totalBranches : context.usage.totalUsers;
    const limit = resolvedResourceType === 'branch' ? context.limits.maxBranches : context.limits.maxUserAccounts;
    if (limit == null) return '';
    return `${used} of ${limit} used`;
  }, [context, resolvedResourceType]);

  useEffect(() => {
    if (!open) return;
    const nextProvider = enabledGateways.includes('paystack')
      ? 'paystack'
      : (enabledGateways[0] || 'paystack');
    setProvider(nextProvider);
    setMethod(nextProvider === 'paypal' ? 'card' : 'card');
    setPhone(String(context?.billingPhone || ''));
    setEmail(String(context?.billingEmail || ''));
    setAddress(String(context?.billingAddress || ''));
    setNetwork((current) => current || String(mobileMoneyNetworks[0] || ''));
  }, [context?.billingAddress, context?.billingEmail, context?.billingPhone, enabledGateways, mobileMoneyNetworks, open]);

  useEffect(() => {
    if (provider === 'paypal') {
      setMethod('card');
      return;
    }
    if (method === 'mobile_money' && !mobileMoneyNetworks.length) {
      setMethod('card');
    }
  }, [method, mobileMoneyNetworks.length, provider]);

  async function startPayment() {
    if (!unitRate) {
      toast?.show(`Additional ${resolvedResourceType} payment is not configured yet. Contact admin.`, { type: 'error' });
      return;
    }
    if (provider === 'paystack' && method === 'mobile_money') {
      if (!String(phone || '').trim()) {
        toast?.show('Enter a phone number for mobile money payment.', { type: 'error' });
        return;
      }
      if (!String(network || '').trim()) {
        toast?.show('Select a mobile network for mobile money payment.', { type: 'error' });
        return;
      }
    }
    try {
      setLoading(true);
      const returnUrl = `${window.location.origin}${window.location.pathname}`;
      const result = await tenantsApi.startLimitUpgradePayment({
        provider,
        method,
        resourceType: resolvedResourceType,
        quantity: qty,
        network,
        phone,
        email,
        address,
        returnUrl
      });
      if (!result?.checkoutUrl) {
        throw new Error('Payment checkout URL was not returned by the server.');
      }
      savePendingTenantLimitPayment({
        provider: result?.provider || provider,
        txRef: result?.txRef || '',
        resourceType: resolvedResourceType,
        quantity: qty
      });
      onStarted?.(result);
      window.location.assign(result.checkoutUrl);
    } catch (e) {
      const message = String(e?.message || 'Failed to start payment');
      if (isLikelyNetworkErrorMessage(message)) {
        toast?.show(
          isMasterSuperAdmin
            ? `Cannot reach payment server at ${getApiBase()}. Check API Endpoint in Config and your internet connection.`
            : 'Cannot reach payment server. Please contact admin or try again later.',
          { type: 'error' }
        );
      } else {
        toast?.show(message, { type: 'error' });
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <Modal
      title={title}
      onClose={() => { if (!loading) onClose?.(); }}
      variant="light"
      footer={
        <>
          <button className="btn" type="button" onClick={() => onClose?.()} disabled={loading}>Close</button>
          <button className="btn btn-primary" type="button" onClick={startPayment} disabled={loading || !enabledGateways.length || !unitRate}>
            {loading ? 'Starting Payment…' : 'Pay Now'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ color: '#475569' }}>
          You have reached your {resolvedResourceType} limit. Contact admin or pay now to unlock more {resolvedResourceType === 'branch' ? 'branches' : 'users'} instantly.
        </div>
        {usageText ? <div style={{ padding: 10, borderRadius: 8, background: '#f8fafc', color: '#334155' }}>Current usage: {usageText}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            Additional {resolvedResourceType === 'branch' ? 'Branches' : 'Users'}
            <input className="input" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label>
            Rate Per {resolvedResourceType === 'branch' ? 'Branch' : 'User'}
            <input className="input" value={formatMoney(unitRate, context?.currencySymbol, context?.currencyCode, context?.currencyPosition)} readOnly />
          </label>
          <label>
            Payment Provider
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {enabledGateways.map((key) => <option key={key} value={key}>{key}</option>)}
            </select>
          </label>
          <label>
            Method
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="card">Card</option>
              {provider !== 'paypal' && mobileMoneyNetworks.length > 0 ? <option value="mobile_money">Mobile Money</option> : null}
            </select>
          </label>
          <label>
            Phone
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={context?.billingPhone || ''} />
          </label>
          <label>
            Email
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={context?.billingEmail || ''} />
          </label>
        </div>
        {method === 'mobile_money' && mobileMoneyNetworks.length > 0 ? (
          <label>
            Mobile Network
            <select className="input" value={network} onChange={(e) => setNetwork(e.target.value)}>
              <option value="">Select network</option>
              {mobileMoneyNetworks.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        ) : null}
        <label>
          Billing Address
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={context?.billingAddress || ''} />
        </label>
        <div style={{ padding: 12, borderRadius: 10, background: '#eff6ff', color: '#1e3a8a', fontWeight: 700 }}>
          Total: {formatMoney(total, context?.currencySymbol, context?.currencyCode, context?.currencyPosition)}
        </div>
      </div>
    </Modal>
  );
}
