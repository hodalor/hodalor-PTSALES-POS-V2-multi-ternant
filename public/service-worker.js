self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  self.clients.claim();
});
self.addEventListener('fetch', () => {
});
self.addEventListener('message', (event) => {
  if (event && event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
