const CACHE_NAME = 'meldpunt-ondermijning-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Installatie - cache alle assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache geopend, assets worden opgeslagen...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('Alle assets gecached - app werkt nu offline');
        return self.skipWaiting();
      })
  );
});

// Activatie - ruim oude caches op
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('Oude cache verwijderd:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch - serveer vanuit cache, fallback naar netwerk
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request)
          .then((response) => {
            // Niet cachen als het geen geldige response is
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            // Clone en cache nieuwe requests
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
            return response;
          })
          .catch(() => {
            // Offline en niet in cache - voor HTML requests, toon de cached index
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('./index.html');
            }
          });
      })
  );
});
