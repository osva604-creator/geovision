const CACHE_NAME = "geovision-v8";
const APP_SHELL = [
    "./",
    "./index.html",
    "./css/style.css",
    "./js/script.js",
    "./js/geometria.js",
    "./manifest.json",
    "./assets/Gemini_Generated_Image_rz44r6rz44r6rz44.png",
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js",
    "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
    "https://cdn.jsdelivr.net/npm/leaflet-geometryutil@0.10.3/src/leaflet.geometryutil.min.js"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.allSettled(
                APP_SHELL.map((url) =>
                    cache.add(url).catch((error) => {
                        console.warn("No se pudo precachear:", url, error);
                    })
                )
            )
        )
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

function esRecursoDinamico(url) {
    return url.includes("api.openweathermap.org") || url.includes("gateway-dji-farm");
}

function cachearSiCorresponde(request, response) {
    if (!response || (!response.ok && response.type !== "opaque")) {
        return response;
    }
    const copy = response.clone();
    caches.open(CACHE_NAME)
        .then((cache) => cache.put(request, copy))
        .catch((error) => console.warn("No se pudo guardar en cache:", request.url, error));
    return response;
}

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;

    const requestURL = event.request.url;
    if (esRecursoDinamico(requestURL)) return;

    if (esRecursoMapa(requestURL)) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                const networkPromise = fetch(event.request)
                    .then((response) => cachearSiCorresponde(event.request, response))
                    .catch(() => cached || Response.error());
                return cached || networkPromise;
            })
        );
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => cachearSiCorresponde(event.request, response))
            .catch(() =>
                caches.match(event.request).then((cached) => {
                    if (cached) return cached;
                    if (event.request.mode === "navigate") return caches.match("./index.html");
                    return Response.error();
                })
            )
    );
});
