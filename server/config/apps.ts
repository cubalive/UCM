export const TEAM_ID = "HVF2V75J4T";

export const APP_DOMAINS = {
  driver: "https://driver.unitedcaremobility.com",
  clinic: "https://clinic.unitedcaremobility.com",
  pharmacy: "https://pharmacy.unitedcaremobility.com",
  broker: "https://broker.unitedcaremobility.com",
  dispatch: "https://dispatch.unitedcaremobility.com",
  admin: "https://app.unitedcaremobility.com",
} as const;

export const APP_BUNDLES = {
  driver: "com.unitedcaremobility.driver",
  clinic: "com.unitedcaremobility.clinic",
  admin: "com.unitedcaremobility.admin",
} as const;

export type AppKey = keyof typeof APP_DOMAINS;
export type NativeAppKey = keyof typeof APP_BUNDLES;

export function getRedirectBaseUrlForRole(role: string): string {
  const upper = (role || "").toUpperCase();
  if (upper === "DRIVER") return APP_DOMAINS.driver;
  if (["CLINIC", "CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER", "CLINIC_STAFF"].includes(upper)) {
    return APP_DOMAINS.clinic;
  }
  if (["PHARMACY_ADMIN", "PHARMACY_USER"].includes(upper)) {
    return APP_DOMAINS.pharmacy;
  }
  if (["BROKER_ADMIN", "BROKER_USER"].includes(upper)) {
    return APP_DOMAINS.broker;
  }
  return APP_DOMAINS.admin;
}

export function getAppKeyForHostname(hostname: string): AppKey {
  if (hostname.startsWith("driver.")) return "driver";
  if (hostname.startsWith("clinic.")) return "clinic";
  if (hostname.startsWith("pharmacy.")) return "pharmacy";
  if (hostname.startsWith("broker.")) return "broker";
  if (hostname.startsWith("dispatch.")) return "dispatch";
  // Custom company domains resolve to admin app
  return "admin";
}

/** Check if hostname is a known system subdomain */
const SYSTEM_PREFIXES = ["driver.", "clinic.", "pharmacy.", "broker.", "dispatch.", "admin.", "app."];
export function isCustomHostname(hostname: string): boolean {
  if (!hostname) return false;
  const isProd = hostname.endsWith("unitedcaremobility.com");
  if (isProd) {
    return !SYSTEM_PREFIXES.some(p => hostname.startsWith(p)) && hostname !== "unitedcaremobility.com";
  }
  // Non-prod domain that's not localhost = custom domain
  return !hostname.startsWith("localhost") && !hostname.startsWith("127.") && !hostname.startsWith("192.168.");
}

export function getNativeAppKey(appKey: AppKey): NativeAppKey {
  if (appKey in APP_BUNDLES) return appKey as NativeAppKey;
  return "admin";
}

export function getAASA(appKey: AppKey) {
  const nativeKey = getNativeAppKey(appKey);
  const appID = `${TEAM_ID}.${APP_BUNDLES[nativeKey]}`;
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID,
          paths: ["/*"],
        },
      ],
    },
    webcredentials: {
      apps: [appID],
    },
  };
}

export const AASA_URLS = {
  driver: `${APP_DOMAINS.driver}/.well-known/apple-app-site-association`,
  clinic: `${APP_DOMAINS.clinic}/.well-known/apple-app-site-association`,
  admin: `${APP_DOMAINS.admin}/.well-known/apple-app-site-association`,
} as const;
