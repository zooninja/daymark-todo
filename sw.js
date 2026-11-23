const CACHE_NAME = "daymark-shell-v3";
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

self.addEventListener("push", event => {
  let message = {};
  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) message = parsed;
    } catch (error) {
      message = { body: event.data.text() };
    }
  }
  const title = typeof message.title === "string" ? message.title : "Daymark reminder";
  const body = typeof message.body === "string" ? message.body : "A task deadline is approaching.";
  const data = message.data && typeof message.data === "object" ? message.data : {};
  let url = new URL("./", self.location.origin).href;
  if (typeof data.url === "string") {
    try {
      const candidate = new URL(data.url, self.location.origin);
      if (candidate.origin === self.location.origin) url = candidate.href;
    } catch (error) {
      url = new URL("./", self.location.origin).href;
    }
  }
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: typeof message.tag === "string" ? message.tag : "daymark-reminder",
    icon: "./icons/daymark-192.png",
    badge: "./icons/daymark-192.png",
    data: { url }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url
    : new URL("./", self.location.origin).href;
  let safeUrl;
  try {
    safeUrl = new URL(url, self.location.origin);
  } catch (error) {
    safeUrl = new URL("./", self.location.origin);
  }
  if (safeUrl.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(safeUrl.href);
  })());
});
