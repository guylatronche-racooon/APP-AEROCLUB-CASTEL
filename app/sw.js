const CACHE = "acjd-flight-tools-static-v12-installable";
const CORE = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/data/airfields.json",
];

async function cacheSuccessfulResponse(key, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE);
  await cache.put(key, response.clone());
}

async function networkFirst(request, cacheKey = request) {
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await cacheSuccessfulResponse(cacheKey, response);
    return response;
  } catch (error) {
    const cached = await caches.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
      self.clients.claim(),
    ]),
  );
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const path = new URL(event.request.url).pathname;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "/"));
    return;
  }

  if (path === "/data/airfields.json" || path.startsWith("/documents/")) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
