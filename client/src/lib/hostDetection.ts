const hostname = window.location.hostname;
const isProdDomain = hostname.endsWith("unitedcaremobility.com");

export const isDriverHost = isProdDomain && hostname.startsWith("driver.");
export const isAdminHost = isProdDomain && hostname.startsWith("admin.");
export const isAppHost = isProdDomain && (hostname.startsWith("app.") || hostname === "app.unitedcaremobility.com");
export const isProductionSubdomain = isDriverHost || isAdminHost || isAppHost;
export { isProdDomain };

export const DRIVER_TOKEN_KEY = "ucm_driver_token";
export const APP_TOKEN_KEY = "ucm_token";

export function getTokenKey(): string {
  return isDriverHost ? DRIVER_TOKEN_KEY : APP_TOKEN_KEY;
}

let _migrated = false;
export function migrateLegacyTokenIfNeeded(): void {
  if (_migrated || !isDriverHost) return;
  _migrated = true;
  try {
    const existing = localStorage.getItem(DRIVER_TOKEN_KEY);
    if (existing) return;
    const legacy = localStorage.getItem(APP_TOKEN_KEY);
    if (legacy) {
      localStorage.setItem(DRIVER_TOKEN_KEY, legacy);
      localStorage.removeItem(APP_TOKEN_KEY);
    }
  } catch {}
}

export function getCredentials(): RequestCredentials {
  return isDriverHost ? "omit" : "include";
}
