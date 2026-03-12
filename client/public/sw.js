const APP_VERSION = "__UCM_BUILD__";
const CACHE_NAME = `ucm-cache-${APP_VERSION}`;
const OFFLINE_URL = "/offline.html";
const OFFLINE_QUEUE_KEY = "ucm-offline-queue";

const PRECACHE_URLS = [
  "/offline.html",
  "/branding/icon-192.png",
  "/branding/icon-512.png",
  "/branding/logo-small.png",
  "/branding/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const NETWORK_FIRST_PATHS = [
  "/manifest.webmanifest",
  "/manifest.json",
  "/manifest-driver.webmanifest",
  "/version.json",
];

const STATIC_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
];

/* ─── Queueable API paths (driver location pings and status updates) ─── */
const QUEUEABLE_PATHS = [
  "/api/driver/me/location",
  "/api/driver/trips/",
];

function isQueueablePath(pathname) {
  return QUEUEABLE_PATHS.some((p) => pathname.startsWith(p)) &&
    (pathname.includes("/location") || pathname.includes("/status"));
}

/* ─── IndexedDB-backed offline queue ─── */
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ucm-offline-queue", 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function enqueueRequest(url, method, headers, body) {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction("queue", "readwrite");
    const store = tx.objectStore("queue");
    store.add({
      url,
      method,
      headers: Object.fromEntries(
        [...(headers || [])].filter(([k]) => k.toLowerCase() !== "content-length")
      ),
      body,
      timestamp: Date.now(),
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    db.close();
  } catch (err) {
    // Silently fail if IndexedDB is not available
  }
}

async function drainOfflineQueue() {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction("queue", "readonly");
    const store = tx.objectStore("queue");
    const allItems = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    if (!allItems || allItems.length === 0) return;

    const db2 = await openOfflineDB();
    for (const item of allItems) {
      try {
        await fetch(item.url, {
          method: item.method,
          headers: item.headers,
          body: item.body,
        });
        // Remove from queue on success
        const delTx = db2.transaction("queue", "readwrite");
        delTx.objectStore("queue").delete(item.id);
        await new Promise((resolve) => { delTx.oncomplete = resolve; });
      } catch {
        // Stop draining if network is still down
        break;
      }
    }
    db2.close();
  } catch {
    // Silently fail
  }
}

/* ─── Install ─── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

/* ─── Activate ─── */
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

function isNetworkFirstPath(url) {
  return NETWORK_FIRST_PATHS.some((p) => url.pathname === p);
}

function isJsOrCss(url) {
  return url.pathname.endsWith(".js") || url.pathname.endsWith(".css");
}

function isStaticAsset(url) {
  return STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

/* ─── Fetch handler ─── */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/.well-known/")) {
    event.respondWith(networkOnly(event.request));
    return;
  }

  // API requests: network-first with offline queue for driver updates
  if (isApiRequest(url)) {
    if (event.request.method === "POST" && isQueueablePath(url.pathname)) {
      event.respondWith(networkWithOfflineQueue(event.request, url));
    } else {
      event.respondWith(networkFirstApi(event.request));
    }
    return;
  }

  if (isNavigationRequest(event.request)) {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  // Static assets: cache-first
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (isNetworkFirstPath(url) || isJsOrCss(url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request));
});

/* ─── Message handler ─── */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data === "CHECK_VERSION") {
    event.source?.postMessage({ type: "SW_VERSION", version: APP_VERSION });
  }
  if (event.data === "FORCE_ACTIVATE") {
    self.skipWaiting();
    self.clients.claim();
  }
  if (event.data === "DRAIN_QUEUE") {
    drainOfflineQueue();
  }
});

/* ─── Background sync for offline queue ─── */
self.addEventListener("sync", (event) => {
  if (event.tag === "ucm-driver-sync") {
    event.waitUntil(drainOfflineQueue());
  }
});

/* ─── Push notification handler ─── */
self.addEventListener("push", (event) => {
  let data = { title: "UCM Driver", body: "You have a new notification" };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "UCM Driver", {
      body: data.body || "",
      icon: "/app-icons/driver/pwa/icon-192.png",
      badge: "/app-icons/driver/pwa/icon-192.png",
      tag: data.tag || "ucm-driver-notification",
      data: data.data || {},
      vibrate: [200, 100, 200],
    })
  );
});

/* ─── Notification click handler ─── */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/driver";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/driver") && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(urlToOpen);
    })
  );
});

/* ─── Cache-first strategy for static assets ─── */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 503, statusText: "Offline" });
  }
}

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

/* ─── Network-first for API calls with offline cache fallback ─── */
async function networkFirstApi(request) {
  const cacheKey = request.method === "GET" ? request : null;

  try {
    const response = await fetch(request);
    // Cache successful GET API responses for offline fallback
    if (response.ok && cacheKey) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    // Try cache for GET requests
    if (cacheKey) {
      const cached = await caches.match(cacheKey);
      if (cached) return cached;
    }
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/* ─── Network with offline queue for POST requests (location, status) ─── */
async function networkWithOfflineQueue(request, url) {
  try {
    const response = await fetch(request.clone());
    return response;
  } catch {
    // Queue the request for later replay
    const body = await request.text().catch(() => null);
    const headers = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    await enqueueRequest(url.href, request.method, Object.entries(headers), body);

    // Register background sync if available
    if (self.registration && self.registration.sync) {
      try {
        await self.registration.sync.register("ucm-driver-sync");
      } catch {
        // Background sync not supported
      }
    }

    return new Response(JSON.stringify({ queued: true, message: "Request queued for sync" }), {
      status: 202,
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
    return response;
  } catch {
    const offlinePage = await caches.match(OFFLINE_URL);
    if (offlinePage) return offlinePage;
    return new Response("Offline", { status: 503 });
  }
}
