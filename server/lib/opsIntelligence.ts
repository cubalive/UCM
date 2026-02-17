import { db } from "../db";
import { drivers, trips, clinics, opsAnomalies, driverPerfScores, companies, companySettings } from "@shared/schema";
import { eq, and, sql, isNull, inArray, gte, or } from "drizzle-orm";
import { setJson, getJson } from "./redis";
import { getRequestMetricsSummary } from "./requestMetrics";

const PUNCTUALITY_GRACE_MIN = parseInt(process.env.UCM_PUNCTUALITY_GRACE_MIN || "10");
const ACCEPTANCE_WINDOW_MIN = parseInt(process.env.UCM_ACCEPTANCE_WINDOW_MIN || "2");
const GPS_STALE_THRESHOLD_MIN = parseInt(process.env.UCM_GPS_STALE_MIN || "5");
const LATE_SPIKE_PCT = parseFloat(process.env.UCM_LATE_SPIKE_PCT || "0.20");
const CANCEL_SPIKE_THRESHOLD = parseInt(process.env.UCM_CANCEL_SPIKE_THRESHOLD || "3");
const QUOTA_WARN_PCT = parseFloat(process.env.UCM_QUOTA_WARN_PCT || "0.85");
const AUTO_RESOLVE_MISSES = parseInt(process.env.UCM_ANOMALY_RESOLVE_MISSES || "2");

