import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { TEAM_ID, APP_DOMAINS, APP_BUNDLES, AASA_URLS, getRedirectBaseUrlForRole, getAASA, type AppKey } from "../config/apps";
import { APP_VERSION, APP_BUILD_TIME } from "./health.controller";
import { existsSync } from "fs";
import { resolve } from "path";

const ENV_CHECKS = [
  "DATABASE_URL",
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "SESSION_SECRET",
  "GOOGLE_MAPS_API_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
] as const;

const ROLE_SAMPLES = [
  "DRIVER",
  "CLINIC",
  "CLINIC_ADMIN",
  "ADMIN",
  "SUPER_ADMIN",
  "DISPATCH",
];

const MANIFEST_URLS: Record<string, string> = {
  driver: `${APP_DOMAINS.driver}/manifest.json`,
  clinic: `${APP_DOMAINS.clinic}/manifest.json`,
  admin: `${APP_DOMAINS.admin}/manifest.json`,
};

const EXPECTED_MANIFEST_NAMES: Record<string, string> = {
  driver: "Driver UCM",
  clinic: "Clinic UCM",
  admin: "UCM",
};

export async function releaseReadinessHandler(_req: AuthRequest, res: Response) {
  const envPresence: Record<string, boolean> = {};
  for (const key of ENV_CHECKS) {
    envPresence[key] = !!process.env[key];
  }

  const authRedirectMapping: Record<string, string> = {};
  for (const role of ROLE_SAMPLES) {
    authRedirectMapping[role] = getRedirectBaseUrlForRole(role);
  }

  const gitCommit = process.env.GIT_COMMIT || process.env.RENDER_GIT_COMMIT || "unknown";

  const aasaStatus: Record<string, { fetchStatus: string; hasCorrectAppId: boolean | null }> = {};
  for (const [key, url] of Object.entries(AASA_URLS)) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) {
        aasaStatus[key] = { fetchStatus: `HTTP ${resp.status}`, hasCorrectAppId: null };
        continue;
      }
      const body = await resp.json();
      const expected = getAASA(key as AppKey);
      const expectedAppID = expected.applinks.details[0].appID;
      const actualAppID = body?.applinks?.details?.[0]?.appID;
      aasaStatus[key] = { fetchStatus: "ok", hasCorrectAppId: actualAppID === expectedAppID };
    } catch (err: any) {
      aasaStatus[key] = { fetchStatus: `error: ${err.message}`, hasCorrectAppId: null };
    }
  }

  const manifestStatus: Record<string, { fetchStatus: string; hasCorrectName: boolean | null }> = {};
  for (const [key, url] of Object.entries(MANIFEST_URLS)) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) {
        manifestStatus[key] = { fetchStatus: `HTTP ${resp.status}`, hasCorrectName: null };
        continue;
      }
      const body = await resp.json();
      const expectedName = EXPECTED_MANIFEST_NAMES[key];
      manifestStatus[key] = { fetchStatus: "ok", hasCorrectName: body?.name === expectedName };
    } catch (err: any) {
      manifestStatus[key] = { fetchStatus: `error: ${err.message}`, hasCorrectName: null };
    }
  }

  const cwd = process.cwd();
  const ICON_FILES = ["AppIcon-1024.png", "AppIcon-512.png", "icon-192.png"];
  const iconAssetsPresence: Record<string, Record<string, boolean>> = {};
  for (const app of ["driver", "clinic", "admin"]) {
    iconAssetsPresence[app] = {};
    for (const file of ICON_FILES) {
      iconAssetsPresence[app][file] = existsSync(resolve(cwd, `client/public/generated-icons/${app}/${file}`));
    }
  }

  const CAP_CONFIGS: Record<string, { path: string; expectedAppId: string; expectedUrl: string; expectedName: string }> = {
    driver: { path: "mobile-driver/capacitor.config.ts", expectedAppId: "com.unitedcaremobility.driver", expectedUrl: "https://driver.unitedcaremobility.com", expectedName: "UCM Driver" },
    clinic: { path: "mobile-clinic/capacitor.config.ts", expectedAppId: "com.unitedcaremobility.clinic", expectedUrl: "https://clinic.unitedcaremobility.com", expectedName: "UCM Clinic" },
    admin: { path: "mobile-admin/capacitor.config.ts", expectedAppId: "com.unitedcaremobility.admin", expectedUrl: "https://app.unitedcaremobility.com", expectedName: "UCM Admin" },
  };
  const capacitorConfigsPresence: Record<string, { exists: boolean; path: string; expectedAppId: string; expectedUrl: string; expectedName: string }> = {};
  for (const [key, cfg] of Object.entries(CAP_CONFIGS)) {
    capacitorConfigsPresence[key] = {
      exists: existsSync(resolve(cwd, cfg.path)),
      path: cfg.path,
      expectedAppId: cfg.expectedAppId,
      expectedUrl: cfg.expectedUrl,
      expectedName: cfg.expectedName,
    };
  }

  res.json({
    teamId: TEAM_ID,
    bundles: APP_BUNDLES,
    domains: APP_DOMAINS,
    envPresence,
    aasaUrls: AASA_URLS,
    aasaStatus,
    manifestUrls: MANIFEST_URLS,
    manifestStatus,
    iconAssetsPresence,
    capacitorConfigsPresence,
    authRedirectMapping,
    build: {
      version: APP_VERSION,
      buildTime: APP_BUILD_TIME,
      commit: gitCommit,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
    },
  });
}

