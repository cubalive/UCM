export const GOOGLE_MAPS_BROWSER_KEY =
  process.env.GOOGLE_MAPS_BROWSER_KEY ||
  process.env.VITE_GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  "";

export const GOOGLE_MAPS_SERVER_KEY =
  process.env.GOOGLE_MAPS_SERVER_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  "";

export const GOOGLE_MAPS_KEY =
  GOOGLE_MAPS_SERVER_KEY || GOOGLE_MAPS_BROWSER_KEY || "";

if (process.env.NODE_ENV !== "production") {
  if (!GOOGLE_MAPS_BROWSER_KEY) {
    console.warn("[MAPS-BOOT] Maps browser key missing — set VITE_GOOGLE_MAPS_API_KEY or GOOGLE_MAPS_BROWSER_KEY");
  }
  if (!GOOGLE_MAPS_SERVER_KEY) {
    console.warn("[MAPS-BOOT] Maps server key missing — set GOOGLE_MAPS_API_KEY or GOOGLE_MAPS_SERVER_KEY");
  }
}
