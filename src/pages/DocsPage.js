import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { downloadHtmlDocument } from '../utils/exporters';
import { useAppLanguage } from '../utils/localization';

function Section({ title, children }) {
  const { t } = useAppLanguage();
  return (
    <section className="card" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{t(title)}</h2>
      {children}
    </section>
  );
}

function Code({ children }) {
  return (
    <pre style={{ background: '#0b1220', color: '#e2e8f0', padding: 12, borderRadius: 8, overflow: 'auto' }}>
      <code>{children}</code>
    </pre>
  );
}

function DocsPage() {
  const { t } = useAppLanguage();
  const contentRef = useRef(null);

  function downloadDocs() {
    downloadHtmlDocument(
      'ptsales-technical-docs.html',
      t('ptSales Technical Documentation'),
      `
        <div class="doc-header">
          <h1>${t('ptSales Technical Documentation')}</h1>
          <div class="doc-muted">${t('Architecture, runtime behavior, tenant controls, and implementation notes.')}</div>
        </div>
        ${contentRef.current?.innerHTML || ''}
      `
    );
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ marginTop: 0, marginBottom: 8 }}>{t('Technical Documentation')}</h1>
            <div style={{ color: '#64748b' }}>
              {t('Architecture, modules, runtime safety, tenant controls, and implementation references across the app. SuperAdmin-only.')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={() => window.print()}>{t('Print / Save PDF')}</button>
            <button className="btn btn-primary" type="button" onClick={downloadDocs}>{t('Download Docs')}</button>
          </div>
        </div>
      </div>
      <div ref={contentRef} style={{ display: 'grid', gap: 12 }}>
      <Section title="PWA, Installation, and Offline">
        <ul>
          <li>Manifest branding is generated at runtime based on Settings clientAppName/appName. Icons derive from clientLogoUrl and are resized to 192/512.</li>
          <li>Install prompt captured globally; Config page includes explicit Install and Check & Open actions.</li>
          <li>Service worker updates are applied immediately via SKIP_WAITING and controllerchange.</li>
        </ul>
        <div style={{ color: '#64748b' }}>
          References: <Link to="/config">Config</Link> page UI, runtime manifest injection and install helpers.
        </div>
        <Code>
{`// Runtime manifest injection and icon generation
// See App.js
async function regen() {
  const branded = settings.clientAppName || settings.appName;
  const icon192 = await resizeToPng(settings.clientLogoUrl, 192);
  const icon512 = await resizeToPng(settings.clientLogoUrl, 512);
  const manifest = { name: branded, short_name: branded.slice(0,12), icons: [
    { src: icon192 || 'logo192.png', sizes: '192x192', type: 'image/png' },
    { src: icon512 || 'logo512.png', sizes: '512x512', type: 'image/png' }
  ], display: 'standalone', start_url: '/' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
  let link = document.querySelector('link[rel="manifest"]'); if (!link) { link = document.createElement('link'); link.rel='manifest'; document.head.appendChild(link); }
  link.href = url;
}`}
        </Code>
        <Code>
{`// Install helpers (installPrompt.js)
export function setBeforeInstallPromptEvent(e) { _bipEvent = e; }
export async function checkUpdateAndOpen(startUrl='/') {
  const reg = await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.ready;
  await reg.update();
  if (reg.waiting) { reg.waiting.postMessage('SKIP_WAITING'); await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', () => r())); }
  window.open(startUrl, '_blank', 'noopener,noreferrer');
}`}
        </Code>
      </Section>

      <Section title="Offline Login and Persistence">
        <ul>
          <li>On successful online login, the app stores a SHA‑256 hash of the PIN with user and role for offline use.</li>
          <li>Offline login compares the local hash to the entered PIN; if matched, sets an offline token to preserve role headers for queued requests.</li>
          <li>Redux persistence is now scoped to auth, settings, and tenant metadata instead of broad business datasets, which reduces cross-tenant leakage risk on shared devices.</li>
          <li>Tenant-sensitive lists are intentionally reloaded from the database after auth rather than trusted from prior local cache snapshots.</li>
        </ul>
        <Code>
{`// LoginPage.js
async function hashPin(pin) {
  const enc = new TextEncoder().encode(String(pin));
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
// Save for offline after online login
const h = await hashPin(pin);
const map = JSON.parse(localStorage.getItem('ptSales:offlineCreds')||'{}');
map[name] = { pinHash: h, role, user };
localStorage.setItem('ptSales:offlineCreds', JSON.stringify(map));
// Offline login path
const offline = await offlineLogin(name, pin); // verifies hash and returns role+user
`}
        </Code>
        <Code>
{`// store/index.js
const preloadedState = loadState();
store.subscribe(() => { clearTimeout(timer); timer = setTimeout(()=>saveState(store.getState()), 500); });`}
        </Code>
      </Section>

      <Section title="Tenant Bootstrap and Hydration Guards">
        <ul>
          <li>Auth bootstrap now starts in an uninitialized state, recovers the online session first, then hydrates tenant settings before protected content renders.</li>
          <li>Protected routes wait for tenant settings hydration so plan features and grants do not flash briefly during login or refresh.</li>
          <li>Startup loading is staged so critical data like branches, products, and POS dependencies arrive before slower secondary lists.</li>
        </ul>
        <Code>
{`// ProtectedRoute/App bootstrap concept
if (!auth.initialized) return <Loader label="Preparing secure sign-in..." />;
if (!isMasterTenant && !settings.hydrated) return <Loader label="Loading tenant access..." />;
// After auth + settings, protected routes render with the correct tenant flags and grants`}
        </Code>
      </Section>

      <Section title="Offline Queue and Backup">
        <ul>
          <li>Write actions enqueue when offline with collection labels; counts surface in the UI and Backup page.</li>
          <li>Background sync runs when online and features.offlineBackup + modules.backup are enabled; manual backup also available.</li>
        </ul>
        <Code>
{`// offline/offlineBackup.js
export function isOfflineBackupEnabled(settings) {
  return isFeatureEnabled(settings, 'features.offlineBackup') && isFeatureEnabled(settings, 'modules.backup');
}
export async function enqueueHttp({ collection, label, path, method, body }) {
  return enqueue('http', { collection, label, path, method, body });
}`}
        </Code>
      </Section>

      <Section title="POS and Stock Deduction">
        <ul>
          <li>POS records sales; deducts stock per branch+variant locally; enqueues sale offline or posts online.</li>
          <li>Receipts render branded HTML and optional ESC/POS text output; drawer pulse included for cash when configured.</li>
          <li>Complete Payment now uses an immediate lock to prevent duplicate customer creation and duplicate sales from repeated clicks.</li>
          <li>Quick POS customer capture is inline, and customer type is derived from the active POS mode: retail vs distribution.</li>
        </ul>
        <Code>
{`// PosPage.js (completeSale)
if (!navigator.onLine) {
  await enqueueHttp({ collection:'sales', label:'Sale', path:'/api/sales', method:'POST', body:sale });
  saleForUi = { ...sale, id: offlineId, receiptNumber: ref, offline: true };
} else {
  saved = await createSale(sale);
}
dispatch(adjustStock({ productId, variantId, branchId, delta: -i.quantity }));`}
        </Code>
      </Section>

      <Section title="Subscription Renewal and Payment Gateways">
        <ul>
          <li>Expired-tenant renewal actions are driven by backend payment-management config rather than assuming gateways are always available.</li>
          <li>If all payment gateways are disabled, login and activation flows hide payment buttons and show the configured fallback message.</li>
          <li>Empty enabled-gateway arrays are preserved intentionally on save; defaults are only applied when no stored config exists yet.</li>
        </ul>
        <Code>
{`// paymentManagement normalization
const hasStoredList = Array.isArray(doc?.data?.enabledGateways);
const enabledGateways = hasStoredList
  ? normalizeEnabledGateways(doc?.data?.enabledGateways, { allowEmpty: true })
  : DEFAULT_ENABLED_GATEWAYS.slice();`}
        </Code>
      </Section>

      <Section title="Branding: Client App Name and Logo">
        <ul>
          <li>Config exposes Client App Name and Client App Logo upload for Admin/SuperAdmin.</li>
          <li>Header uses clientAppName with fallback to appName; logo falls back to /clientlogo512.png then /logo512.png.</li>
          <li>Runtime PWA manifest references client fields for install name and icons.</li>
        </ul>
        <div style={{ color: '#64748b' }}>
          References: Header, Config, App manifest injection.
        </div>
      </Section>

      <Section title="Dashboard and Financial Visibility">
        <ul>
          <li>The older dashboard heatmap has been removed.</li>
          <li>Dashboard, Sales, and Reports now apply separate grant checks for revenue and profit visibility.</li>
          <li>`view_financials` remains supported for backward compatibility, while the active split model uses `view_revenue` and `view_profit`.</li>
          <li>Dashboard competition scope is also split into assigned-branch and all-branch grants for both cashier leaderboard visibility and branch comparison visibility.</li>
          <li>Dashboard defaults to today for both From and To, while leaderboard and comparison sections can still expand beyond one branch when the correct grants are present.</li>
        </ul>
        <Code>
{`const canViewRevenue = roleLower === 'superadmin'
  || roleLower === 'admin'
  || grants.includes('view_revenue')
  || grants.includes('view_financials');

const canViewProfit = roleLower === 'superadmin'
  || roleLower === 'admin'
  || grants.includes('view_profit')
  || grants.includes('view_financials');`}
        </Code>
      </Section>

      <Section title="Customer Leaderboard and Dashboard Competition">
        <ul>
          <li>The Dashboard now supports customer leaderboard summaries, cashier competition scope, and branch comparison scope as separate visibility concepts.</li>
          <li>Customer leaderboard supports top-10 ranking by amount spent or products bought.</li>
          <li>Customers page includes a dedicated Customer Leaderboard tab for full rankings, plus filters for retail customers, distribution customers, or all customers.</li>
          <li>Leaderboard and comparison results now respect branch-scope grants instead of always collapsing to only the logged-in cashier.</li>
        </ul>
        <Code>
{`// tenantAccess grants used by Dashboard and Sales
'view_dashboard_cashier_assigned'
'view_dashboard_cashier_all'
'view_dashboard_branch_comparison_assigned'
'view_dashboard_branch_comparison_all'`}
        </Code>
      </Section>

      <Section title="Product Specification">
        <ul>
          <li>Builds a readable spec string using units, sizes, and attributes; includes variant labels summary.</li>
          <li>Used across POS, receipts, sales, and labels for descriptive product display.</li>
        </ul>
        <Code>
{`export function productSpec(p) {
  if (!p) return '';
  const parts = [];
  const k = (p.unitKind || 'none').toLowerCase();
  if (k === 'volume' || k === 'mass' || k === 'length') {
    if (p.unitValue != null && p.unitSymbol) parts.push(\`\${p.unitValue} \${p.unitSymbol}\`);
  } else if (k === 'size') {
    if (p.sizeLabel) parts.push(String(p.sizeLabel));
  } else if (k === 'shoe') {
    if (p.shoeSize) parts.push(String(p.shoeSize));
  }
  const attrs = Array.isArray(p.attributes) ? p.attributes : [];
  const attrStr = attrs.filter(a => a && a.key && a.value).map(a => \`\${a.key}: \${a.value}\`).join(', ');
  if (attrStr) parts.push(attrStr);
  if (Array.isArray(p.variants) && p.variants.length > 0) {
    const vLabels = p.variants.map(v => v.label).filter(Boolean).slice(0, 5).join(', ');
    if (vLabels) parts.push(\`Variants: \${vLabels}\${p.variants.length > 5 ? '...' : ''}\`);
  }
  return parts.join(' • ');
}`}
        </Code>
      </Section>

      <Section title="Inventory Adjustments and Audits">
        <ul>
          <li>Sets stock per branch or variant; calculates delta and records audit entries.</li>
          <li>Queues server write offline; reverts local change on enqueue failure.</li>
          <li>Retail adjustment entry now follows the distribution-style UX for quantity-based adjustments while still sending a signed backend delta.</li>
        </ul>
        <Code>
{`function setStockWithAudit(p, variantId, bId, quantity) {
  const oldQty = variantId ? ((p.variants?.find(v => v.id === variantId)?.stockByBranch || {})[bId] || 0) : (p.stockByBranch?.[bId] || 0);
  const delta = Number(quantity) - Number(oldQty);
  const key = \`\${p.id}:\${variantId || 'base'}:\${bId}\`;
  if (!navigator.onLine && !offlineBackupAllowed) { toast.show('Offline: cannot save stock changes', { type: 'error' }); return; }
  setSavingKey(key);
  dispatch(setStock({ productId: p.id, variantId: variantId || undefined, branchId: bId, quantity: Number(quantity) }));
  dispatch(addAudit({ actor: auth.user?.name || 'unknown', actionType: 'stock_set_manual', details: { product: p.name, variant: (p.variants || []).find(v => v.id === variantId)?.label || '', quantity: Number(quantity), delta, branchId: bId }, branchId: bId, offline: !navigator.onLine }));
  const payload = { productId: p.id, branchId: bId, quantity: Number(quantity), actor: auth.user?.name || 'unknown', variantId: variantId || undefined };
  if (!navigator.onLine) {
    enqueueHttp({ collection: 'audits', label: 'Stock set', path: '/api/stock/set', method: 'POST', body: payload })
      .catch(() => { dispatch(setStock({ productId: p.id, variantId: variantId || undefined, branchId: bId, quantity: Number(oldQty) })); toast.show('Failed to save offline', { type: 'error' }); })
      .finally(() => setSavingKey(k => (k === key ? null : k)));
    return;
  }
  stockApi.setStock(payload)
    .catch((e) => { dispatch(setStock({ productId: p.id, variantId: variantId || undefined, branchId: bId, quantity: Number(oldQty) })); toast.show(String(e?.message || 'Failed to save stock'), { type: 'error' }); })
    .finally(() => setSavingKey(k => (k === key ? null : k)));
}`}
        </Code>
      </Section>

      <Section title="Inventory Segregation and Branch-Type Safety">
        <ul>
          <li>Stock writes now resolve inventory type from the real branch type instead of assuming everything is retail.</li>
          <li>Retail, distribution, and warehouse stock are isolated through their own stock maps, and stock-changing routes choose the correct map based on the target branch.</li>
          <li>This segregation now applies across purchases, refunds, adjustments, transfers, direct stock routes, manual stock setting, and related optimistic frontend updates.</li>
          <li>Retail create flows intentionally restrict branch selectors to retail branches where appropriate, while cross-inventory transfer targets can still remain broader.</li>
        </ul>
        <Code>
{`// inventory target resolution concept
const inventoryType = await resolveInventoryTypeFromBranch(branchId, 'retail');
const target = getStockTarget(productDoc, variantId, inventoryType);
const current = getMapQty(target.container, branchId);
setMapQty(target.container, branchId, current + delta);
markInventoryModified(target);`}
        </Code>
      </Section>

      <Section title="Finance and Cash Reconciliation">
        <ul>
          <li>The Finance menu currently centers on Cash Reconciliation workflows that compare daily branch sales against deposited company-account totals.</li>
          <li>Accounts can be branch-specific or shared across branches, and each reconciliation can split deposited amounts across multiple allocations and payment methods.</li>
          <li>Proof-of-deposit uploads are attached per allocation and approvals require manager/director remarks before balances update.</li>
          <li>Backlog detection focuses on sales dates that have revenue but are not yet deposited, without blocking new sales days.</li>
          <li>Dashboard finance summaries and the reconciliation page both derive from approved, pending, and awaiting-deposit totals rather than manual bookkeeping.</li>
        </ul>
        <Code>
{`// reconciliation validation concept
const expectedAmount = sum(selectedSalesDates);
const enteredAmount = sum(allocations.map(a => a.amount));
if (Math.abs(expectedAmount - enteredAmount) > 0.005) {
  throw new Error('Entered amount must exactly match expected sales total');
}`}
        </Code>
      </Section>

      <Section title="GodHand and Tenant Feature Gating">
        <ul>
          <li>GodHand uses the tenant feature catalog to toggle top-level menus, grouped sidebar sections, sub-pages, tabs, runtime capabilities, and grant-backed permissions.</li>
          <li>Newer feature-group coverage now includes finance, dashboard competition scope, serialized inventory access, distribution and warehouse pages, tenant data export/import, and revenue/profit visibility controls.</li>
          <li>Hidden features are removed from menus and also blocked by route and grant checks, which reduces accidental exposure.</li>
          <li>Recommended operator flow: search the feature by page name, switch only the exact items you want, then click Save and test with a user from that tenant.</li>
        </ul>
      </Section>

      <Section title="Ask PT AI Guidance Model">
        <ul>
          <li>Ask PT AI now blends local workflow knowledge with the backend AI response so users get a fast answer first and a richer answer when available.</li>
          <li>For “how to” and “where do I find” questions, the response layer now prefers tutorial-style guidance with menu path, tab names, filters, row actions, and button labels.</li>
          <li>Related Help suggestions are attached to the same AI message so users can continue into nearby workflows without leaving the chat.</li>
          <li>Manual, Docs, and PT AI knowledge are being aligned so a user sees the same workflow language across all help channels.</li>
        </ul>
        <Code>
{`// AskPtAiPage.js response shaping
const tutorialMode = looksLikeHowToQuestion(query);
const answerLines = tutorialMode ? formatTutorialLines(rawAnswerLines) : rawAnswerLines;
const intro = tutorialMode
  ? \`Sure. Follow these steps for "\${query}".\`
  : \`Sure, here is the best help I found for "\${query}".\`;`}
        </Code>
      </Section>

      <Section title="Purchases: Unit Conversion">
        <ul>
          <li>Converts selected pack quantity to base units using pack.factor; derives cost per unit.</li>
          <li>Adjusts local stock and records detailed audit with supplier and expiry info.</li>
        </ul>
        <Code>
{`const price = Number(cost) || 0;
const prod = products.find(p => p.id === productId);
const pack = (prod?.packs || []).find(pk => pk.name === packName);
const factor = pack ? Number(pack.quantity) || 1 : 1;
const baseUnits = Number(qty) * factor;
const cpu = factor > 0 ? (price / factor) : price;
const payload = { productId, branchId, baseUnits, actor: auth.user?.name || 'unknown', supplier: supplier.trim() || '', cost: price, costPerUnit: cpu, expiryDate: expiryDate || undefined, remark: note.trim() || '', variantId: variantId || undefined };`}
        </Code>
      </Section>

      <Section title="Routing, Grants, and Guards">
        <ul>
          <li>ProtectedRoute requires auth, checks feature flags and grants; roles gate admin routes.</li>
          <li>Sidebar honors feature flags and grants; SuperAdmin sees Docs, Server Logs and GodHand when enabled.</li>
          <li>Tenant grant catalogs now include revenue/profit visibility in tenant-side permission management, not only master-level controls.</li>
        </ul>
        <Code>
{`// ProtectedRoute.js
if (!auth.isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
if (feature && !isFeatureEnabled(settings, feature)) return <Navigate to={fallback} replace />;
// grant helper maps view_* <-> see_*`}
        </Code>
      </Section>
      </div>
    </div>
  );
}

export default DocsPage;
