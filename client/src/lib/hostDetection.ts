const host = window.location.host;
const isProdDomain = host.endsWith("unitedcaremobility.com");

export const isDriverHost = isProdDomain && host.startsWith("driver.");
export const isAdminHost = isProdDomain && host.startsWith("admin.");
export const isAppHost = isProdDomain && (host.startsWith("app.") || host === "app.unitedcaremobility.com");
export const isProductionSubdomain = isDriverHost || isAdminHost || isAppHost;
export { isProdDomain };

export const DRIVER_TOKEN_KEY = "ucm_driver_token";
export const APP_TOKEN_KEY = "ucm_token";
export const TOKEN_KEY = isDriverHost ? DRIVER_TOKEN_KEY : APP_TOKEN_KEY;

export function getCredentials(): RequestCredentials {
  return isDriverHost ? "omit" : "include";
}
