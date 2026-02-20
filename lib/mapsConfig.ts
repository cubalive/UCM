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
