import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (import.meta.env.DEV) {
          console.log("[SW] Registered, scope:", reg.scope);
        }
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.error("[SW] Registration failed:", err);
        }
      });
  });
}
