const APP_VERSION = "__UCM_BUILD__";
const CACHE_NAME = `ucm-cache-${APP_VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/manifest.json",
  "/branding/icon-192.png",
  "/branding/icon-512.png",
  "/branding/logo-small.png",
  "/branding/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const STATIC_EXTENSIONS = [
  ".js",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("ucm-cache-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  if (isApiRequest(url)) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  if (isNavigationRequest(event.request)) {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request));
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data === "CHECK_VERSION") {
    event.source?.postMessage({ type: "SW_VERSION", version: APP_VERSION });
  }
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    fetchPromise.catch(() => {});
    return cached;
  }

  const networkResponse = await fetchPromise;
  if (networkResponse) return networkResponse;

  return new Response("", { status: 503, statusText: "Offline" });
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offlinePage = await caches.match(OFFLINE_URL);
    if (offlinePage) return offlinePage;
    return new Response("Offline", { status: 503 });
  }
}
