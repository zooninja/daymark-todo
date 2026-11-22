const CACHE_NAME = "daymark-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/daymark-192.png",
  "./icons/daymark-512.png",
  "./icons/daymark-maskable-512.png"
];

function cacheResponse(event, request, response) {
  if (!response.ok) return;
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()))
  );
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(name => name.startsWith("daymark-shell-") && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          cacheResponse(event, request, response);
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match(new URL("./", self.location).href))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      cacheResponse(event, request, response);
      return response;
    }))
  );
});
