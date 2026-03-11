const hostname = window.location.hostname;
const isProdDomain = hostname.endsWith("unitedcaremobility.com");

// Support portal detection via URL search params in development (localhost)
// Usage: http://localhost:5000?portal=pharmacy
const _searchParams = new URLSearchParams(window.location.search);
const _devPortal = _searchParams.get("portal")?.toLowerCase() || "";
const _isLocal = hostname === "localhost" || hostname.startsWith("127.") || hostname.startsWith("192.168.");

export const isDriverHost = (isProdDomain && hostname.startsWith("driver.")) || (_isLocal && _devPortal === "driver");
export const isClinicHost = (isProdDomain && hostname.startsWith("clinic.")) || (_isLocal && _devPortal === "clinic");
export const isPharmacyHost = (isProdDomain && hostname.startsWith("pharmacy.")) || (_isLocal && _devPortal === "pharmacy");
export const isBrokerHost = (isProdDomain && hostname.startsWith("broker.")) || (_isLocal && _devPortal === "broker");
export const isDispatchHost = (isProdDomain && hostname.startsWith("dispatch.")) || (_isLocal && _devPortal === "dispatch");
export const isAdminHost = (isProdDomain && hostname.startsWith("admin.")) || (_isLocal && _devPortal === "admin");
export const isAppHost = isProdDomain && (hostname.startsWith("app.") || hostname === "app.unitedcaremobility.com");
export const isProductionSubdomain = isDriverHost || isClinicHost || isPharmacyHost || isBrokerHost || isDispatchHost || isAdminHost || isAppHost;
export { isProdDomain };

/**
 * Detect if the current hostname is a company custom domain/subdomain.
 * Custom domains are any non-standard subdomain of the prod domain,
 * or an entirely different domain (pointing via CNAME/DNS).
 */
const SYSTEM_PREFIXES = ["driver.", "clinic.", "pharmacy.", "broker.", "dispatch.", "admin.", "app."];
export const isCustomDomain = !isProdDomain && hostname !== "localhost" && !hostname.startsWith("127.") && !hostname.startsWith("192.168.");
export const isCustomSubdomain = isProdDomain && !SYSTEM_PREFIXES.some(p => hostname.startsWith(p)) && hostname !== "unitedcaremobility.com";

/** The custom domain slug to resolve against companies.customDomain */
export const customDomainSlug: string | null = isCustomDomain ? hostname : (isCustomSubdomain ? hostname.split(".")[0] : null);

export const isNativePlatform =
  typeof (window as any).Capacitor !== "undefined" &&
  (window as any).Capacitor.isNativePlatform?.() === true;

export const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true);

export const NATIVE_ENABLED = import.meta.env.VITE_NATIVE_ENABLED === "true";
export const BG_TRACKING_ENABLED = import.meta.env.VITE_BG_TRACKING_ENABLED === "true";

export function isNative(): boolean {
  return isNativePlatform && NATIVE_ENABLED;
}

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

const OPS_ALLOWED_ROLES = ["SUPER_ADMIN", "ADMIN", "DISPATCH"];
export function isOpsAllowed(userRole: string | undefined | null): boolean {
  if (isDriverHost) return false;
  if (!userRole) return false;
  return OPS_ALLOWED_ROLES.includes(userRole.toUpperCase());
}
