import { translateDocumentLanguage } from './localization';

function createOverlay() {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(2, 6, 23, 0.72)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: '9999',
    backdropFilter: 'blur(5px)'
  });
  return overlay;
}

function createDialogBox(width = '420px') {
  const box = document.createElement('div');
  Object.assign(box.style, {
    width,
    maxWidth: '92vw',
    display: 'grid',
    gap: '14px',
    padding: '20px',
    borderRadius: '20px',
    border: '1px solid rgba(148, 163, 184, 0.18)',
    background: 'linear-gradient(180deg, #050816 0%, #020617 100%)',
    color: '#e5e7eb',
    boxShadow: '0 28px 60px rgba(2, 6, 23, 0.32)'
  });
  return box;
}

function createMessageNode(message) {
  const msg = document.createElement('div');
  msg.textContent = String(message || '');
  Object.assign(msg.style, {
    fontSize: '15px',
    lineHeight: '1.55',
    fontWeight: '700',
    color: '#f8fafc',
    letterSpacing: '-0.01em'
  });
  return msg;
}

function createButton(label, kind = 'secondary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  Object.assign(button.style, {
    padding: '10px 14px',
    borderRadius: '12px',
    border: kind === 'primary' ? '1px solid #16a34a' : '1px solid rgba(148, 163, 184, 0.22)',
    background: kind === 'primary'
      ? 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)'
      : 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(17,24,39,0.95) 100%)',
    color: kind === 'primary' ? '#ffffff' : '#e5e7eb',
    fontWeight: '800',
    cursor: 'pointer',
    boxShadow: kind === 'primary' ? '0 12px 24px rgba(22,163,74,0.22)' : 'none'
  });
  return button;
}

function createButtonRow() {
  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    flexWrap: 'wrap'
  });
  return btnRow;
}

export function confirmDialog(message) {
  return new Promise(resolve => {
    const overlay = createOverlay();
    const box = createDialogBox('380px');
    const msg = createMessageNode(message);
    const btnRow = createButtonRow();
    const cancel = createButton(translateDocumentLanguage('Cancel'));
    const ok = createButton(translateDocumentLanguage('OK'), 'primary');
    let finished = false;

    function cleanup(value) {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) document.body.removeChild(overlay);
      resolve(value);
    }

    function onKey(e) {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    }

    cancel.addEventListener('click', () => cleanup(false));
    ok.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', onKey);

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
    const overlay = createOverlay();
    const box = createDialogBox('460px');
    const msg = createMessageNode(message);
    const useTextarea = /remark|reason|note|description/i.test(String(message || '')) || String(defaultValue || '').includes('\n');
    const input = document.createElement(useTextarea ? 'textarea' : 'input');
    input.value = String(defaultValue || '');
    if (useTextarea) input.rows = 4;
    Object.assign(input.style, {
      width: '100%',
      minHeight: useTextarea ? '104px' : 'unset',
      padding: '12px 14px',
      borderRadius: '14px',
      border: '1px solid rgba(148, 163, 184, 0.2)',
      background: 'linear-gradient(180deg, #0f172a 0%, #111827 100%)',
      color: '#e5e7eb',
      boxSizing: 'border-box',
      fontSize: '14px',
      lineHeight: '1.5',
      resize: useTextarea ? 'vertical' : 'none',
      outline: 'none',
      boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.12)'
    });
    input.setAttribute('placeholder', useTextarea ? translateDocumentLanguage('Type here...') : translateDocumentLanguage('Enter value'));
    const btnRow = createButtonRow();
    const cancel = createButton(translateDocumentLanguage('Cancel'));
    const ok = createButton(translateDocumentLanguage('OK'), 'primary');
    let finished = false;

    function cleanup(value) {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) document.body.removeChild(overlay);
      resolve(value);
    }

    function onKey(e) {
      if (e.key === 'Escape') cleanup(null);
      if (!useTextarea && e.key === 'Enter') cleanup(input.value);
      if (useTextarea && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) cleanup(input.value);
    }

    cancel.addEventListener('click', () => cleanup(null));
    ok.addEventListener('click', () => cleanup(input.value));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
    document.addEventListener('keydown', onKey);

    box.appendChild(msg);
    box.appendChild(input);
    box.appendChild(btnRow);
    btnRow.appendChild(cancel);
    btnRow.appendChild(ok);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();
    if (typeof input.select === 'function') input.select();
  });
}
