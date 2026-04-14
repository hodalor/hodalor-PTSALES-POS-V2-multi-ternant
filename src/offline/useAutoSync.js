import { useEffect } from 'react';
import { attemptSync } from './queue';

function useAutoSync(syncHandler) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('indexedDB' in window)) {
      return () => {};
    }
    let mounted = true;
    function handleOnline() {
      if (!mounted) return;
      attemptSync(syncHandler);
    }
    if (navigator.onLine) {
      attemptSync(syncHandler);
    }
    window.addEventListener('online', handleOnline);
    return () => {
      mounted = false;
      window.removeEventListener('online', handleOnline);
    };
  }, [syncHandler]);
}

export default useAutoSync;
