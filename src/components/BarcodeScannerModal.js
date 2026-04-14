import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';

function BarcodeScannerModal({ title = 'Scan Barcode', open, onClose, onDetected }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const [error, setError] = useState('');
  const supported = useMemo(() => typeof window !== 'undefined' && 'BarcodeDetector' in window, []);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    async function start() {
      if (!supported) {
        setError('Camera barcode scanning is not supported in this browser. Use a hardware scanner or manual IMEI entry.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!active) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'] });
        timerRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const results = await detector.detect(videoRef.current);
            const raw = results?.[0]?.rawValue;
            if (raw) {
              if (timerRef.current) clearInterval(timerRef.current);
              timerRef.current = null;
              onDetected && onDetected(String(raw));
            }
          } catch {}
        }, 350);
      } catch (e) {
        setError(String(e?.message || 'Failed to start camera'));
      }
    }
    setError('');
    start();
    return () => {
      active = false;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [onDetected, open, supported]);

  if (!open) return null;

  return (
    <Modal title={title} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ color: '#64748b', fontSize: 12 }}>
          Point the camera at the IMEI barcode. Detection runs continuously until a code is found.
        </div>
        <div style={{ borderRadius: 12, overflow: 'hidden', background: '#000', minHeight: 280, display: 'grid', placeItems: 'center' }}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', maxHeight: 420, objectFit: 'cover' }} />
        </div>
        {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      </div>
    </Modal>
  );
}

export default BarcodeScannerModal;
