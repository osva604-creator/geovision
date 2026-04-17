const CACHE_NAME = 'geovision-v2';

// Esta es la lista que me pasaste. 
// Asegúrate de que las rutas coincidan con tus carpetas reales.
const assets = [
    './',
    './index.html',
    './css/style.css',
    './js/script.js',
    './js/geometria.js',
    './manifest.json',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// 1. Instalación: Guarda los archivos en el teléfono
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('LOOP APP: Guardando archivos para modo offline...');
            return cache.addAll(assets);
        })
    );
    self.skipWaiting();
});

// 2. Activación: Limpia cachés antiguos
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        )
    );
    self.clients.claim();
    console.log('LOOP APP: Service Worker Activado');
});

// 3. Estrategia de carga: Si no hay internet, usa el caché
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                const copiedResponse = networkResponse.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, copiedResponse));
                return networkResponse;
            })
            .catch(() => caches.match(event.request).then(response => {
                if (response) return response;
                if (event.request.mode === 'navigate') return caches.match('./index.html');
                return Response.error();
            }))
    );
});