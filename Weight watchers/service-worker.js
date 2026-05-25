/* Voedingspunten Tracker — Service Worker
 * Cache-first voor app shell + CDN's. Network-first voor Open Food Facts API.
 * Versie wordt bij elke release verhoogd zodat oude cache wordt opgeruimd.
 */
'use strict';

const VPT_SW_VERSION = 'vpt-v3.1.1-2026-05-25';
const VPT_CACHE_SHELL = `${VPT_SW_VERSION}-shell`;
const VPT_CACHE_RUNTIME = `${VPT_SW_VERSION}-runtime`;

// App-shell: lokale bestanden die altijd offline beschikbaar moeten zijn
const VPT_SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

// CDN-bestanden: bij eerste fetch cachen voor offline gebruik
const VPT_CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
];

// Open Food Facts host (network-first met cache-fallback)
const VPT_OFF_HOST = 'world.openfoodfacts.org';

// ─── INSTALL: precache shell ────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VPT_CACHE_SHELL)
      .then(cache => cache.addAll(VPT_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: oude caches verwijderen ──────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => !k.startsWith(VPT_SW_VERSION)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ─── FETCH: strategie per request-type ──────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Alleen GET-requests cachen
  if (request.method !== 'GET') return;

  // Open Food Facts: network-first met cache-fallback
  if (url.hostname === VPT_OFF_HOST) {
    event.respondWith(networkFirst(request, VPT_CACHE_RUNTIME));
    return;
  }

  // CDN: cache-first met network-fallback
  if (VPT_CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, VPT_CACHE_RUNTIME));
    return;
  }

  // Eigen origin: cache-first (app shell)
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, VPT_CACHE_SHELL));
    return;
  }

  // Andere: gewoon network
});

// ─── STRATEGIEËN ────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Offline: probeer fallback uit shell
    const shell = await caches.open(VPT_CACHE_SHELL);
    const fallback = await shell.match('./index.html');
    return fallback || new Response('Offline en niet in cache', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || new Response(JSON.stringify({ status: 0, status_verbose: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

// ─── MESSAGE: handmatige cache-clear ────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'VPT_CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => event.source && event.source.postMessage({ type: 'VPT_CACHE_CLEARED' }))
    );
  }
});
