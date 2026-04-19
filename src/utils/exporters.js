export function exportCsv(filename, headers, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = headers.map(h => escape(h.label)).join(',');
  const lines = rows.map(r => headers.map(h => escape(typeof h.value === 'function' ? h.value(r) : r[h.key])).join(','));
  const csv = [head].concat(lines).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportTablePdf(title, headers, rows, options = {}) {
  const letterhead = options?.letterhead || null;
  const styles = `
    <style>
      body { font-family: Arial, sans-serif; padding: 16px; color: #0f172a; }
      h1 { margin: 0 0 12px; font-size: 18px; }
      .letterhead { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
      .letterhead-logo { width: 64px; height: 64px; object-fit: contain; border-radius: 8px; background: #fff; border: 1px solid #e2e8f0; }
      .letterhead-title { margin: 0 0 4px; font-size: 20px; font-weight: 800; }
      .letterhead-line { margin: 2px 0; font-size: 12px; color: #334155; }
      .report-title { margin: 0 0 12px; font-size: 18px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f8fafc; }
    </style>`;
  const letterheadHtml = letterhead ? `
      <div class="letterhead">
        ${letterhead.logoUrl ? `<img class="letterhead-logo" src="${escapeHtml(letterhead.logoUrl)}" alt="logo" onerror="if(this.src.endsWith('/clientlogo512.png')) this.src='/logo512.png'; else this.src='/clientlogo512.png';" />` : ''}
        <div>
          <div class="letterhead-title">${escapeHtml(letterhead.companyName || '')}</div>
          ${letterhead.branch ? `<div class="letterhead-line"><strong>Branch:</strong> ${escapeHtml(letterhead.branch)}</div>` : ''}
          ${letterhead.phone ? `<div class="letterhead-line"><strong>Phone:</strong> ${escapeHtml(letterhead.phone)}</div>` : ''}
          ${letterhead.address ? `<div class="letterhead-line"><strong>Address:</strong> ${escapeHtml(letterhead.address)}</div>` : ''}
        </div>
      </div>` : '';
  const head = `<tr>${headers.map(h => `<th>${escapeHtml(h.label)}</th>`).join('')}</tr>`;
  const body = rows.map(r => {
    const tds = headers.map(h => {
      const val = typeof h.value === 'function' ? h.value(r) : r[h.key];
      return `<td>${escapeHtml(String(val ?? ''))}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8" />${styles}</head>
    <body>
      ${letterheadHtml}
      <h1 class="report-title">${escapeHtml(title)}</h1>
      <table>${head}${body}</table>
    </body>
    </html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 300);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
