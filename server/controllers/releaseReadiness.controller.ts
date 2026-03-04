import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { TEAM_ID, APP_DOMAINS, APP_BUNDLES, AASA_URLS, getRedirectBaseUrlForRole, getAASA, type AppKey } from "../config/apps";
import { APP_VERSION, APP_BUILD_TIME } from "./health.controller";

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

  res.json({
    teamId: TEAM_ID,
    bundles: APP_BUNDLES,
    domains: APP_DOMAINS,
    envPresence,
    aasaUrls: AASA_URLS,
    aasaStatus,
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
