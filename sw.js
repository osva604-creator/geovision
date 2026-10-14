const CACHE_NAME = "geovision-public-v12";
const APP_SHELL = [
    "./",
    "./index.html",
    "./css/style.css",
    "./js/script.js",
    "./js/auth.js",
    "./js/geometria.js",
    "./js/camera-projection.js",
    "./js/kmz.js",
    "./js/raster.js",
    "./js/raster-import.js",
    "./js/raster-worker.js",
    "./js/geopdf.js",
    "./js/satellite-layers.js",
    "./manifest.json",
    "./assets/brand/logos/geovision-logo.png",
    "./assets/brand/icons/geovision-icon-512.png",
    "./assets/brand/icons/geovision-icon-maskable-512.png",
    "./assets/brand/icons/geovision-icon-192.png",
    "./assets/brand/icons/geovision-icon-48.png",
    "./assets/brand/icons/favicon.png",
    "./assets/brand/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("geovision-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    // Nunca interceptar API, tokens, Clerk ni recursos de terceros.
    if (event.request.headers.has("Authorization") || url.origin !== self.location.origin || url.search ||
        !APP_SHELL.some(path => new URL(path, self.location.href).pathname === url.pathname)) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.ok && !response.headers.get("Cache-Control")?.includes("no-store")) {
                    const copy = response.clone();
                    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
                }
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
