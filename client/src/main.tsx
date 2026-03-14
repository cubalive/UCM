import { createRoot } from "react-dom/client";
import { onCLS, onFCP, onLCP, onTTFB, onINP } from "web-vitals";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// ─── Web Vitals Tracking ───────────────────────────────────────────────────
const reportWebVital = ({ name, value, rating }: { name: string; value: number; rating?: string }) => {
  navigator.sendBeacon?.(
    "/api/metrics/web-vitals",
    JSON.stringify({ name, value, rating, page: location.pathname })
  ) || fetch("/api/metrics/web-vitals", {
    method: "POST",
    body: JSON.stringify({ name, value, rating, page: location.pathname }),
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).catch(() => {});
};

onCLS(reportWebVital);
onFCP(reportWebVital);
onLCP(reportWebVital);
onTTFB(reportWebVital);
onINP(reportWebVital);

const SW_UPDATE_INTERVAL = 30 * 60_000;
const VERSION_CHECK_INTERVAL = 60_000;

let currentVersion: string | null = null;
let bannerShown = false;

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch("/version.json?_t=" + Date.now(), {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch {
    return null;
  }
}

function doForceRefresh() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) {
        reg.waiting.postMessage("FORCE_ACTIVATE");
      } else if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage("FORCE_ACTIVATE");
      }
      reg?.update().catch(() => {});
    }).catch(() => {});
  }
  caches.keys().then((names) => {
    Promise.all(names.map((n) => caches.delete(n))).then(() => {
      window.location.reload();
    });
  }).catch(() => {
    window.location.reload();
  });
}

(window as any).__ucmForceRefresh = doForceRefresh;

function showUpdateBanner() {
  if (bannerShown) return;
  bannerShown = true;

  const banner = document.createElement("div");
  banner.id = "ucm-update-banner";
  banner.setAttribute("data-testid", "banner-update-available");
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:99999;background:#1d4ed8;color:#fff;display:flex;align-items:center;justify-content:center;gap:0.75rem;padding:0.625rem 1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:0.875rem;cursor:pointer;-webkit-tap-highlight-color:transparent;";
  banner.textContent = "Update available \u2014 Tap to refresh";
  banner.addEventListener("click", doForceRefresh);
  document.body.appendChild(banner);
}

async function checkForUpdates() {
  const serverVersion = await fetchVersion();
  if (!serverVersion || serverVersion === "dev") return;

  if (currentVersion === null) {
    currentVersion = serverVersion;
    console.debug(`[UCM] Version initialized: ${currentVersion}`);
    return;
  }

  if (serverVersion !== currentVersion) {
    console.log(`[UCM] Version mismatch: current=${currentVersion} server=${serverVersion}`);
    showUpdateBanner();
  }
}

setInterval(checkForUpdates, VERSION_CHECK_INTERVAL);
checkForUpdates();

const isCapacitorNative =
  typeof (window as any).Capacitor !== "undefined" &&
  (window as any).Capacitor.isNativePlatform?.() === true;

if ("serviceWorker" in navigator && !isCapacitorNative) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.debug("[SW] Registered, scope:", reg.scope);

        function activateWaiting(worker: ServiceWorker) {
          console.debug("[SW] Activating waiting worker via SKIP_WAITING");
          worker.postMessage("SKIP_WAITING");
        }

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              console.debug("[SW] New worker installed, sending SKIP_WAITING");
              activateWaiting(newWorker);
            }
          });
        });

        if (reg.waiting) {
          console.debug("[SW] Waiting worker found on load, activating");
          activateWaiting(reg.waiting);
        }

        reg.update().catch(() => {});

        setInterval(() => {
          reg.update().catch(() => {});
        }, SW_UPDATE_INTERVAL);
      })
      .catch((err) => {
        console.error("[SW] Registration failed:", err);
      });

    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      console.log("[SW] Controller changed — reloading for new version");
      window.location.reload();
    });
  });
}