export async function smokeTestHandler(_req: AuthRequest, res: Response) {
  const results: Array<{ check: string; status: "pass" | "fail"; detail?: string }> = [];

  for (const [key, url] of Object.entries(AASA_URLS)) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "UCM-SmokeTest/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        results.push({ check: `aasa_fetch_${key}`, status: "fail", detail: `HTTP ${resp.status}` });
        continue;
      }
      const body = await resp.json();
      const expected = getAASA(key as any);
      const expectedAppID = expected.applinks.details[0].appID;
      const actualAppID = body?.applinks?.details?.[0]?.appID;
      if (actualAppID === expectedAppID) {
        results.push({ check: `aasa_${key}`, status: "pass", detail: actualAppID });
      } else {
        results.push({ check: `aasa_${key}`, status: "fail", detail: `expected ${expectedAppID}, got ${actualAppID}` });
      }
    } catch (err: any) {
      results.push({ check: `aasa_fetch_${key}`, status: "fail", detail: err.message });
    }
  }

  for (const [key, url] of Object.entries(MANIFEST_URLS)) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "UCM-SmokeTest/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        results.push({ check: `manifest_fetch_${key}`, status: "fail", detail: `HTTP ${resp.status}` });
        continue;
      }
      const body = await resp.json();
      const expectedName = EXPECTED_MANIFEST_NAMES[key];
      if (body?.name === expectedName) {
        results.push({ check: `manifest_${key}`, status: "pass", detail: body.name });
      } else {
        results.push({ check: `manifest_${key}`, status: "fail", detail: `expected "${expectedName}", got "${body?.name}"` });
      }
    } catch (err: any) {
      results.push({ check: `manifest_fetch_${key}`, status: "fail", detail: err.message });
    }
  }

  for (const role of ROLE_SAMPLES) {
    const url = getRedirectBaseUrlForRole(role);
    const expected =
      role === "DRIVER" ? APP_DOMAINS.driver :
      ["CLINIC", "CLINIC_ADMIN"].includes(role) ? APP_DOMAINS.clinic :
      APP_DOMAINS.admin;
    results.push({
      check: `redirect_${role}`,
      status: url === expected ? "pass" : "fail",
      detail: url,
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const resp = await fetch(`${supabaseUrl}/auth/v1/health`, {
        signal: AbortSignal.timeout(5000),
        headers: { apikey: process.env.SUPABASE_ANON_KEY || "" },
      });
      results.push({ check: "supabase_reachable", status: resp.ok ? "pass" : "fail", detail: `HTTP ${resp.status}` });
    } catch (err: any) {
      results.push({ check: "supabase_reachable", status: "fail", detail: err.message });
    }
  } else {
    results.push({ check: "supabase_reachable", status: "fail", detail: "SUPABASE_URL not set" });
  }

  if (process.env.UPSTASH_REDIS_REST_URL) {
    try {
      const { pingRedis, isRedisConnected } = await import("../lib/redis");
      if (isRedisConnected()) {
        const ping = await pingRedis();
        results.push({ check: "redis_reachable", status: ping.ok ? "pass" : "fail", detail: `latency=${ping.latencyMs}ms` });
      } else {
        results.push({ check: "redis_reachable", status: "fail", detail: "not connected" });
      }
    } catch (err: any) {
      results.push({ check: "redis_reachable", status: "fail", detail: err.message });
    }
  } else {
    results.push({ check: "redis_reachable", status: "fail", detail: "UPSTASH_REDIS_REST_URL not set" });
  }

  if (process.env.GOOGLE_MAPS_API_KEY) {
    results.push({ check: "google_maps_key", status: "pass", detail: "present" });
  } else {
    results.push({ check: "google_maps_key", status: "fail", detail: "not set" });
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;

  res.json({
    overall: failed === 0 ? "PASS" : "FAIL",
    passed,
    failed,
    total: results.length,
    results,
  });
}
