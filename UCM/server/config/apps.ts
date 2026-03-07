export const TEAM_ID = "HVF2V75J4T";

export const APP_DOMAINS = {
  driver: "https://driver.unitedcaremobility.com",
  clinic: "https://clinic.unitedcaremobility.com",
  admin: "https://app.unitedcaremobility.com",
} as const;

export const APP_BUNDLES = {
  driver: "com.unitedcaremobility.driver",
  clinic: "com.unitedcaremobility.clinic",
  admin: "com.unitedcaremobility.admin",
} as const;

export type AppKey = keyof typeof APP_DOMAINS;

export function getRedirectBaseUrlForRole(role: string): string {
  const upper = (role || "").toUpperCase();
  if (upper === "DRIVER") return APP_DOMAINS.driver;
  if (["CLINIC", "CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER", "CLINIC_STAFF"].includes(upper)) {
    return APP_DOMAINS.clinic;
  }
  return APP_DOMAINS.admin;
}

export function getAppKeyForHostname(hostname: string): AppKey {
  if (hostname.startsWith("driver.")) return "driver";
  if (hostname.startsWith("clinic.")) return "clinic";
  return "admin";
}

export function getAASA(appKey: AppKey) {
  const appID = `${TEAM_ID}.${APP_BUNDLES[appKey]}`;
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
