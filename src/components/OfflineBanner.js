import { useEffect, useState } from 'react';

function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div style={{ background: '#ffcc00', color: '#000', padding: '8px 12px' }}>
      Offline mode. Actions will queue and sync when online.
    </div>
  );
}

export default OfflineBanner;
