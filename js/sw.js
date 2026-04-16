// =========================================================
//1. servis worker para modo offline
// =========================================================
const CACHE_NAME = 'geovision-v1';
// Agrega aquí las rutas exactas de tus archivos
const assets = [
    './',
    './index.html',
    './css/style.css',
    './js/script.js',
    './js/geometria.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/exif-js/2.3.0/exif.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(assets))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});