import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { authMiddleware, requireRole, requirePermission, getCompanyIdFromAuth, type AuthRequest } from "../auth";
import { sendSms, normalizePhone, isTwilioConfigured } from "./twilioSms";
import { sendEmail } from "./email";
import type { Trip, City, Clinic } from "@shared/schema";
import { db } from "../db";
import { drivers, vehicles, companies, trips } from "@shared/schema";
import { eq, and, isNotNull, isNull, sql, inArray, desc } from "drizzle-orm";

const COOLDOWN_MINUTES = 30;
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

interface OpsAlert {
  code: string;
  severity: "critical" | "warning" | "info";
  title: string;
  count: number;
  actionUrl?: string;
}

interface OpsHealthResult {
  overall: "green" | "yellow" | "red";
  cityId: number;
  cityName: string;
  date: string;
  alerts: OpsAlert[];
  lastSmsSentAt?: string | null;
}

interface ClinicHealthResult {
  overall: "green" | "yellow" | "red";
  clinicId: number;
  clinicName: string;
  date: string;
  alerts: OpsAlert[];
  lastAlertSentAt?: string | null;
}

function getAppUrl(): string {
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL;
  return "https://localhost:5000";
}

function todayDateStr(timezone?: string): string {
  const tz = timezone || "America/New_York";
  const now = new Date();
  return now.toLocaleDateString("en-CA", { timeZone: tz });
}

