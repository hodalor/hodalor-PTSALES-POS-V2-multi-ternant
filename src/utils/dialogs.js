export function confirmDialog(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';
    const box = document.createElement('div');
    box.style.background = '#0b1220';
    box.style.color = '#e5e7eb';
    box.style.border = '1px solid #334155';
    box.style.borderRadius = '12px';
    box.style.padding = '16px';
    box.style.width = '360px';
    box.style.maxWidth = '90vw';
    const msg = document.createElement('div');
    msg.textContent = String(message || '');
    msg.style.marginBottom = '16px';
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '8px';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.padding = '8px 12px';
    cancel.style.borderRadius = '8px';
    cancel.style.border = '1px solid #334155';
    cancel.style.background = '#111827';
    cancel.style.color = '#e5e7eb';
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.style.padding = '8px 12px';
    ok.style.borderRadius = '8px';
    ok.style.border = '1px solid #10b981';
    ok.style.background = '#10b981';
    ok.style.color = '#0b1220';
    function cleanup(v) {
      document.body.removeChild(overlay);
      resolve(v);
    }
    cancel.addEventListener('click', () => cleanup(false));
    ok.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(false); }
      if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); cleanup(true); }
    }, { once: true });
    btnRow.appendChild(cancel);
    btnRow.appendChild(ok);
    box.appendChild(msg);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    ok.focus();
  });
}

export function promptDialog(message, defaultValue = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.5)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '9999';
    const box = document.createElement('div');
    box.style.background = '#0b1220';
    box.style.color = '#e5e7eb';
    box.style.border = '1px solid #334155';
    box.style.borderRadius = '12px';
    box.style.padding = '16px';
    box.style.width = '420px';
    box.style.maxWidth = '90vw';
    const msg = document.createElement('div');
    msg.textContent = String(message || '');
    msg.style.marginBottom = '12px';
    const input = document.createElement('input');
    input.value = String(defaultValue || '');
    input.style.width = '100%';
    input.style.padding = '10px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid #334155';
    input.style.background = '#0f172a';
    input.style.color = '#e5e7eb';
    input.style.marginBottom = '12px';
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '8px';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.padding = '8px 12px';
    cancel.style.borderRadius = '8px';
    cancel.style.border = '1px solid #334155';
    cancel.style.background = '#111827';
    cancel.style.color = '#e5e7eb';
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.style.padding = '8px 12px';
    ok.style.borderRadius = '8px';
    ok.style.border = '1px solid #10b981';
    ok.style.background = '#10b981';
    ok.style.color = '#0b1220';
    function cleanup(v) {
      document.body.removeChild(overlay);
      resolve(v);
    }
    cancel.addEventListener('click', () => cleanup(null));
    ok.addEventListener('click', () => cleanup(input.value));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); cleanup(null); }
      if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); cleanup(input.value); }
    }, { once: true });
    box.appendChild(msg);
    box.appendChild(input);
    box.appendChild(btnRow);
    btnRow.appendChild(cancel);
    btnRow.appendChild(ok);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}
