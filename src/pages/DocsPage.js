import { Link } from 'react-router-dom';

function Section({ title, children }) {
  return (
    <section className="card" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
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
  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ marginTop: 0 }}>Technical Documentation</h1>
        <div style={{ color: '#64748b' }}>
          Architecture, modules, and implementation references across the app. SuperAdmin‑only.
        </div>
      </div>

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
          <li>Redux store is persisted to localStorage (auth, cart, settings, branches, products, users, sales, audit, sessions) to enable fully offline operation.</li>
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

      <Section title="Data Visualization: Heatmap">
        <ul>
          <li>Aggregates hourly revenue over selected period (day/week/month) into a 24-hour grid per day.</li>
          <li>Computes max cell value to normalize color intensity for consistent visualization.</li>
        </ul>
        <Code>
{`const daysBack = heatMode === 'day' ? 1 : heatMode === 'month' ? 30 : 7;
const end = new Date();
const start = new Date(end.getTime() - daysBack * 24 * 3600 * 1000);
const days = [];
const d0 = new Date(start.toISOString().slice(0, 10));
const d1 = new Date(end.toISOString().slice(0, 10));
for (let t = d0.getTime(); t <= d1.getTime(); t += 24 * 3600 * 1000) days.push(new Date(t));
const grid = days.map(d => ({ day: d.toISOString().slice(0, 10), hours: new Array(24).fill(0) }));
const idxByDay = new Map(grid.map((r, i) => [r.day, i]));
for (const s of last30Sales) {
  const dt = new Date(s.created_at);
  const day = dt.toISOString().slice(0, 10);
  const i = idxByDay.get(day);
  if (i == null) continue;
  grid[i].hours[dt.getHours()] += Number(s.total) || 0;
}
let max = 0;
for (const r of grid) for (const v of r.hours) max = Math.max(max, v);
const heatmap = { grid, max };`}
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
        </ul>
        <Code>
{`// ProtectedRoute.js
if (!auth.isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
if (feature && !isFeatureEnabled(settings, feature)) return <Navigate to={fallback} replace />;
// grant helper maps view_* <-> see_*`}
        </Code>
      </Section>
    </div>
  );
}

export default DocsPage;