function nowMinutesInTz(timezone?: string): number {
  const tz = timezone || "America/New_York";
  const now = new Date();
  const parts = now.toLocaleTimeString("en-US", { timeZone: tz, hour12: false }).split(":");
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function tripTimeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function makeFingerprint(cityId: number, date: string, overall: string, codes: string[]): string {
  const sorted = [...codes].sort().join(",");
  const raw = `${cityId}:${date}:${overall}:${sorted}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function makeClinicFingerprint(clinicId: number, overall: string, codes: string[]): string {
  const sorted = [...codes].sort().join(",");
  const raw = `clinic:${clinicId}:${overall}:${sorted}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export function computeCityOpsHealth(
  tripsList: Trip[],
  cityId: number,
  cityName: string,
  date: string,
  timezone?: string,
): OpsHealthResult {
  const alerts: OpsAlert[] = [];
  const baseUrl = getAppUrl();
  const nowMins = nowMinutesInTz(timezone);

  const activeTrips = tripsList.filter(t =>
    t.approvalStatus !== "cancelled" && t.status !== "CANCELLED"
  );

  const pendingApproval = activeTrips.filter(t => t.approvalStatus === "pending");
  const pendingOld = pendingApproval.filter(t => {
    const created = t.createdAt ? new Date(t.createdAt).getTime() : 0;
    return Date.now() - created > 15 * 60 * 1000;
  });
  if (pendingOld.length > 0) {
    alerts.push({
      code: "TRIPS_PENDING_APPROVAL",
      severity: "critical",
      title: "Trips pending approval > 15 min",
      count: pendingOld.length,
      actionUrl: `${baseUrl}/trips`,
    });
  }

  const upcomingNoDriver = activeTrips.filter(t => {
    if (t.driverId) return false;
    if (t.status === "COMPLETED" || t.status === "CANCELLED" || t.status === "NO_SHOW") return false;
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return pickupMins - nowMins <= 60 && pickupMins - nowMins >= 0;
  });
  if (upcomingNoDriver.length > 0) {
    alerts.push({
      code: "TRIPS_NO_DRIVER_ASSIGNED",
      severity: "critical",
      title: "Trips without driver (next 60 min)",
      count: upcomingNoDriver.length,
      actionUrl: `${baseUrl}/trips`,
    });
  }

  const inProgressTrips = activeTrips.filter(t => t.status === "IN_PROGRESS");
  const lateDrivers = inProgressTrips.filter(t => {
    if (t.lastEtaMinutes == null) return false;
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return nowMins > pickupMins + 10;
  });
  if (lateDrivers.length > 0) {
    alerts.push({
      code: "DRIVER_LATE",
      severity: "critical",
      title: "Drivers late > 10 min",
      count: lateDrivers.length,
      actionUrl: `${baseUrl}/dispatch`,
    });
  }

  const noEta = activeTrips.filter(t => {
    if (t.status !== "ASSIGNED" && t.status !== "IN_PROGRESS") return false;
    if (t.lastEtaMinutes != null) return false;
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return pickupMins - nowMins <= 60 && pickupMins - nowMins >= 0;
  });
  if (noEta.length > 0) {
    alerts.push({
      code: "TRIPS_NO_ETA",
      severity: "critical",
      title: "Trips without ETA (next 60 min)",
      count: noEta.length,
      actionUrl: `${baseUrl}/dispatch`,
    });
  }

  const cancelledToday = tripsList.filter(t =>
    t.status === "CANCELLED" || t.approvalStatus === "cancelled"
  );
  if (cancelledToday.length > 0) {
    alerts.push({
      code: "TRIPS_CANCELLED_TODAY",
      severity: "critical",
      title: "Trips cancelled today",
      count: cancelledToday.length,
      actionUrl: `${baseUrl}/trips`,
    });
  }

  const upcoming60 = activeTrips.filter(t => {
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return pickupMins - nowMins <= 60 && pickupMins - nowMins >= 0;
  });
  if (upcoming60.length > 0) {
    alerts.push({
      code: "UPCOMING_PICKUPS_60_MIN",
      severity: "warning",
      title: "Upcoming pickups in next 60 min",
      count: upcoming60.length,
    });
  }

  const criticalAlerts = alerts.filter(a => a.severity === "critical");
  const warningAlerts = alerts.filter(a => a.severity === "warning");

  let overall: "green" | "yellow" | "red" = "green";
  if (criticalAlerts.length > 0) overall = "red";
  else if (warningAlerts.length > 0) overall = "yellow";

  return { overall, cityId, cityName, date, alerts };
}

export function computeClinicHealth(
  tripsList: Trip[],
  clinic: Clinic,
  date: string,
  timezone?: string,
): ClinicHealthResult {
  const alerts: OpsAlert[] = [];
  const baseUrl = getAppUrl();
  const nowMins = nowMinutesInTz(timezone);

  const activeTrips = tripsList.filter(t =>
    t.approvalStatus !== "cancelled" && t.status !== "CANCELLED"
  );

  const pendingApproval = activeTrips.filter(t => t.approvalStatus === "pending");
  const pendingOld = pendingApproval.filter(t => {
    const created = t.createdAt ? new Date(t.createdAt).getTime() : 0;
    return Date.now() - created > 15 * 60 * 1000;
  });
  if (pendingOld.length > 0) {
    alerts.push({
      code: "TRIPS_PENDING_APPROVAL",
      severity: "critical",
      title: "Trips pending approval > 15 min",
      count: pendingOld.length,
      actionUrl: `${baseUrl}/trips`,
    });
  }

  const lateDrivers = activeTrips.filter(t => {
    if (t.status !== "IN_PROGRESS" && t.status !== "ASSIGNED") return false;
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return nowMins > pickupMins + 10;
  });
  if (lateDrivers.length > 0) {
    alerts.push({
      code: "DRIVER_LATE",
      severity: "critical",
      title: "Drivers late > 10 min",
      count: lateDrivers.length,
      actionUrl: `${baseUrl}/trips`,
    });
  }

  const upcomingNoDriver = activeTrips.filter(t => {
    if (t.driverId) return false;
    if (t.status === "COMPLETED" || t.status === "CANCELLED" || t.status === "NO_SHOW") return false;
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return pickupMins - nowMins <= 60 && pickupMins - nowMins >= 0;
  });
  if (upcomingNoDriver.length > 0) {
    alerts.push({
      code: "TRIPS_NO_DRIVER_ASSIGNED",
      severity: "critical",
      title: "Trips without driver (next 60 min)",
      count: upcomingNoDriver.length,
      actionUrl: `${baseUrl}/trips`,
    });
  }

  const noEta = activeTrips.filter(t => {
    if (t.status !== "ASSIGNED" && t.status !== "IN_PROGRESS") return false;
    if (t.lastEtaMinutes != null) return false;
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return pickupMins - nowMins <= 60 && pickupMins - nowMins >= 0;
  });
  if (noEta.length > 0) {
    alerts.push({
      code: "TRIPS_NO_ETA",
      severity: "critical",
      title: "Trips without ETA (next 60 min)",
      count: noEta.length,
      actionUrl: `${baseUrl}/trips`,
    });
  }

  const cancelledToday = tripsList.filter(t =>
    t.status === "CANCELLED" || t.approvalStatus === "cancelled"
  );
  if (cancelledToday.length > 0) {
    alerts.push({
      code: "TRIPS_CANCELLED_TODAY",
      severity: "critical",
      title: "Trips cancelled today",
      count: cancelledToday.length,
    });
  }

  const upcoming60 = activeTrips.filter(t => {
    const pickupMins = tripTimeToMinutes(t.pickupTime || t.scheduledTime);
    if (pickupMins == null) return false;
    return pickupMins - nowMins <= 60 && pickupMins - nowMins >= 0;
  });
  if (upcoming60.length > 0) {
    alerts.push({
      code: "UPCOMING_PICKUPS_60_MIN",
      severity: "warning",
      title: "Upcoming pickups in next 60 min",
      count: upcoming60.length,
    });
  }

  const noShowTrips = tripsList.filter(t => t.status === "NO_SHOW");
  if (noShowTrips.length > 0) {
    alerts.push({
      code: "PATIENT_NO_SHOW_RECENT",
      severity: "warning",
      title: "Patient no-shows",
      count: noShowTrips.length,
    });
  }

  const criticalAlerts = alerts.filter(a => a.severity === "critical");
  const warningAlerts = alerts.filter(a => a.severity === "warning");

  let overall: "green" | "yellow" | "red" = "green";
  if (criticalAlerts.length > 0) overall = "red";
  else if (warningAlerts.length > 0) overall = "yellow";

  return { overall, clinicId: clinic.id, clinicName: clinic.name, date, alerts };
}

async function shouldSendOpsAlert(
  cityId: number,
  date: string,
  overall: string,
  criticalCodes: string[],
): Promise<{ send: boolean; reason: string }> {
  if (overall !== "red") return { send: false, reason: "not_red" };

  const recent = await storage.getRecentOpsAlerts(cityId, date, COOLDOWN_MINUTES);

  if (recent.length === 0) return { send: true, reason: "first_red" };

  const lastCodes = new Set(recent[0].criticalCodes || []);
  const newCodes = criticalCodes.filter(c => !lastCodes.has(c));
  if (newCodes.length > 0) return { send: true, reason: `new_codes:${newCodes.join(",")}` };

  return { send: false, reason: "cooldown_active" };
}

async function shouldSendClinicAlert(
  clinicId: number,
  overall: string,
  criticalCodes: string[],
  alertType: string,
): Promise<{ send: boolean; reason: string }> {
  if (overall !== "red") return { send: false, reason: "not_red" };

  const recent = await storage.getRecentClinicAlerts(clinicId, COOLDOWN_MINUTES);
  const recentOfType = recent.filter(r => r.alertType === alertType);

  if (recentOfType.length === 0) return { send: true, reason: "first_red" };

  const lastCodes = new Set(recentOfType[0].criticalCodes || []);
  const newCodes = criticalCodes.filter(c => !lastCodes.has(c));
  if (newCodes.length > 0) return { send: true, reason: `new_codes:${newCodes.join(",")}` };

  return { send: false, reason: "cooldown_active" };
}

function formatOpsSmsMessage(cityName: string, alerts: OpsAlert[]): string {
  const criticals = alerts.filter(a => a.severity === "critical").slice(0, 3);
  const items = criticals.map(a => `${a.code}:${a.count}`).join(", ");
  const url = `${getAppUrl()}/ops-health`;
  let msg = `UCM OPS ALERT (${cityName}) RED:\n${items}\nOpen: ${url}`;
  if (msg.length > 160) {
    msg = msg.slice(0, 157) + "...";
  }
  return msg;
}

function formatClinicSmsMessage(clinicName: string, alerts: OpsAlert[]): string {
  const criticals = alerts.filter(a => a.severity === "critical").slice(0, 3);
  const items = criticals.map(a => `${a.code}:${a.count}`).join(", ");
  let msg = `UCM ALERT:\n${clinicName}\n${items}\nOpen dashboard.`;
  if (msg.length > 160) {
    msg = msg.slice(0, 157) + "...";
  }
  return msg;
}

function formatClinicEmailHtml(clinicName: string, alerts: OpsAlert[]): string {
  const criticals = alerts.filter(a => a.severity === "critical").slice(0, 3);
  const dashUrl = getAppUrl();
  const items = criticals
    .map(a => `<li><strong>${a.title}</strong>: ${a.count} trips</li>`)
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:#dc2626;color:white;padding:16px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">UCM Alert for ${clinicName}</h2>
      </div>
      <div style="border:1px solid #e5e7eb;padding:20px;border-radius:0 0 8px 8px;">
        <p>The following critical issues require attention:</p>
        <ul style="padding-left:20px;">${items}</ul>
        <a href="${dashUrl}" style="display:inline-block;background:#0a1e3d;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:12px;">Open Dashboard</a>
      </div>
      <p style="color:#6b7280;font-size:12px;margin-top:16px;">United Care Mobility</p>
    </div>
  `;
}

async function runOpsAlertCycle(): Promise<{ citiesChecked: number; alertsSent: number }> {
  const activeCities = await storage.getActiveCities();
  let alertsSent = 0;

  for (const city of activeCities) {
    try {
      const date = todayDateStr(city.timezone);
      const tripsList = await storage.getTripsForCityAndDate(city.id, date);
      const health = computeCityOpsHealth(tripsList, city.id, city.name, date, city.timezone);

      const criticalCodes = health.alerts
        .filter(a => a.severity === "critical")
        .map(a => a.code);

      const { send, reason } = await shouldSendOpsAlert(city.id, date, health.overall, criticalCodes);
      if (!send) {
        continue;
      }

      const dispatchPhone = process.env.DISPATCH_PHONE_NUMBER || "";
      const normalized = normalizePhone(dispatchPhone);
      if (!normalized) {
        console.error(`[OPS-ALERT] No valid dispatch phone for city ${city.name}`);
        continue;
      }

      const optedOut = await storage.isPhoneOptedOut(normalized);
      if (optedOut) {
        console.log(`[OPS-ALERT] Dispatch phone opted out for city ${city.name}`);
        continue;
      }

      const fingerprint = makeFingerprint(city.id, date, health.overall, criticalCodes);
      const message = formatOpsSmsMessage(city.name, health.alerts);

      const result = await sendSms(normalized, message);
      await storage.createOpsAlertLog({
        cityId: city.id,
        date,
        alertFingerprint: fingerprint,
        overall: health.overall,
        criticalCodes,
        sentTo: normalized,
        providerSid: result.sid || null,
        error: result.success ? null : (result.error || null),
      });

      if (result.success) {
        alertsSent++;
        console.log(`[OPS-ALERT] Sent for city ${city.name}, reason: ${reason}`);
      } else {
        console.error(`[OPS-ALERT] Failed for city ${city.name}: ${result.error}`);
      }
    } catch (err: any) {
      console.error(`[OPS-ALERT] Error processing city ${city.name}: ${err.message}`);
    }
  }

  return { citiesChecked: activeCities.length, alertsSent };
}

async function runClinicAlertCycle(): Promise<{ clinicsChecked: number; alertsSent: number }> {
  const activeCities = await storage.getActiveCities();
  let clinicsChecked = 0;
  let alertsSent = 0;

  for (const city of activeCities) {
    try {
      const date = todayDateStr(city.timezone);
      const allClinics = await storage.getClinics(city.id);
      const active = allClinics.filter(c => c.active && !c.deletedAt);

      for (const clinic of active) {
        clinicsChecked++;
        const tripsList = await storage.getTripsForClinicToday(clinic.id, date);
        const health = computeClinicHealth(tripsList, clinic, date, city.timezone);

        const criticalCodes = health.alerts
          .filter(a => a.severity === "critical")
          .map(a => a.code);

        if (clinic.email) {
          const { send } = await shouldSendClinicAlert(clinic.id, health.overall, criticalCodes, "email");
          if (send) {
            const fingerprint = makeClinicFingerprint(clinic.id, health.overall, criticalCodes);
            const html = formatClinicEmailHtml(clinic.name, health.alerts);
            const emailResult = await sendEmail({
              to: clinic.email,
              subject: `UCM Alert for ${clinic.name}`,
              html,
            });
            await storage.createClinicAlertLog({
              clinicId: clinic.id,
              alertFingerprint: fingerprint,
              alertType: "email",
              overall: health.overall,
              criticalCodes,
              sentTo: clinic.email,
              providerSid: emailResult.id || null,
              error: emailResult.success ? null : (emailResult.error || null),
            });
            if (emailResult.success) alertsSent++;
          }
        }

        if (clinic.phone) {
          const normalized = normalizePhone(clinic.phone);
          if (normalized) {
            const optedOut = await storage.isPhoneOptedOut(normalized);
            if (!optedOut) {
              const { send } = await shouldSendClinicAlert(clinic.id, health.overall, criticalCodes, "sms");
              if (send) {
                const fingerprint = makeClinicFingerprint(clinic.id, health.overall, criticalCodes);
                const msg = formatClinicSmsMessage(clinic.name, health.alerts);
                const smsResult = await sendSms(normalized, msg);
                await storage.createClinicAlertLog({
                  clinicId: clinic.id,
                  alertFingerprint: fingerprint,
                  alertType: "sms",
                  overall: health.overall,
                  criticalCodes,
                  sentTo: normalized,
                  providerSid: smsResult.sid || null,
                  error: smsResult.success ? null : (smsResult.error || null),
                });
                if (smsResult.success) alertsSent++;
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[CLINIC-ALERT] Error for city ${city.name}: ${err.message}`);
    }
  }

  return { clinicsChecked, alertsSent };
}