interface ScoreComponents {
  punctuality: number;
  completion: number;
  cancellations: number;
  gpsQuality: number;
  acceptance: number;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function timeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

export async function computeScoresForCompany(companyId: number, window: "7d" | "30d"): Promise<number> {
  const days = window === "7d" ? 7 : 30;
  const startDate = daysAgoStr(days);
  const today = todayStr();

  const companyDrivers = await db.select().from(drivers).where(
    and(
      eq(drivers.companyId, companyId),
      eq(drivers.active, true),
      isNull(drivers.deletedAt),
    )
  );

  if (companyDrivers.length === 0) return 0;

  const driverIds = companyDrivers.map(d => d.id);

  const windowTrips = await db.select().from(trips).where(
    and(
      eq(trips.companyId, companyId),
      inArray(trips.driverId, driverIds),
      sql`${trips.scheduledDate} >= ${startDate}`,
      sql`${trips.scheduledDate} <= ${today}`,
      isNull(trips.deletedAt),
    )
  );

  let scored = 0;

  for (const driver of companyDrivers) {
    const driverTrips = windowTrips.filter(t => t.driverId === driver.id);
    const total = driverTrips.length;
    if (total === 0) {
      await upsertPerfScore(companyId, driver.id, window, 50, {
        punctuality: 20, completion: 12, cancellations: 15, gpsQuality: 5, acceptance: 5,
      });
      scored++;
      continue;
    }

    const completed = driverTrips.filter(t => t.status === "COMPLETED").length;
    const cancelled = driverTrips.filter(t => t.status === "CANCELLED" || t.status === "NO_SHOW").length;
    const assigned = driverTrips.filter(t => t.status !== "SCHEDULED").length;

    let onTimeCount = 0;
    for (const trip of driverTrips.filter(t => t.status === "COMPLETED")) {
      const scheduledMins = timeToMinutes(trip.pickupTime || trip.scheduledTime);
      const actualPickup = trip.pickedUpAt ? new Date(trip.pickedUpAt) : null;
      if (scheduledMins != null && actualPickup) {
        const actualMins = actualPickup.getHours() * 60 + actualPickup.getMinutes();
        if (actualMins <= scheduledMins + PUNCTUALITY_GRACE_MIN) {
          onTimeCount++;
        }
      } else {
        onTimeCount++;
      }
    }

    const completedOrOngoing = driverTrips.filter(t => t.status !== "SCHEDULED").length;
    const punctualityRate = completedOrOngoing > 0 ? onTimeCount / completedOrOngoing : 1;
    const punctuality = Math.round(punctualityRate * 40);

    const completionRate = assigned > 0 ? completed / assigned : 1;
    const completionScore = Math.round(completionRate * 25);

    const cancelRate = total > 0 ? cancelled / total : 0;
    const cancellationScore = Math.max(0, Math.round((1 - cancelRate) * 15));

    const isStaleGps = driver.lastSeenAt
      ? (Date.now() - new Date(driver.lastSeenAt).getTime()) > GPS_STALE_THRESHOLD_MIN * 60_000
      : true;
    const gpsQuality = isStaleGps && (driver.dispatchStatus === "available" || driver.dispatchStatus === "on_trip")
      ? 3 : 10;

    let acceptedQuickly = 0;
    for (const trip of driverTrips) {
      if (trip.assignedAt && trip.startedAt) {
        const assignedTime = new Date(trip.assignedAt).getTime();
        const startedTime = new Date(trip.startedAt).getTime();
        if ((startedTime - assignedTime) <= ACCEPTANCE_WINDOW_MIN * 60_000) {
          acceptedQuickly++;
        }
      } else if (trip.status === "COMPLETED" || trip.status === "IN_PROGRESS") {
        acceptedQuickly++;
      }
    }
    const acceptanceRate = assigned > 0 ? acceptedQuickly / assigned : 1;
    const acceptanceScore = Math.round(acceptanceRate * 10);

    const rawScore = punctuality + completionScore + cancellationScore + gpsQuality + acceptanceScore;
    const score = Math.max(0, Math.min(100, rawScore));

    const components: ScoreComponents = {
      punctuality, completion: completionScore, cancellations: cancellationScore,
      gpsQuality, acceptance: acceptanceScore,
    };

    await upsertPerfScore(companyId, driver.id, window, score, components);
    scored++;
  }

  return scored;
}

async function upsertPerfScore(companyId: number, driverId: number, window: string, score: number, components: ScoreComponents) {
  const existing = await db.select().from(driverPerfScores).where(
    and(
      eq(driverPerfScores.companyId, companyId),
      eq(driverPerfScores.driverId, driverId),
      eq(driverPerfScores.window, window),
    )
  ).limit(1);

  if (existing.length > 0) {
    await db.update(driverPerfScores).set({
      score,
      components,
      computedAt: new Date(),
    }).where(eq(driverPerfScores.id, existing[0].id));
  } else {
    await db.insert(driverPerfScores).values({
      companyId,
      driverId,
      window,
      score,
      components,
      computedAt: new Date(),
    });
  }
}

export async function runAnomalySweep(companyId: number): Promise<{ detected: number; resolved: number }> {
  const now = new Date();
  const today = todayStr();
  const detected: Array<{ code: string; entityType: string; entityId: number | null; severity: string; title: string; details: Record<string, unknown> }> = [];

  const onlineDrivers = await db.select().from(drivers).where(
    and(
      eq(drivers.companyId, companyId),
      eq(drivers.active, true),
      isNull(drivers.deletedAt),
      or(
        eq(drivers.dispatchStatus, "available"),
        eq(drivers.dispatchStatus, "on_trip"),
      ),
    )
  );

  for (const driver of onlineDrivers) {
    const lastSeen = driver.lastSeenAt ? new Date(driver.lastSeenAt).getTime() : 0;
    const staleMinutes = (now.getTime() - lastSeen) / 60_000;
    if (staleMinutes > GPS_STALE_THRESHOLD_MIN) {
      detected.push({
        code: "DRIVER_STALE_GPS",
        entityType: "driver",
        entityId: driver.id,
        severity: "warning",
        title: `Stale GPS: ${driver.firstName} ${driver.lastName}`,
        details: { staleMinutes: Math.round(staleMinutes), threshold: GPS_STALE_THRESHOLD_MIN, dispatchStatus: driver.dispatchStatus },
      });
    }
  }

  const todayTrips = await db.select().from(trips).where(
    and(
      eq(trips.companyId, companyId),
      eq(trips.scheduledDate, today),
      isNull(trips.deletedAt),
    )
  );

  const driverTripMap = new Map<number, typeof todayTrips>();
  for (const trip of todayTrips) {
    if (!trip.driverId) continue;
    const existing = driverTripMap.get(trip.driverId) || [];
    existing.push(trip);
    driverTripMap.set(trip.driverId, existing);
  }

  const thirtyDayStart = daysAgoStr(30);
  const historicTrips = await db.select({
    driverId: trips.driverId,
    total: sql<number>`count(*)::int`,
    late: sql<number>`count(*) FILTER (WHERE ${trips.status} = 'COMPLETED' AND ${trips.pickedUpAt} IS NOT NULL)::int`,
  }).from(trips).where(
    and(
      eq(trips.companyId, companyId),
      sql`${trips.scheduledDate} >= ${thirtyDayStart}`,
      sql`${trips.scheduledDate} < ${today}`,
      isNull(trips.deletedAt),
      sql`${trips.driverId} IS NOT NULL`,
    )
  ).groupBy(trips.driverId);

  const historicMap = new Map(historicTrips.map(h => [h.driverId, h]));

  for (const [driverId, dTrips] of driverTripMap.entries()) {
    if (dTrips.length < 3) continue;
    const lateToday = dTrips.filter(t => {
      if (t.status !== "COMPLETED" || !t.pickedUpAt) return false;
      const scheduledMins = timeToMinutes(t.pickupTime || t.scheduledTime);
      if (scheduledMins == null) return false;
      const actualTime = new Date(t.pickedUpAt);
      const actualMins = actualTime.getHours() * 60 + actualTime.getMinutes();
      return actualMins > scheduledMins + PUNCTUALITY_GRACE_MIN;
    }).length;

    const lateRateToday = lateToday / dTrips.length;
    const historic = historicMap.get(driverId);
    const avgLateRate = historic && historic.total > 0 ? 0.15 : 0;

    if (lateRateToday > avgLateRate + LATE_SPIKE_PCT && lateToday >= 2) {
      const driver = onlineDrivers.find(d => d.id === driverId) || await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1).then(r => r[0]);
      if (driver) {
        detected.push({
          code: "DRIVER_LATE_SPIKE",
          entityType: "driver",
          entityId: driverId,
          severity: "warning",
          title: `Late spike: ${driver.firstName} ${driver.lastName}`,
          details: { lateToday, totalToday: dTrips.length, lateRateToday: Math.round(lateRateToday * 100), avgLateRate: Math.round(avgLateRate * 100), threshold: LATE_SPIKE_PCT },
        });
      }
    }
  }

