const CACHE_NAME = "geovision-v4";
const APP_SHELL = [
    "./",
    "./index.html",
    "./css/style.css",
    "./js/script.js",
    "./js/geometria.js",
    "./manifest.json",
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js",
    "https://cdn.jsdelivr.net/npm/leaflet-geometryutil@0.10.3/src/leaflet.geometryutil.min.js"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
    );
    self.clients.claim();
});

function esRecursoMapa(url) {
    return url.includes(".google.com/vt/") || url.includes("tile.openstreetmap.org");
}

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    const requestURL = event.request.url;
    if (esRecursoMapa(requestURL)) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                const networkPromise = fetch(event.request)
                    .then((response) => {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                        return response;
                    })
                    .catch(() => cached || Response.error());
                return cached || networkPromise;
            })
        );
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                return response;
            })
            .catch(() =>
                caches.match(event.request).then((cached) => {
                    if (cached) return cached;
                    if (event.request.mode === "navigate") return caches.match("./index.html");
                    return Response.error();
                })
            )
    );
});