import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";

let opsAlertTask: HarnessedTask | null = null;

export function startOpsAlertScheduler() {
  if (opsAlertTask) return;

  opsAlertTask = createHarnessedTask({
    name: "ops_alert",
    lockKey: "scheduler:lock:ops_alert",
    lockTtlSeconds: 30,
    timeoutMs: 60_000,
    fn: async () => {
      const opsResult = await runOpsAlertCycle();
      console.log(`[OPS-ALERT] Cycle done: ${opsResult.citiesChecked} cities, ${opsResult.alertsSent} SMS sent`);

      const clinicResult = await runClinicAlertCycle();
      console.log(`[CLINIC-ALERT] Cycle done: ${clinicResult.clinicsChecked} clinics, ${clinicResult.alertsSent} alerts sent`);
    },
  });

  registerInterval("ops_alert", SCHEDULER_INTERVAL_MS, opsAlertTask);
  console.log(`[OPS-ALERT] Scheduler started (interval: ${SCHEDULER_INTERVAL_MS / 1000}s)`);
}

export function stopOpsAlertScheduler() {
  if (opsAlertTask) {
    opsAlertTask.stop();
    opsAlertTask = null;
    console.log("[OPS-ALERT] Scheduler stopped");
  }
}

export function registerOpsRoutes(app: Express) {
  app.get("/api/config/maps", authMiddleware, requireRole("SUPER_ADMIN"), (_req: AuthRequest, res) => {
    const hasBrowserKey = !!(process.env.GOOGLE_MAPS_BROWSER_KEY || "").trim();
    const hasServerKey = !!(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_SERVER_KEY || "").trim();
    const hasViteKey = !!(process.env.VITE_GOOGLE_MAPS_API_KEY || "").trim();
    const domain = process.env.APP_BASE_URL || "unknown";
    res.json({ hasBrowserKey, hasServerKey, hasViteKey, domain });
  });

  app.get("/api/ops/health", authMiddleware, requirePermission("dashboard", "read"), async (req: AuthRequest, res) => {
    try {
      const cityId = req.query.city_id ? parseInt(req.query.city_id as string) : undefined;
      const dateParam = req.query.date as string | undefined;

      if (!cityId) return res.status(400).json({ error: "city_id required" });

      const city = await storage.getCity(cityId);
      if (!city) return res.status(404).json({ error: "City not found" });

      const date = dateParam || todayDateStr(city.timezone);
      const tripsList = await storage.getTripsForCityAndDate(cityId, date);
      const health = computeCityOpsHealth(tripsList, cityId, city.name, date, city.timezone);

      let dbOk = true;
      try {
        const { pool } = await import("../db");
        await pool.query("SELECT 1");
      } catch {
        dbOk = false;
        health.alerts.push({ code: "DB_CONNECTION_ERROR", severity: "critical", title: "Database connection error", count: 1 });
        health.overall = "red";
      }

      let redisOk = true;
      try {
        const { pingRedis, getLastRedisError, getRedisMetrics, isRedisConnected } = await import("./redis");
        const redisConfigured = isRedisConnected();
        if (redisConfigured) {
          const redisPing = await pingRedis();
          redisOk = redisPing.ok;
          (health as any).redis = redisPing.ok ? "OK" : "FAIL";
          (health as any).redis_latency_ms = redisPing.latencyMs;
          if (!redisPing.ok) {
            (health as any).lastRedisError = redisPing.error || getLastRedisError();
            health.alerts.push({ code: "REDIS_CONNECTION_ERROR", severity: "critical", title: "Redis connection error", count: 1 });
            health.overall = "red";
          }
        } else {
          (health as any).redis = "NOT_CONFIGURED";
          (health as any).redis_fallback = "in-memory";
        }
        (health as any).redis_metrics = getRedisMetrics();
      } catch (err: any) {
        redisOk = false;
        (health as any).redis = "FAIL";
        (health as any).lastRedisError = err.message;
        health.alerts.push({ code: "REDIS_CONNECTION_ERROR", severity: "critical", title: "Redis connection error", count: 1 });
        health.overall = "red";
      }

      if (dbOk) {
        try {
          const allDrivers = await storage.getDrivers(cityId);
          const activeDrivers = allDrivers.filter(d => d.active && !d.deletedAt && d.status === "ACTIVE");
          const now = Date.now();
          const STALE_GPS_MS = 5 * 60 * 1000;
          const staleGps = activeDrivers.filter(d => {
            if (!d.lastSeenAt) return false;
            if (d.dispatchStatus === "off") return false;
            return (now - new Date(d.lastSeenAt).getTime()) > STALE_GPS_MS;
          });
          if (staleGps.length > 0) {
            health.alerts.push({
              code: "STALE_DRIVER_GPS",
              severity: staleGps.length > 3 ? "critical" : "warning",
              title: `Drivers with stale GPS (>5 min)`,
              count: staleGps.length,
            });
            if (staleGps.length > 3 && health.overall !== "red") health.overall = "red";
            else if (health.overall === "green") health.overall = "yellow";
          }
        } catch {}

        const { getActiveConnectionCount } = await import("./realtime");
        const wsConnections = getActiveConnectionCount();

        (health as any).websocket_connections = wsConnections;
        (health as any).cache_stats = {
          driver_locations: (await import("./cache")).cache.keys("driver:.*:last_location").length,
          trip_etas: (await import("./cache")).cache.keys("trip:.*:eta").length,
        };
      }

      const recentAlerts = await storage.getOpsAlertsByCityAndDate(cityId, date);
      health.lastSmsSentAt = recentAlerts.length > 0 ? recentAlerts[0].sentAt?.toISOString() : null;

      const criticalCount = health.alerts.filter(a => a.severity === "critical").length;
      const warningCount = health.alerts.filter(a => a.severity === "warning").length;
      if (criticalCount > 0) health.overall = "red";
      else if (warningCount > 0 && health.overall === "green") health.overall = "yellow";

      res.json(health);
    } catch (err: any) {
      console.error("[OPS-HEALTH] Error:", err.message);
      res.status(500).json({ error: "Failed to compute ops health" });
    }
  });

  app.get("/api/ops/checks", authMiddleware, requirePermission("dashboard", "read"), async (req: AuthRequest, res) => {
    try {
      const rawCityId = req.query.city_id ? parseInt(req.query.city_id as string) : undefined;
      const cityId = rawCityId && !isNaN(rawCityId) ? rawCityId : undefined;
      const { isDriverOnline, isDriverVisibleOnMap, ONLINE_CUTOFF_MS } = await import("./driverClassification");

      const rawDrivers = await storage.getDrivers(cityId);
      const activeDrivers = rawDrivers.filter(d => d.active && !d.deletedAt && d.status === "ACTIVE");
      const allTrips = await storage.getTrips(cityId);
      const today = new Date().toISOString().slice(0, 10);

      const checks: {
        id: string;
        name: string;
        pass: boolean;
        count: number;
        details: string[];
      }[] = [];

      const onMapButOff = activeDrivers.filter(d =>
        (d.lastLat != null && d.lastLng != null) &&
        (d.dispatchStatus === "off" || !isDriverOnline(d))
      );
      checks.push({
        id: "drivers_on_map_but_off",
        name: "Drivers with GPS coords but logged out / stale",
        pass: onMapButOff.length === 0,
        count: onMapButOff.length,
        details: onMapButOff.map(d => `${d.firstName} ${d.lastName} (${d.publicId}) - status: ${d.dispatchStatus}, lastSeen: ${d.lastSeenAt || 'never'}`),
      });

      const availableButStale = activeDrivers.filter(d =>
        d.dispatchStatus === "available" && !isDriverOnline(d)
      );
      checks.push({
        id: "available_but_stale_last_seen",
        name: "Drivers marked available but stale GPS (>120s)",
        pass: availableButStale.length === 0,
        count: availableButStale.length,
        details: availableButStale.map(d => `${d.firstName} ${d.lastName} (${d.publicId}) - lastSeen: ${d.lastSeenAt || 'never'}`),
      });

      const todayTrips = allTrips.filter(t => t.scheduledDate === today);
      const scheduledNoPickup = todayTrips.filter(t =>
        t.status === "SCHEDULED" && !t.pickupTime
      );
      checks.push({
        id: "trips_scheduled_missing_pickup_time",
        name: "Scheduled trips missing pickup time",
        pass: scheduledNoPickup.length === 0,
        count: scheduledNoPickup.length,
        details: scheduledNoPickup.map(t => `${t.publicId} - date: ${t.scheduledDate}`),
      });

      const assignedNoDriver = todayTrips.filter(t =>
        t.status === "ASSIGNED" && !t.driverId
      );
      checks.push({
        id: "trips_assigned_missing_driver",
        name: "Trips marked ASSIGNED but no driver set",
        pass: assignedNoDriver.length === 0,
        count: assignedNoDriver.length,
        details: assignedNoDriver.map(t => `${t.publicId}`),
      });

      const allPassed = checks.every(c => c.pass);

      res.json({ ok: allPassed, checks });
    } catch (err: any) {
      console.error("[OPS-CHECKS] Error:", err.message);
      res.status(500).json({ error: "Failed to run ops checks" });
    }
  });

  app.get("/api/ops/clinic-health", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "VIEWER", "CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;

      if (!clinicId) return res.status(400).json({ error: "clinic_id required" });

      if (req.user!.role === "VIEWER" || req.user!.role === "CLINIC_USER") {
        const viewerUser = await storage.getUser(req.user!.userId);
        if (viewerUser?.clinicId !== clinicId) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const clinic = await storage.getClinic(clinicId);
      if (!clinic) return res.status(404).json({ error: "Clinic not found" });

      const city = await storage.getCity(clinic.cityId);
      const date = todayDateStr(city?.timezone);
      const tripsList = await storage.getTripsForClinicToday(clinicId, date);
      const health = computeClinicHealth(tripsList, clinic, date, city?.timezone);

      const recentAlerts = await storage.getClinicAlertsByClinicId(clinicId, 1);
      health.lastAlertSentAt = recentAlerts.length > 0 ? recentAlerts[0].sentAt?.toISOString() : null;

      res.json(health);
    } catch (err: any) {
      console.error("[CLINIC-HEALTH] Error:", err.message);
      res.status(500).json({ error: "Failed to compute clinic health" });
    }
  });

  app.get("/api/ops/alerts/health", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), async (_req: AuthRequest, res) => {
    res.json({
      ok: true,
      dispatchPhoneConfigured: !!process.env.DISPATCH_PHONE_NUMBER,
      twilioConfigured: isTwilioConfigured(),
      schedulerRunning: !!opsAlertTask,
      cooldownMinutes: COOLDOWN_MINUTES,
      intervalSeconds: SCHEDULER_INTERVAL_MS / 1000,
    });
  });

  app.get("/api/ops/alerts/history", authMiddleware, requirePermission("dashboard", "read"), async (req: AuthRequest, res) => {
    try {
      const cityId = req.query.city_id ? parseInt(req.query.city_id as string) : undefined;
      const date = req.query.date as string | undefined;

      if (!cityId || !date) return res.status(400).json({ error: "city_id and date required" });

      const alerts = await storage.getOpsAlertsByCityAndDate(cityId, date);
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ops/alerts/run-once", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res) => {
    try {
      const opsResult = await runOpsAlertCycle();
      const clinicResult = await runClinicAlertCycle();
      res.json({
        ok: true,
        ops: opsResult,
        clinic: clinicResult,
      });
    } catch (err: any) {
      console.error("[OPS-ALERT] Manual run error:", err.message);
      res.status(500).json({ error: "Alert cycle failed" });
    }
  });

  app.post("/api/ops/alerts/test-sms", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const cityId = req.body.city_id ? parseInt(req.body.city_id) : undefined;
      if (!cityId) return res.status(400).json({ error: "city_id required" });

      const city = await storage.getCity(cityId);
      if (!city) return res.status(404).json({ error: "City not found" });

      const dispatchPhone = process.env.DISPATCH_PHONE_NUMBER || "";
      const normalized = normalizePhone(dispatchPhone);
      if (!normalized) return res.status(400).json({ error: "No valid dispatch phone configured" });

      const message = `UCM OPS TEST (${city.name}): System test alert. No action needed.`;
      const result = await sendSms(normalized, message);

      res.json({ ok: result.success, sid: result.sid, error: result.error });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ops/clinic-help", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "VIEWER", "CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"), async (req: AuthRequest, res) => {
    try {
      const { clinic_id, message } = req.body;
      if (!clinic_id || !message) return res.status(400).json({ error: "clinic_id and message required" });

      const parsedClinicId = parseInt(clinic_id);
      if (req.user!.role === "VIEWER" || req.user!.role === "CLINIC_USER") {
        const viewerUser = await storage.getUser(req.user!.userId);
        if (viewerUser?.clinicId !== parsedClinicId) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const clinic = await storage.getClinic(parsedClinicId);
      if (!clinic) return res.status(404).json({ error: "Clinic not found" });

      const helpReq = await storage.createClinicHelpRequest({
        clinicId: parseInt(clinic_id),
        message,
      });

      const dispatchPhone = process.env.DISPATCH_PHONE_NUMBER || "";
      const normalized = normalizePhone(dispatchPhone);
      if (normalized && isTwilioConfigured()) {
        const smsMsg = `UCM: ${clinic.name} requests dispatch help: "${message.slice(0, 80)}"`;
        await sendSms(normalized, smsMsg);
      }

      res.json(helpReq);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ops/clinic-help", authMiddleware, requirePermission("dashboard", "read"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      const requests = await storage.getClinicHelpRequests(clinicId);
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ops/clinic-help/:id/resolve", authMiddleware, requirePermission("dashboard", "read"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const resolved = await storage.resolveClinicHelpRequest(id, req.user!.userId);
      if (!resolved) return res.status(404).json({ error: "Help request not found" });
      res.json(resolved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ops/metrics", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getRequestMetricsSummary } = await import("./requestMetrics");
      const { getRedisMetrics } = await import("./redis");
      const { getRealtimeMetrics } = await import("./supabaseRealtime");
      const { getDirectionsMetrics } = await import("./googleMaps");
      const { getBackpressureMetrics, getDegradeTier, getLocationPublishInterval } = await import("./backpressure");
      const { getActiveConnectionCount, getActiveSubscriptionCount } = await import("./realtime");
      const { getIngestMetrics } = await import("./driverLocationIngest");

      const bp = getBackpressureMetrics();

      res.json({
        ok: true,
        ts: new Date().toISOString(),
        requestId: req.requestId,
        request: getRequestMetricsSummary(),
        redis: getRedisMetrics(),
        realtime: {
          ...getRealtimeMetrics(),
          ws_connections: getActiveConnectionCount(),
          ws_subscriptions: getActiveSubscriptionCount(),
        },
        google: getDirectionsMetrics(),
        backpressure: {
          ...bp,
          degrade_tier: getDegradeTier(),
          publish_interval_ms: getLocationPublishInterval(),
        },
        gps_ingest: getIngestMetrics(),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/metrics/routes", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getTopRoutes } = await import("./requestMetrics");
      const limit = parseInt(req.query.limit as string) || 20;
      res.json({
        ok: true,
        window: "5min",
        routes: getTopRoutes(Math.min(limit, 100)),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/metrics/google", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res) => {
    try {
      const { getDirectionsMetrics } = await import("./googleMaps");
      res.json({
        ok: true,
        ...getDirectionsMetrics(),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/redis-diagnostics", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res) => {
    try {
      const { isRedisConnected, setJson, getJson, del, incr, setNx } = await import("./redis");
      const redisConnected = isRedisConnected();

      const testKey = `diag:test:${Date.now()}`;
      const rlKey = `diag:rl:${Date.now()}`;
      const lockKey = `diag:lock:${Date.now()}`;

      let canSetGet = false;
      const cacheSample: { set: string; get: string; cleanup: string } = { set: "fail", get: "fail", cleanup: "fail" };
      const rateLimitTest: { firstIncr: number | null; secondIncr: number | null; wouldBeRateLimited: boolean } = { firstIncr: null, secondIncr: null, wouldBeRateLimited: false };
      const lockTest: { firstLock: boolean | null; secondLock: boolean | null; secondFailed: boolean } = { firstLock: null, secondLock: null, secondFailed: false };

      try {
        await setJson(testKey, { status: "ok", ts: Date.now() }, 10);
        cacheSample.set = "ok";
        const retrieved = await getJson<{ status: string; ts: number }>(testKey);
        cacheSample.get = retrieved && retrieved.status === "ok" ? "ok" : "fail";
        canSetGet = cacheSample.set === "ok" && cacheSample.get === "ok";
        await del(testKey);
        cacheSample.cleanup = "ok";
      } catch (err: any) {
        cacheSample.set = `error: ${err.message}`;
      }

      try {
        rateLimitTest.firstIncr = await incr(rlKey, 10);
        rateLimitTest.secondIncr = await incr(rlKey, 10);
        rateLimitTest.wouldBeRateLimited = (rateLimitTest.secondIncr ?? 0) > 1;
        await del(rlKey);
      } catch (err: any) {
        rateLimitTest.firstIncr = -1;
      }

      try {
        lockTest.firstLock = await setNx(lockKey, "holder-1", 10);
        lockTest.secondLock = await setNx(lockKey, "holder-2", 10);
        lockTest.secondFailed = lockTest.firstLock === true && lockTest.secondLock === false;
        await del(lockKey);
      } catch (err: any) {
        lockTest.firstLock = null;
      }

      res.json({
        redisConnected,
        canSetGet,
        cacheSample,
        rateLimitTest,
        lockTest,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/redis/ping", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res) => {
    try {
      const { pingRedis, getRedisConfig } = await import("./redis");
      const config = getRedisConfig();
      if (!config.connected) {
        return res.json({
          ok: false,
          latencyMs: 0,
          error: !config.hasRestUrl || !config.hasRestToken
            ? "Missing env vars: " + config.envVarsExpected.filter((k, i) => i === 0 ? !config.hasRestUrl : !config.hasRestToken).join(", ")
            : config.lastError || "Redis client not initialized",
          config: { hasRestUrl: config.hasRestUrl, hasRestToken: config.hasRestToken, clientType: config.clientType },
        });
      }
      const ping = await pingRedis();
      return res.json({
        ok: ping.ok,
        latencyMs: ping.latencyMs,
        error: ping.error || null,
        config: { hasRestUrl: config.hasRestUrl, hasRestToken: config.hasRestToken, clientType: config.clientType },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, latencyMs: 0, error: err.message?.substring(0, 200) });
    }
  });

  function csvEscape(val: unknown): string {
    if (val === null || val === undefined) return "";
    const s = typeof val === "object" ? JSON.stringify(val) : String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function toCsvServer(rows: Record<string, unknown>[], columns?: string[]): string {
    if (rows.length === 0) return "";
    const headers = columns ?? Object.keys(rows[0]);
    const lines = [headers.map(csvEscape).join(",")];
    for (const row of rows) {
      lines.push(headers.map((h) => csvEscape(row[h])).join(","));
    }
    return "\ufeff" + lines.join("\n");
  }

  function sendCsv(res: any, csv: string, filename: string) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(csv);
  }

  app.get("/api/ops/metrics/download.json", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getRequestMetricsSummary } = await import("./requestMetrics");
      const { getRedisMetrics } = await import("./redis");
      const { getRealtimeMetrics } = await import("./supabaseRealtime");
      const { getDirectionsMetrics } = await import("./googleMaps");
      const { getBackpressureMetrics, getDegradeTier, getLocationPublishInterval } = await import("./backpressure");
      const { getActiveConnectionCount, getActiveSubscriptionCount } = await import("./realtime");
      const { getIngestMetrics } = await import("./driverLocationIngest");
      const { getTopRoutes } = await import("./requestMetrics");

      const bp = getBackpressureMetrics();
      const payload = {
        generatedAt: new Date().toISOString(),
        request: getRequestMetricsSummary(),
        redis: getRedisMetrics(),
        realtime: {
          ...getRealtimeMetrics(),
          ws_connections: getActiveConnectionCount(),
          ws_subscriptions: getActiveSubscriptionCount(),
        },
        google: getDirectionsMetrics(),
        backpressure: {
          ...bp,
          degrade_tier: getDegradeTier(),
          publish_interval_ms: getLocationPublishInterval(),
        },
        gps_ingest: getIngestMetrics(),
        routes: getTopRoutes(100),
      };

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="ucm-metrics-${new Date().toISOString().slice(0, 10)}.json"`);
      res.setHeader("Cache-Control", "no-store");
      res.json(payload);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/metrics/summary.csv", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getRequestMetricsSummary } = await import("./requestMetrics");
      const { getRedisMetrics } = await import("./redis");
      const { getRealtimeMetrics } = await import("./supabaseRealtime");
      const { getDirectionsMetrics } = await import("./googleMaps");
      const metrics = getRequestMetricsSummary();
      const redis = getRedisMetrics();
      const rt = getRealtimeMetrics();
      const goog = getDirectionsMetrics();

      const row: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        reqPerMin: metrics.total_requests_5min,
        errorRatePct: metrics.error_rate_pct,
        p95LatencyMs: metrics.p95_latency_ms,
        redisOk: redis.redis_connected ? "yes" : "no",
        cacheHitRatePct: redis.cache_hit_rate,
        realtimeTokensIssuedPerMin: rt.realtime_tokens_per_min,
        realtimePublishesPerMin_location: rt.realtime_broadcasts_by_type?.location ?? 0,
        realtimePublishesPerMin_eta: rt.realtime_broadcasts_by_type?.eta ?? 0,
        realtimePublishesPerMin_status: rt.realtime_broadcasts_by_type?.status_change ?? 0,
        directionsCallsPerMin: goog?.directions_calls_per_min ?? 0,
        directionsFailuresPerMin: goog?.directions_failures_last_60s ?? 0,
        breakerOn: goog?.circuit_breaker?.open ? "yes" : "no",
      };

      sendCsv(res, toCsvServer([row]), `ucm-metrics-summary-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/metrics.csv", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getRequestMetricsSummary } = await import("./requestMetrics");
      const { getRedisMetrics, isRedisConnected } = await import("./redis");
      const { getRealtimeMetrics } = await import("./supabaseRealtime");
      const { getDirectionsMetrics } = await import("./googleMaps");
      const { getBackpressureMetrics, getDegradeTier, getLocationPublishInterval } = await import("./backpressure");
      const { getActiveConnectionCount, getActiveSubscriptionCount } = await import("./realtime");
      const { getIngestMetrics } = await import("./driverLocationIngest");

      const metrics = getRequestMetricsSummary();
      const redis = getRedisMetrics();
      const rt = getRealtimeMetrics();
      const goog = getDirectionsMetrics();
      const bp = getBackpressureMetrics();
      const gps = getIngestMetrics();

      let dbOk = false;
      let dbLatency = 0;
      try {
        const start = Date.now();
        const { pool } = await import("../db");
        await pool.query("SELECT 1");
        dbLatency = Date.now() - start;
        dbOk = true;
      } catch {}

      const row: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        rpm_1min: metrics.rpm_1min,
        rpm_5min: metrics.rpm_5min,
        rpm_15min: metrics.rpm_15min,
        p50_latency_ms: metrics.p50_latency_ms,
        p95_latency_ms: metrics.p95_latency_ms,
        error_rate_pct: metrics.error_rate_pct,
        errors_4xx: metrics.errors_4xx_5min,
        errors_5xx: metrics.errors_5xx_5min,
        ws_connections: getActiveConnectionCount(),
        ws_subscriptions: getActiveSubscriptionCount(),
        redis_connected: isRedisConnected() ? "yes" : "no",
        cache_hit_rate: redis.cache_hit_rate,
        db_connected: dbOk ? "yes" : "no",
        db_latency_ms: dbLatency,
        degrade_tier: getDegradeTier(),
        publish_interval_ms: getLocationPublishInterval(),
        gps_ingest_rpm: gps.gps_ingest_requests_per_min,
        directions_calls_pm: goog?.directions_calls_per_min ?? 0,
        breaker_open: goog?.circuit_breaker?.open ? "yes" : "no",
      };

      sendCsv(res, toCsvServer([row]), `ucm-metrics-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/metrics/health.csv", authMiddleware, requirePermission("dashboard", "read"), async (req: AuthRequest, res) => {
    try {
      const { getRedisMetrics, isRedisConnected } = await import("./redis");
      const redis = getRedisMetrics();

      const row: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        redis: isRedisConnected() ? "ok" : "fail",
        cacheHitRate: redis.cache_hit_rate,
        cacheErrors: redis.cache_errors,
        lastError: redis.last_error ?? "",
      };

      sendCsv(res, toCsvServer([row]), `ucm-metrics-health-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/metrics/cache.csv", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getRedisMetrics } = await import("./redis");
      const redis = getRedisMetrics();
      const rows: Record<string, unknown>[] = [];
      const now = new Date().toISOString();

      if (redis.cache_by_key && Object.keys(redis.cache_by_key).length > 0) {
        for (const [keyFamily, data] of Object.entries(redis.cache_by_key)) {
          const total = (data as any).hits + (data as any).misses;
          rows.push({
            generatedAt: now,
            keyFamily,
            hits: (data as any).hits,
            misses: (data as any).misses,
            hitRatePct: total > 0 ? Math.round(((data as any).hits / total) * 100) : 0,
          });
        }
      } else {
        const total = redis.cache_hits + redis.cache_misses;
        rows.push({
          generatedAt: now,
          keyFamily: "all",
          hits: redis.cache_hits,
          misses: redis.cache_misses,
          hitRatePct: total > 0 ? Math.round((redis.cache_hits / total) * 100) : 0,
        });
      }

      sendCsv(res, toCsvServer(rows, ["generatedAt", "keyFamily", "hits", "misses", "hitRatePct"]), `ucm-metrics-cache-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/metrics/realtime.csv", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getRealtimeMetrics } = await import("./supabaseRealtime");
      const { getActiveConnectionCount } = await import("./realtime");
      const rt = getRealtimeMetrics();
      const now = new Date().toISOString();
      const rows: Record<string, unknown>[] = [];
      const byType = rt.realtime_broadcasts_by_type;

      if (byType) {
        for (const [eventType, count] of Object.entries(byType)) {
          rows.push({ generatedAt: now, eventType, publishesPerMin: count });
        }
      }
      rows.push({
        generatedAt: now,
        eventType: "__totals__",
        publishesPerMin: rt.realtime_broadcasts_per_min,
        tokensIssuedPerMin: rt.realtime_tokens_per_min,
        wsConnections: getActiveConnectionCount(),
      });

      sendCsv(res, toCsvServer(rows, ["generatedAt", "eventType", "publishesPerMin", "tokensIssuedPerMin", "wsConnections"]), `ucm-metrics-realtime-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/metrics/google.csv", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getDirectionsMetrics } = await import("./googleMaps");
      const { getRedisMetrics } = await import("./redis");
      const goog = getDirectionsMetrics();
      const redis = getRedisMetrics();

      const row: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        directionsCallsPerMin: goog.directions_calls_per_min,
        directionsFailuresPerMin: goog.directions_failures_last_60s,
        breakerOn: goog.circuit_breaker?.open ? "yes" : "no",
        breakerRemainingSec: goog.circuit_breaker?.cooldown_seconds ?? "",
        lockContentionCount: redis.eta_lock_contention_count ?? "",
      };

      sendCsv(res, toCsvServer([row]), `ucm-metrics-google-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/degrade-status", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getBackpressureMetrics, getDegradeTier } = await import("./backpressure");
      const { isCircuitBreakerOpen, getDirectionsCallsLast60s } = await import("./googleMaps");
      const bp = getBackpressureMetrics();
      const tier = getDegradeTier();
      res.json({
        ok: true,
        degrade_tier: tier,
        degrade_on: bp.degrade_mode_on,
        degrade_reason: bp.degrade_mode_reason,
        degrade_since: bp.degrade_mode_since ? new Date(bp.degrade_mode_since).toISOString() : null,
        publish_interval_ms: bp.publish_interval_ms,
        p95_latency_ms: bp.p95_latency_ms,
        circuit_breaker_open: isCircuitBreakerOpen(),
        directions_calls_60s: getDirectionsCallsLast60s(),
        color: tier === 0 ? "green" : tier === 1 ? "yellow" : "red",
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/perf/summary", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getPerfSummary, isProfilingEnabled } = await import("./requestTracing");
      const minutes = req.query.minutes ? parseInt(req.query.minutes as string) : 5;
      const summary = getPerfSummary(Math.min(Math.max(1, minutes), 60));
      res.json({
        ok: true,
        profiling_enabled: isProfilingEnabled(),
        traced_count: summary.total_requests,
        avg_db_ms: summary.avg_db_ms,
        cache_hit_rate: summary.cache_hit_rate_pct / 100,
        routes: summary.top_slow_routes.map(r => ({
          route: r.route,
          p95_ms: r.p95_ms,
          count: r.count,
          db_p95_ms: r.db_p95_ms,
          cache_hit_rate: r.cache_hit_rate_pct,
        })),
        n1_warnings: summary.top_slow_routes
          .filter(r => r.query_budget_warnings > 0)
          .map(r => ({ route: r.route, query_count: r.query_budget_warnings })),
        query_budget_violations: summary.query_budget_violations,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/ops/metrics/routes.csv", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const { getTopRoutes } = await import("./requestMetrics");
      const routes = getTopRoutes(100);
      const now = new Date().toISOString();

      if (!routes || routes.length === 0) {
        return sendCsv(res, "", `ucm-metrics-routes-${new Date().toISOString().slice(0, 10)}.csv`);
      }

      const rows = routes.map((r: any) => ({
        generatedAt: now,
        route: r.route,
        count: r.request_count,
        p95Ms: r.p95_ms,
        errorCount: r.error_count,
      }));

      sendCsv(res, toCsvServer(rows, ["generatedAt", "route", "count", "p95Ms", "errorCount"]), `ucm-metrics-routes-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  const LOCATION_STALE_MS = 120_000;

  app.get("/api/ops/driver-locations", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const cityId = req.query.city_id ? parseInt(String(req.query.city_id)) : null;
      if (!cityId) return res.status(400).json({ message: "city_id is required" });

      const callerRole = req.user?.role;
      const callerCompanyId = getCompanyIdFromAuth(req);

      const conditions: any[] = [
        eq(drivers.cityId, cityId),
        eq(drivers.active, true),
        isNull(drivers.deletedAt),
        isNotNull(drivers.lastLat),
        isNotNull(drivers.lastLng),
      ];

      if (callerRole !== "SUPER_ADMIN" && callerCompanyId) {
        conditions.push(eq(drivers.companyId, callerCompanyId));
      }

      const rows = await db
        .select({
          driverId: drivers.id,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
          cityId: drivers.cityId,
          companyId: drivers.companyId,
          companyName: companies.name,
          lat: drivers.lastLat,
          lng: drivers.lastLng,
          lastSeenAt: drivers.lastSeenAt,
          dispatchStatus: drivers.dispatchStatus,
          connected: drivers.connected,
          vehicleId: drivers.vehicleId,
          vehicleName: vehicles.name,
          vehicleLicensePlate: vehicles.licensePlate,
          vehicleColorHex: vehicles.colorHex,
          vehicleMake: vehicles.makeText,
          vehicleModel: vehicles.modelText,
        })
        .from(drivers)
        .leftJoin(companies, eq(drivers.companyId, companies.id))
        .leftJoin(vehicles, eq(drivers.vehicleId, vehicles.id))
        .where(and(...conditions))
        .orderBy(desc(drivers.lastSeenAt));

      const now = Date.now();

      const activeTripsMap = new Map<number, { tripId: number; publicId: string; status: string; patientName: string | null }>();
      try {
        const activeStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "IN_PROGRESS", "ARRIVED_DROPOFF"];
        const driverIds = rows.map(r => r.driverId);
        if (driverIds.length > 0) {
          const activeTrips = await db
            .select({
              driverId: trips.driverId,
              tripId: trips.id,
              publicId: trips.publicId,
              status: trips.status,
            })
            .from(trips)
            .where(and(
              inArray(trips.driverId, driverIds),
              inArray(trips.status, activeStatuses as any),
              eq(trips.cityId, cityId),
            ));
          for (const t of activeTrips) {
            if (t.driverId && !activeTripsMap.has(t.driverId)) {
              activeTripsMap.set(t.driverId, { tripId: t.tripId, publicId: t.publicId, status: t.status, patientName: null });
            }
          }
        }
      } catch (err: any) {
        console.error("[LIVE-MAP] Failed to fetch active trips:", err?.message || err);
      }

      const statusMap: Record<string, string> = {
        available: "available",
        on_trip: "enroute",
        hold: "hold",
        off: "off",
      };

      const result = rows.map(r => {
        const updatedAt = r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : null;
        const ageMs = r.lastSeenAt ? now - new Date(r.lastSeenAt).getTime() : Infinity;
        const activeTrip = activeTripsMap.get(r.driverId);
        const driverStatus = activeTrip ? "enroute" : (statusMap[r.dispatchStatus] || (r.connected ? "available" : "off"));

        return {
          driver_id: r.driverId,
          driver_name: `${r.firstName} ${r.lastName}`,
          company_name: r.companyName,
          city_id: r.cityId,
          lat: r.lat!,
          lng: r.lng!,
          updated_at: updatedAt,
          status: driverStatus,
          stale: ageMs > LOCATION_STALE_MS,
          vehicle_id: r.vehicleId,
          vehicle_label: r.vehicleName,
          vehicle_color: r.vehicleColorHex,
          vehicle_color_hex: r.vehicleColorHex,
          vehicle_make: r.vehicleMake,
          vehicle_model: r.vehicleModel,
          active_trip_status: activeTrip?.status || null,
          active_trip_id: activeTrip?.publicId || null,
          active_trip_patient: activeTrip?.patientName || null,
        };
      });

      res.json(result);
    } catch (err: any) {
      console.error("[OPS] driver-locations error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ops/my-active-trips", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const cityId = req.query.city_id ? parseInt(String(req.query.city_id)) : null;
      res.json({ role: req.user?.role || "unknown", trips: [] });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ops/dispatch-simulate/:tripId", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(req.params.tripId);
      if (isNaN(tripId)) return res.status(400).json({ ok: false, message: "Invalid trip ID" });
      const { simulateDispatchFlow } = await import("./dispatchWindowEngine");
      const result = await simulateDispatchFlow(tripId);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });
}
