import { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import EAN13Barcode from '../components/EAN13Barcode';
import { productSpec } from '../utils/productSpec';

function LabelsPage() {
  const products = useSelector(s => s.products.products);
  const [query, setQuery] = useState('');
  const [copies, setCopies] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const flattened = useMemo(() => {
    const out = [];
    products.forEach(p => {
      if (Array.isArray(p.variants) && p.variants.length > 0) {
        p.variants.forEach(v => {
          out.push({
            id: `${p.id}:${v.id}`,
            name: `${p.name} (${v.label})`,
            sku: v.sku || `${p.sku}-${v.label}`,
            barcode: v.barcode || p.barcode,
            variantId: v.id,
            productId: p.id,
            unitKind: p.unitKind, unitValue: p.unitValue, unitSymbol: p.unitSymbol, sizeLabel: p.sizeLabel, shoeSize: p.shoeSize, attributes: p.attributes
          });
        });
      } else {
        out.push(p);
      }
    });
    return out;
  }, [products]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flattened;
    return flattened.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q) ||
      productSpec(p).toLowerCase().includes(q)
    );
  }, [flattened, query]);

  function printLabels() {
    const list = selected.size > 0 ? filtered.filter(p => selected.has(p.id)) : filtered;
    const html = buildPrintHtml(list, copies);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>Barcode Labels</h1>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="filter-actions">
          <input className="input" placeholder="Search by name, SKU or barcode" value={query} onChange={e => setQuery(e.target.value)} style={{ width: '100%' }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Copies</span>
            <input className="input" type="number" min="1" value={copies} onChange={e => setCopies(Math.max(1, Number(e.target.value)))} style={{ width: 100 }} />
          </label>
          <button className="btn" onClick={() => setSelected(new Set(filtered.map(p => p.id)))}>Select All</button>
          <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
          <button className="btn btn-primary" onClick={printLabels}>
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 9V3h12v6" stroke="currentColor" strokeWidth="2"/><path d="M6 17h12v4H6z" stroke="currentColor" strokeWidth="2"/><path d="M4 9h16a2 2 0 012 2v2H2v-2a2 2 0 012-2z" stroke="currentColor" strokeWidth="2"/></svg>
            {selected.size > 0 ? 'Print Selected' : 'Print All'}
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {filtered.map(p => (
          <label key={p.id} className="card" style={{ display: 'grid', gap: 6, alignItems: 'center', position: 'relative' }}>
            <input
              type="checkbox"
              checked={selected.has(p.id)}
              onChange={e => {
                setSelected(prev => {
                  const s = new Set(prev);
                  if (e.target.checked) s.add(p.id); else s.delete(p.id);
                  return s;
                });
              }}
              style={{ position: 'absolute', top: 8, right: 8 }}
              aria-label={`Select ${p.name}`}
            />
            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
            {productSpec(p) && <div style={{ color: '#64748b', fontSize: 12 }}>{productSpec(p)}</div>}
            <div style={{ color: '#64748b', fontSize: 12 }}>{p.sku}</div>
            <div style={{ display: 'grid', placeItems: 'center', padding: 4, background: '#ffffff' }}>
              {p.barcode ? <EAN13Barcode value={p.barcode} width={2} height={70} /> : <div style={{ color: '#ef4444' }}>No barcode</div>}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function buildPrintHtml(products, copies) {
  const items = [];
  products.forEach(p => {
    for (let i = 0; i < copies; i++) {
      items.push(p);
    }
  });
  const slots = items.map((p, idx) => `
    <div class="label">
      <div class="name">${escapeHtml(p.name || '')}${productSpec(p) ? ' — ' + escapeHtml(productSpec(p)) : ''}</div>
      <div class="sku">${escapeHtml(p.sku || '')}</div>
      <div class="svg">${renderBarcodeSvgString(p.barcode)}</div>
    </div>
  `).join('');
  const html = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Labels</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8mm; }
        .label { border: 1px dashed #cbd5e1; padding: 6mm 4mm; display: grid; align-items: center; }
        .name { font-size: 12pt; font-weight: 700; }
        .sku { font-size: 9pt; color: #64748b; margin-bottom: 2mm; }
        .svg { display: grid; place-items: center; }
        .svg svg { width: 100%; height: auto; }
        @media print {
          .label { border: none; }
        }
      </style>
    </head>
    <body>
      <div class="grid">
        ${slots}
      </div>
    </body>
  </html>
  `;
  return html;
}

function renderBarcodeSvgString(value) {
  let raw = String(value || '').replace(/\D/g, '');
  if (raw.length === 12) raw = raw + ean13CheckDigit(raw);
  if (raw.length !== 13) return '<div>No barcode</div>';
  const pattern = encodeEAN13(raw);
  const width = 2;
  const height = 70;
  const fontSize = 12;
  const modules = pattern.split('').map(c => c === '1');
  const w = modules.length * width;
  const H = height + fontSize + 6;
  let rects = '';
  let i = 0;
  while (i < modules.length) {
    if (!modules[i]) { i++; continue; }
    let run = 1;
    while (i + run < modules.length && modules[i + run]) run++;
    const x = i * width;
    let h = height;
    if (i === 0 || (i === 2) || (i === 45) || (i === 47) || (i === 92) || (i === 94)) {
      h = height + 6;
    }
    rects += `<rect x="${x}" y="0" width="${run * width}" height="${h}" fill="#000000" />`;
    i += run;
  }
  return `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${w}" height="${H}" fill="#ffffff" />${rects}<text x="${w/2}" y="${height + fontSize}" font-family="monospace" font-size="${fontSize}" text-anchor="middle" fill="#000000">${raw}</text></svg>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function lCodes(d){return ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'][d];}
function gCodes(d){return ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'][d];}
function rCodes(d){return ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'][d];}
const parityMap = {'0':'LLLLLL','1':'LLGLGG','2':'LLGGLG','3':'LLGGGL','4':'LGLLGG','5':'LGGLLG','6':'LGGGLL','7':'LGLGLG','8':'LGLGGL','9':'LGGLGL'};
function ean13CheckDigit(d12){let sum=0;for(let i=0;i<12;i++){const d=Number(d12[i]);sum+=(i%2===0)?d:d*3;}const mod=sum%10;return String((10-mod)%10);}
function encodeEAN13(digits13){const d=digits13.split('').map(ch=>Number(ch));const first=String(d[0]);const parity=parityMap[first];let pattern='101';for(let i=1;i<=6;i++){const digit=d[i];const side=parity[i-1];const bits=side==='L'?lCodes(digit):gCodes(digit);pattern+=bits;}pattern+='01010';for(let i=7;i<=12;i++){const digit=d[i];const bits=rCodes(digit);pattern+=bits;}pattern+='101';return pattern;}

export default LabelsPage;
