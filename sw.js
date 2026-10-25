/*
 * Offline shell.
 *
 * NETWORK FIRST, deliberately. An earlier version was cache-first, which meant
 * a redeploy was invisible: the browser kept serving the old files from the
 * cache. Now anything online is always fresh, and the cache is only a fallback
 * for when the device is offline.
 *
 * The conversation itself is never cached - it lives on your own machine.
 */

const SHELL = "neeraj-shell-v2";
const FILES = ["./", "index.html", "assets/styles.css", "assets/app.js",
               "assets/icon.svg", "manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch API traffic, other origins, or anything that is not a GET.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("./"))
      )
  );
});
