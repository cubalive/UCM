import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

const VERSION_CHECK_INTERVAL = 30_000;
const AUTO_RELOAD_DELAY = 10_000;

let currentVersion: string | null = null;
let updateModalShown = false;
let autoReloadTimer: ReturnType<typeof setTimeout> | null = null;

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

function forceReload() {
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage("SKIP_WAITING");
  }
  caches.keys().then((names) => {
    Promise.all(names.map((n) => caches.delete(n))).then(() => {
      window.location.reload();
    });
  }).catch(() => {
    window.location.reload();
  });
}

function showUpdateModal() {
  if (updateModalShown) return;
  updateModalShown = true;

  const overlay = document.createElement("div");
  overlay.id = "ucm-update-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:1rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

  const card = document.createElement("div");
  card.style.cssText =
    "background:#0f1d33;border:1px solid #1e3a5f;border-radius:16px;padding:2rem;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);";

  const icon = document.createElement("div");
  icon.style.cssText = "width:48px;height:48px;margin:0 auto 1rem;border-radius:50%;background:#1e3a5f;display:flex;align-items:center;justify-content:center;";
  icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  const title = document.createElement("h2");
  title.style.cssText = "color:#fff;font-size:1.25rem;margin:0 0 0.5rem;font-weight:700;";
  title.textContent = "New Version Available";

  const desc = document.createElement("p");
  desc.style.cssText = "color:#94a3b8;font-size:0.875rem;margin:0 0 1.5rem;line-height:1.5;";
  desc.textContent = "A new version of UCM has been deployed. Update now to get the latest features and fixes.";

  const countdown = document.createElement("p");
  countdown.style.cssText = "color:#64748b;font-size:0.75rem;margin:0 0 1rem;";

  const btn = document.createElement("button");
  btn.style.cssText =
    "background:#2563eb;color:#fff;border:none;padding:0.75rem 2rem;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;width:100%;letter-spacing:0.02em;";
  btn.textContent = "UPDATE NOW";
  btn.setAttribute("data-testid", "button-update-now");
  btn.addEventListener("click", forceReload);

  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(countdown);
  card.appendChild(btn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let remaining = AUTO_RELOAD_DELAY / 1000;
  countdown.textContent = `Auto-updating in ${remaining}s...`;
  const iv = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(iv);
      forceReload();
    } else {
      countdown.textContent = `Auto-updating in ${remaining}s...`;
    }
  }, 1000);

  autoReloadTimer = setTimeout(forceReload, AUTO_RELOAD_DELAY);
}

async function checkForUpdates() {
  const serverVersion = await fetchVersion();
  if (!serverVersion || serverVersion === "dev") return;

  if (currentVersion === null) {
    currentVersion = serverVersion;
    return;
  }

  if (serverVersion !== currentVersion) {
    console.log(`[UCM] Version mismatch: current=${currentVersion} server=${serverVersion}`);
    showUpdateModal();
  }
}

setInterval(checkForUpdates, VERSION_CHECK_INTERVAL);
checkForUpdates();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[SW] Registered, scope:", reg.scope);

        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              console.log("[SW] New service worker installed, requesting activation");
              newWorker.postMessage("SKIP_WAITING");
            }
          });
        });

        if (reg.waiting) {
          console.log("[SW] Waiting worker found, activating");
          reg.waiting.postMessage("SKIP_WAITING");
        }

        setInterval(() => {
          reg.update().catch(() => {});
        }, VERSION_CHECK_INTERVAL);
      })
      .catch((err) => {
        console.error("[SW] Registration failed:", err);
      });

    let controllerChanged = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (controllerChanged) return;
      controllerChanged = true;
      console.log("[SW] Controller changed, new version active");
      if (!updateModalShown) {
        showUpdateModal();
      }
    });
  });
}
