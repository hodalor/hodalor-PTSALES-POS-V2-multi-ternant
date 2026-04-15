import React, { useEffect } from 'react';

export default function Modal({ title, children, onClose, footer, variant = 'dark' }) {
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const isLight = variant === 'light';
  const panelBg = isLight ? '#ffffff' : '#000000';
  const panelColor = isLight ? '#0f172a' : '#e5e7eb';
  const panelBorder = isLight ? '#e2e8f0' : '#111827';
  const closeColor = isLight ? '#475569' : '#94a3b8';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(2px)'
    }} onClick={onClose}>
      <div style={{
        background: panelBg, 
        color: panelColor,
        border: `1px solid ${panelBorder}`,
        borderRadius: 12, 
        width: '90%', 
        maxWidth: 700, 
        maxHeight: '90vh', 
        display: 'flex', 
        flexDirection: 'column',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${panelBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: closeColor }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div style={{ padding: '24px', overflowY: 'auto' }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '16px 24px', borderTop: `1px solid ${panelBorder}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
