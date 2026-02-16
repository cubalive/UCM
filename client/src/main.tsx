import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

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
            if (newWorker.state === "activated") {
              console.log("[SW] New version activated, reloading for fresh assets");
              window.location.reload();
            }
          });
        });

        if (reg.waiting) {
          reg.waiting.postMessage("SKIP_WAITING");
        }

        setInterval(() => {
          reg.update().catch(() => {});
        }, 60 * 60 * 1000);
      })
      .catch((err) => {
        console.error("[SW] Registration failed:", err);
      });

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "SW_VERSION") {
        const swVersion = event.data.version;
        const appVersion = document.querySelector('meta[name="ucm-version"]')?.getAttribute("content");
        if (appVersion && swVersion && swVersion !== "__UCM_BUILD__" && appVersion !== swVersion) {
          console.warn(`[SW] Version mismatch: app=${appVersion} sw=${swVersion}, reloading`);
          window.location.reload();
        }
      }
    });

    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage("CHECK_VERSION");
    }
  });
}
