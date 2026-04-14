let _bipEvent = null;

export function setBeforeInstallPromptEvent(e) {
  _bipEvent = e;
}

export function getBeforeInstallPromptEvent() {
  return _bipEvent;
}

export function clearBeforeInstallPromptEvent() {
  _bipEvent = null;
}

export function isInstalled() {
  try {
    const m = window.matchMedia && window.matchMedia('(display-mode: standalone)');
    const standalone = !!(m && m.matches);
    const iosStandalone = !!(navigator && 'standalone' in navigator && navigator.standalone);
    return standalone || iosStandalone;
  } catch {
    return false;
  }
}

export async function isRelatedInstalled() {
  try {
    const api = navigator.getInstalledRelatedApps;
    if (!api) return false;
    const list = await api.call(navigator);
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}

export async function checkUpdateAndOpen(startUrl = '/') {
  try {
    if (!('serviceWorker' in navigator)) {
      window.open(startUrl, '_blank', 'noopener,noreferrer');
      return 'no-sw';
    }
    const reg = await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.ready;
    if (!reg) {
      window.open(startUrl, '_blank', 'noopener,noreferrer');
      return 'no-registration';
    }
    try { await reg.update(); } catch {}
    const waiting = reg.waiting;
    if (waiting) {
      waiting.postMessage('SKIP_WAITING');
      await new Promise((resolve) => {
        const onChange = () => {
          navigator.serviceWorker.removeEventListener('controllerchange', onChange);
          resolve();
        };
        navigator.serviceWorker.addEventListener('controllerchange', onChange);
      });
    }
    window.open(startUrl, '_blank', 'noopener,noreferrer');
    return waiting ? 'updated' : 'up-to-date';
  } catch {
    try {
      window.open(startUrl, '_blank', 'noopener,noreferrer');
    } catch {}
    return 'error';
  }
}
