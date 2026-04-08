'use strict';

/**
 * Service Worker voor Wijdemeren Handhaving PWA.
 *
 * Werkt in een subdirectory (/wijdemeren/) op GitHub Pages.
 * API-calls gaan cross-origin naar vakantieparken.knowledgebydata.nl.
 */
var CACHE_NAME = 'wijdemeren-v5';

// Relatieve paden — werken vanuit de SW scope (de map waar sw.js staat)
var PRECACHE = [
    './',
    './index.html',
    './css/app.css?v=4',
    './js/api.js?v=4',
    './js/map.js?v=4',
    './js/bevindingen.js?v=4',
    './js/app.js?v=4',
    './manifest.json',
    './icons/favicon.svg',
];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(PRECACHE);
        }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(
                names.filter(function (n) { return n !== CACHE_NAME; })
                     .map(function (n) { return caches.delete(n); })
            );
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (e) {
    var url = new URL(e.request.url);

    // API calls naar de backend server: altijd netwerk, nooit cachen
    if (url.hostname === 'vakantieparken.knowledgebydata.nl') {
        e.respondWith(fetch(e.request));
        return;
    }

    // WebSocket/Socket.IO: altijd netwerk
    if (url.pathname.indexOf('/socket.io/') !== -1) {
        e.respondWith(fetch(e.request));
        return;
    }

    // Externe resources (tiles, CDN libs): network-first met cache fallback
    if (url.origin !== location.origin) {
        e.respondWith(
            fetch(e.request).then(function (res) {
                if (res.ok) {
                    var c = res.clone();
                    caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, c); });
                }
                return res;
            }).catch(function () { return caches.match(e.request); })
        );
        return;
    }

    // App bestanden: cache-first met netwerk fallback
    e.respondWith(
        caches.match(e.request).then(function (cached) {
            if (cached) { return cached; }
            return fetch(e.request).then(function (res) {
                if (res.ok) {
                    var c = res.clone();
                    caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, c); });
                }
                return res;
            });
        })
    );
});
