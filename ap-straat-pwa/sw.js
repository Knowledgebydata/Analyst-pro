const CACHE_NAME = 'ap-straat-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const EXTERNAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.ttf'
];

// Installatie - cache alles
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching static assets...');
        return Promise.all([
          cache.addAll(STATIC_ASSETS),
          // Cache externe assets apart (kunnen falen)
          ...EXTERNAL_ASSETS.map(url => 
            cache.add(url).catch(err => console.log('Could not cache:', url))
          )
        ]);
      })
      .then(() => {
        console.log('AP Straat gecached - werkt nu offline');
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

// Fetch - cache-first strategie
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request)
          .then((response) => {
            // Niet cachen als het geen geldige response is
            if (!response || response.status !== 200) {
              return response;
            }

            // Clone en cache nieuwe requests (inclusief fonts)
            const responseToCache = response.clone();
            const url = event.request.url;

            // Cache Font Awesome resources en andere assets
            if (url.includes('cdnjs.cloudflare.com') || 
                url.includes('font-awesome') ||
                response.type === 'basic') {
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache);
                });
            }

            return response;
          })
          .catch(() => {
            // Offline en niet in cache
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('./index.html');
            }
          });
      })
  );
});
