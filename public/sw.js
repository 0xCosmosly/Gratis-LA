const CACHE_NAME = 'gratis-la-shell-v13';
const scopePath = self.location.pathname.replace(/[^/]*$/, '');
const withScope = (path = '') => new URL(path, self.location.origin + scopePath).pathname;
const APP_SHELL = [
  withScope(''),
  withScope('index.html'),
  withScope('manifest.webmanifest'),
  withScope('apple-touch-icon.png'),
  withScope('icon-192.png'),
  withScope('icon-512.png')
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          const responseCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
          return networkResponse;
        })
        .catch(() => {
          // If it's a navigation request (asking for an HTML page), return the cached index.html
          if (event.request.mode === 'navigate' || (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
            return caches.match(withScope('index.html'));
          }
          // Otherwise, just let the request fail instead of serving HTML as JS/CSS
          return new Response('', { status: 408, statusText: 'Request Timeout' });
        });
    })
  );
});
