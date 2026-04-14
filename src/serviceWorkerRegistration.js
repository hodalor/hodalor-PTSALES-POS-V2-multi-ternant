const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(
      /^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/
    )
);

export function register(config) {
  if (!('serviceWorker' in navigator)) return;
  const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
  if (publicUrl.origin !== window.location.origin) return;

  window.addEventListener('load', () => {
    const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;
    if (isLocalhost) {
      checkValidServiceWorker(swUrl, config);
      navigator.serviceWorker.ready.then(() => {});
    } else {
      registerValidSW(swUrl, config);
    }
  });
}

function registerValidSW(swUrl, config) {
  navigator.serviceWorker
    .register(swUrl)
    .then(registration => {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.onstatechange = () => {
          if (installingWorker.state !== 'installed') return;
          if (navigator.serviceWorker.controller) {
            if (config && config.onUpdate) config.onUpdate(registration);
          } else {
            if (config && config.onSuccess) config.onSuccess(registration);
          }
        };
      };
    })
    .catch(() => {});
}

function checkValidServiceWorker(swUrl, config) {
  fetch(swUrl, { headers: { 'Service-Worker': 'script' } })
    .then(response => {
      const contentType = response.headers.get('content-type') || '';
      if (response.status === 404 || !contentType.includes('javascript')) {
        navigator.serviceWorker.ready
          .then(registration => {
            registration.unregister().then(() => {
              window.location.reload();
            });
          })
          .catch(() => {});
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {});
}

export function unregister() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then(registration => {
      registration.unregister();
    })
    .catch(() => {});
}
