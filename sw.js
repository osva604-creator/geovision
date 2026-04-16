const CACHE_NAME = 'geovision-v1';

// Esta es la lista que me pasaste. 
// Asegúrate de que las rutas coincidan con tus carpetas reales.
const assets = [
    './',
    './index.html',
    './style.css', 
    './script.js',
    './geometria.js',
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
});

// 2. Activación: Limpia cachés antiguos
self.addEventListener('activate', event => {
    console.log('LOOP APP: Service Worker Activado');
});

// 3. Estrategia de carga: Si no hay internet, usa el caché
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});