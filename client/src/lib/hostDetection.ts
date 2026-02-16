const host = window.location.host;
const isProdDomain = host.endsWith("unitedcaremobility.com");

export const isDriverHost = isProdDomain && host.startsWith("driver.");
export const isAdminHost = isProdDomain && host.startsWith("admin.");
export const isAppHost = isProdDomain && (host.startsWith("app.") || host === "app.unitedcaremobility.com");
export const isProductionSubdomain = isDriverHost || isAdminHost || isAppHost;
export { isProdDomain };

export const DRIVER_TOKEN_KEY = "ucm_driver_token";
export const APP_TOKEN_KEY = "ucm_token";

function resolveTokenKey(): string {
  if (!isDriverHost) return APP_TOKEN_KEY;
  try {
    const existing = localStorage.getItem(DRIVER_TOKEN_KEY);
    if (existing) return DRIVER_TOKEN_KEY;
    const legacy = localStorage.getItem(APP_TOKEN_KEY);
    if (legacy) {
      localStorage.setItem(DRIVER_TOKEN_KEY, legacy);
      localStorage.removeItem(APP_TOKEN_KEY);
    }
  } catch {}
  return DRIVER_TOKEN_KEY;
}

export const TOKEN_KEY = resolveTokenKey();

export function getCredentials(): RequestCredentials {
  return isDriverHost ? "omit" : "include";
}
