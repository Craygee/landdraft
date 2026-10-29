const CACHE = "landdraft-offline-viewer-v3";
const FILES = [
  "/offline.html",
  "/offline-viewer.js",
  "/offline.css",
  "/offline.webmanifest",
  "/landdraft-icon-192.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("landdraft-offline-viewer-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    !FILES.includes(url.pathname) ||
    event.request.method !== "GET"
  )
    return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(url.pathname);
      return cached ?? fetch(event.request);
    }),
  );
});