  const clinicTripCounts = new Map<number, { total: number; cancelled: number }>();
  for (const trip of todayTrips) {
    if (!trip.clinicId) continue;
    const existing = clinicTripCounts.get(trip.clinicId) || { total: 0, cancelled: 0 };
    existing.total++;
    if (trip.status === "CANCELLED") existing.cancelled++;
    clinicTripCounts.set(trip.clinicId, existing);
  }

  for (const [clinicId, counts] of clinicTripCounts.entries()) {
    if (counts.cancelled >= CANCEL_SPIKE_THRESHOLD && counts.total >= 3) {
      const clinic = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
      if (clinic.length > 0) {
        detected.push({
          code: "CLINIC_CANCEL_SPIKE",
          entityType: "clinic",
          entityId: clinicId,
          severity: "warning",
          title: `Cancel spike: ${clinic[0].name}`,
          details: { cancelledToday: counts.cancelled, totalToday: counts.total, threshold: CANCEL_SPIKE_THRESHOLD },
        });
      }
    }
  }

  const reqMetrics = getRequestMetricsSummary();
  if (reqMetrics.p95_latency_ms > 2000 || reqMetrics.errors_5xx_5min > 5) {
    detected.push({
      code: "ETA_DEGRADE",
      entityType: "system",
      entityId: null,
      severity: reqMetrics.errors_5xx_5min > 10 ? "critical" : "warning",
      title: "API/ETA performance degradation",
      details: { p95Ms: reqMetrics.p95_latency_ms, errors5xx: reqMetrics.errors_5xx_5min, errorRate: reqMetrics.error_rate_pct },
    });
  }

