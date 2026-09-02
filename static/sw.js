/* Textbook Reader service worker.
 *
 * Precaches the app shell + index.json + search.json on install. Markdown
 * sources under /content/ are cached on first read (cache-first thereafter).
 * The cache name is bumped each build so a new index invalidates the old one.
 */

const VERSION = new URL(self.location).searchParams.get("v") || "dev";
const CACHE = `textbook-${VERSION}`;
const SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/style.css",
  "/icon.svg",
  "/data/index.json",
  "/data/search.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE && k.startsWith("textbook-")).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // For data and content: cache-first, fall back to network and stash for next time.
  if (url.pathname.startsWith("/data/") || url.pathname.startsWith("/content/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // App shell: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    // Offline + uncached: surface a minimal error.
    return new Response("Innholdet er ikke tilgjengelig offline.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const fresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fresh;
}
