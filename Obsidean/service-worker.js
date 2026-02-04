// Service Worker for Knowledge PWA
const CACHE_NAME = 'knowledge-v1';
const RUNTIME_CACHE = 'knowledge-runtime-v1';

// Resources to cache immediately
const PRECACHE_URLS = [
    './knowledge-pwa.html',
    './manifest.json'
];

// CDN resources to cache
const CDN_URLS = [
    'https://unpkg.com/react@18/umd/react.production.min.js',
    'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
    'https://unpkg.com/@babel/standalone/babel.min.js',
    'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
    'https://fonts.googleapis.com/css2?family=Literata:ital,wght@0,300;0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600&display=swap'
];

// Install event - cache essential resources
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Precaching app shell');
                return cache.addAll(PRECACHE_URLS);
            })
            .then(() => {
                console.log('[Service Worker] Skip waiting');
                return self.skipWaiting();
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
                            console.log('[Service Worker] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('[Service Worker] Claiming clients');
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip chrome-extension and other non-http(s) requests
    if (!url.protocol.startsWith('http')) {
        return;
    }

    event.respondWith(
        caches.match(request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    console.log('[Service Worker] Serving from cache:', request.url);
                    return cachedResponse;
                }

                // Not in cache, fetch from network
                return fetch(request)
                    .then((response) => {
                        // Don't cache non-successful responses
                        if (!response || response.status !== 200 || response.type === 'error') {
                            return response;
                        }

                        // Clone the response
                        const responseToCache = response.clone();

                        // Cache CDN resources and same-origin requests
                        if (url.origin === location.origin || CDN_URLS.some(cdn => request.url.startsWith(cdn))) {
                            caches.open(RUNTIME_CACHE)
                                .then((cache) => {
                                    console.log('[Service Worker] Caching new resource:', request.url);
                                    cache.put(request, responseToCache);
                                });
                        }

                        return response;
                    })
                    .catch((error) => {
                        console.error('[Service Worker] Fetch failed:', error);
                        
                        // Return offline page for navigation requests
                        if (request.mode === 'navigate') {
                            return caches.match('./knowledge-pwa.html');
                        }
                        
                        throw error;
                    });
            })
    );
});

// Message event - handle commands from app
self.addEventListener('message', (event) => {
    console.log('[Service Worker] Message received:', event.data);

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CACHE_URLS') {
        event.waitUntil(
            caches.open(RUNTIME_CACHE)
                .then((cache) => {
                    return cache.addAll(event.data.urls);
                })
        );
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys()
                .then((cacheNames) => {
                    return Promise.all(
                        cacheNames.map((cacheName) => {
                            if (cacheName === RUNTIME_CACHE) {
                                return caches.delete(cacheName);
                            }
                        })
                    );
                })
                .then(() => {
                    console.log('[Service Worker] Runtime cache cleared');
                })
        );
    }
});

// Push notification event (for future use)
self.addEventListener('push', (event) => {
    console.log('[Service Worker] Push received:', event);
    
    const options = {
        body: event.data ? event.data.text() : 'New notification',
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"%3E%3Crect width="192" height="192" rx="40" fill="%234A90E2"/%3E%3Cpath d="M60 70h72v12H60zm0 24h72v12H60zm0 24h48v12H60z" fill="%23fff"/%3E%3C/svg%3E',
        badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"%3E%3Ccircle cx="48" cy="48" r="48" fill="%234A90E2"/%3E%3C/svg%3E',
        vibrate: [200, 100, 200],
        tag: 'knowledge-notification'
    };

    event.waitUntil(
        self.registration.showNotification('Knowledge', options)
    );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
    console.log('[Service Worker] Notification clicked:', event);
    
    event.notification.close();
    
    event.waitUntil(
        clients.openWindow('./')
    );
});

// Sync event (for future background sync)
self.addEventListener('sync', (event) => {
    console.log('[Service Worker] Background sync:', event.tag);
    
    if (event.tag === 'sync-notes') {
        event.waitUntil(
            // Future: sync notes logic here
            Promise.resolve()
        );
    }
});

console.log('[Service Worker] Loaded');
