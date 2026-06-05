// BIBOB Interview Pro v2.0 — Service Worker
// Cache-first strategie voor app-shell. ML-modellen blijven in IndexedDB
// (worden niet via SW gecached — te groot).

const CACHE_NAME = 'bibob-interview-v2.0.3';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/utils.js',
    './js/auth.js',
    './js/storage.js',
    './js/app.js',
    './js/transcribe.js',
    './js/diarize.js',
    './js/recorder.js',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
            .catch((err) => console.error('[SW] install failed:', err))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    // Niet cachen: ML-model downloads van Hugging Face / CDN (te groot)
    // Niet cachen: onnxruntime-web WASM (CDN doet zelf cache-control)
    const url = event.request.url;
    if (url.includes('huggingface.co') ||
        url.includes('cdn.jsdelivr.net/npm/onnxruntime-web') ||
        url.includes('cdn.jsdelivr.net/npm/@xenova/transformers')) {
        // Direct doorlaten — IndexedDB van transformers.js doet het cachen
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((cached) => cached || fetch(event.request))
    );
});
