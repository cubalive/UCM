import type { Express } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { sendSms, normalizePhone, isTwilioConfigured } from "./twilioSms";
import { sendEmail } from "./email";
import type { Trip, City, Clinic } from "@shared/schema";

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

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startOpsAlertScheduler() {
  if (schedulerInterval) return;

  console.log(`[OPS-ALERT] Scheduler started (interval: ${SCHEDULER_INTERVAL_MS / 1000}s)`);

  schedulerInterval = setInterval(async () => {
    try {
      const opsResult = await runOpsAlertCycle();
      console.log(`[OPS-ALERT] Cycle done: ${opsResult.citiesChecked} cities, ${opsResult.alertsSent} SMS sent`);

      const clinicResult = await runClinicAlertCycle();
      console.log(`[CLINIC-ALERT] Cycle done: ${clinicResult.clinicsChecked} clinics, ${clinicResult.alertsSent} alerts sent`);
    } catch (err: any) {
      console.error(`[OPS-ALERT] Scheduler error: ${err.message}`);
    }
  }, SCHEDULER_INTERVAL_MS);
}

export function stopOpsAlertScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[OPS-ALERT] Scheduler stopped");
  }
}

export function registerOpsRoutes(app: Express) {
  app.get("/api/ops/health", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.get("/api/ops/checks", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.get("/api/ops/clinic-health", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "VIEWER"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;

      if (!clinicId) return res.status(400).json({ error: "clinic_id required" });

      if (req.user!.role === "VIEWER" && req.user!.clinicId !== clinicId) {
        return res.status(403).json({ error: "Access denied" });
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
      schedulerRunning: !!schedulerInterval,
      cooldownMinutes: COOLDOWN_MINUTES,
      intervalSeconds: SCHEDULER_INTERVAL_MS / 1000,
    });
  });

  app.get("/api/ops/alerts/history", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.post("/api/ops/clinic-help", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "VIEWER"), async (req: AuthRequest, res) => {
    try {
      const { clinic_id, message } = req.body;
      if (!clinic_id || !message) return res.status(400).json({ error: "clinic_id and message required" });

      const parsedClinicId = parseInt(clinic_id);
      if (req.user!.role === "VIEWER" && req.user!.clinicId !== parsedClinicId) {
        return res.status(403).json({ error: "Access denied" });
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

  app.get("/api/ops/clinic-help", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      const requests = await storage.getClinicHelpRequests(clinicId);
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ops/clinic-help/:id/resolve", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const resolved = await storage.resolveClinicHelpRequest(id, req.user!.userId);
      if (!resolved) return res.status(404).json({ error: "Help request not found" });
      res.json(resolved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