  try {
    const settings = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
    if (settings.length > 0) {
      const limits = settings[0];
      const driverCount = await db.select({ count: sql<number>`count(*)::int` }).from(drivers).where(
        and(eq(drivers.companyId, companyId), eq(drivers.active, true), isNull(drivers.deletedAt))
      );
      const activeStatuses = ["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"] as const;
      const tripCount = await db.select({ count: sql<number>`count(*)::int` }).from(trips).where(
        and(eq(trips.companyId, companyId), inArray(trips.status, [...activeStatuses] as any), isNull(trips.deletedAt))
      );

      const dc = driverCount[0]?.count || 0;
      const tc = tripCount[0]?.count || 0;

      if (dc >= limits.maxDrivers * QUOTA_WARN_PCT) {
        detected.push({
          code: "QUOTA_NEAR_LIMIT",
          entityType: "system",
          entityId: null,
          severity: dc >= limits.maxDrivers ? "critical" : "warning",
          title: `Driver quota: ${dc}/${limits.maxDrivers}`,
          details: { current: dc, max: limits.maxDrivers, pct: Math.round((dc / limits.maxDrivers) * 100), resource: "drivers" },
        });
      }
      if (tc >= limits.maxActiveTrips * QUOTA_WARN_PCT) {
        detected.push({
          code: "QUOTA_NEAR_LIMIT",
          entityType: "system",
          entityId: null,
          severity: tc >= limits.maxActiveTrips ? "critical" : "warning",
          title: `Trip quota: ${tc}/${limits.maxActiveTrips}`,
          details: { current: tc, max: limits.maxActiveTrips, pct: Math.round((tc / limits.maxActiveTrips) * 100), resource: "trips" },
        });
      }
    }
  } catch {}

  const detectedCodes = new Set(detected.map(d => `${d.code}:${d.entityType}:${d.entityId ?? "null"}`));

  for (const d of detected) {
    await upsertAnomaly(companyId, d.code, d.entityType, d.entityId, d.severity, d.title, d.details);
  }

  const activeAnomalies = await db.select().from(opsAnomalies).where(
    and(eq(opsAnomalies.companyId, companyId), eq(opsAnomalies.isActive, true))
  );

  let resolved = 0;
  for (const a of activeAnomalies) {
    const key = `${a.code}:${a.entityType}:${a.entityId ?? "null"}`;
    if (!detectedCodes.has(key)) {
      const missKey = `anomaly_miss:${companyId}:${a.id}`;
      const misses = ((await getJson<number>(missKey)) || 0) + 1;
      await setJson(missKey, misses, 600);
      if (misses >= AUTO_RESOLVE_MISSES) {
        await db.update(opsAnomalies).set({ isActive: false }).where(eq(opsAnomalies.id, a.id));
        resolved++;
      }
    }
  }

  return { detected: detected.length, resolved };
}

async function upsertAnomaly(companyId: number, code: string, entityType: string, entityId: number | null, severity: string, title: string, details: Record<string, unknown>) {
  const now = new Date();
  const conditions = [
    eq(opsAnomalies.companyId, companyId),
    eq(opsAnomalies.code, code),
    eq(opsAnomalies.entityType, entityType),
    eq(opsAnomalies.isActive, true),
  ];

  if (entityId !== null) {
    conditions.push(eq(opsAnomalies.entityId, entityId));
  } else {
    conditions.push(sql`${opsAnomalies.entityId} IS NULL`);
  }

  const existing = await db.select().from(opsAnomalies).where(and(...conditions)).limit(1);

  if (existing.length > 0) {
    await db.update(opsAnomalies).set({
      lastSeenAt: now,
      severity,
      title,
      details,
    }).where(eq(opsAnomalies.id, existing[0].id));
  } else {
    await db.insert(opsAnomalies).values({
      companyId,
      entityType,
      entityId,
      severity,
      code,
      title,
      details,
      firstSeenAt: now,
      lastSeenAt: now,
      isActive: true,
    });
  }
}

export async function getScoresForCompany(companyId: number, window: "7d" | "30d") {
  const scores = await db.select({
    id: driverPerfScores.id,
    driverId: driverPerfScores.driverId,
    driverFirstName: drivers.firstName,
    driverLastName: drivers.lastName,
    window: driverPerfScores.window,
    score: driverPerfScores.score,
    components: driverPerfScores.components,
    computedAt: driverPerfScores.computedAt,
  }).from(driverPerfScores)
    .innerJoin(drivers, eq(driverPerfScores.driverId, drivers.id))
    .where(
      and(
        eq(driverPerfScores.companyId, companyId),
        eq(driverPerfScores.window, window),
      )
    );
  return scores;
}

export async function getAnomaliesForCompany(companyId: number, activeOnly: boolean = true) {
  const conditions = [eq(opsAnomalies.companyId, companyId)];
  if (activeOnly) conditions.push(eq(opsAnomalies.isActive, true));
  return db.select().from(opsAnomalies).where(and(...conditions));
}

export async function getAllCompanyIds(): Promise<number[]> {
  const rows = await db.select({ id: companies.id }).from(companies);
  return rows.map(r => r.id);
}
