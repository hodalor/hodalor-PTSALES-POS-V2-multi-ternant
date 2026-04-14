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
  const styles = `
    <style>
      body { font-family: Arial, sans-serif; padding: 16px; color: #0f172a; }
      h1 { margin: 0 0 12px; font-size: 18px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f8fafc; }
    </style>`;
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
      <h1>${escapeHtml(title)}</h1>
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
