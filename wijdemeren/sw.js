'use strict';

// Bij ELKE wijziging aan index.html of aan een script hoort dit nummer
// omhoog, samen met de ?v= in index.html. De service worker levert
// same-origin bestanden cache-first uit: zonder nieuwe naam blijft
// iedereen de oude pagina zien en lijkt de wijziging niet doorgevoerd.
var CACHE_NAME = 'wijdemeren-v14';
// LET OP: de ?v=-nummers hier moeten exact gelijk zijn aan die in
// index.html. Op v5/v6 liepen ze uiteen, waardoor de precache dode
// bestanden bevatte en de echte scripts pas bij eerste gebruik werden
// gecachet - op een handheld zonder bereik is de app dan halfleeg.
var PRECACHE = [
    './',
    './index.html',
    './css/app.css?v=14',
    './js/api.js?v=14',
    './js/map.js?v=14',
    './js/bevindingen.js?v=14',
    './js/vragenlijst.js?v=14',
    './js/app.js?v=14',
    './libs/leaflet.js',
    './libs/leaflet.css',
    './libs/socket.io.min.js',
    './libs/images/marker-icon.png',
    './libs/images/marker-icon-2x.png',
    './libs/images/marker-shadow.png',
    './libs/images/layers.png',
    './libs/images/layers-2x.png',
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

    // API en WebSocket calls: altijd netwerk. Faalt de verbinding zelf
    // (geen netwerk, certificaat), dan geven we een leesbaar 503-antwoord
    // terug in plaats van de kale 'FetchEvent.respondWith'-fout die op
    // 24-08 een certificaatstoring zeven weken als inlogprobleem vermomde.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
        e.respondWith(
            fetch(e.request).catch(function () {
                return new Response(
                    JSON.stringify({ error: 'Geen verbinding met de server (netwerkfout op dit toestel of storing aan de serverkant).' }),
                    { status: 503, headers: { 'Content-Type': 'application/json' } }
                );
            })
        );
        return;
    }

    // Externe resources (tiles, CDN): network-first met cache fallback
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

    // App bestanden: cache-first
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
