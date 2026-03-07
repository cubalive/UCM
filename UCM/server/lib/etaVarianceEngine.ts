import { db } from "../db";
import { trips, automationEvents } from "@shared/schema";
import { eq, and, sql, ne, isNull, inArray } from "drizzle-orm";

const THROTTLE_MS = 60_000;
const throttleMap = new Map<number, number>();

const WARN_THRESHOLD = 300;
const CLINIC_THRESHOLD = 600;
const DISPATCH_THRESHOLD = 900;

const MUTE_MAP = new Map<number, number>();
const MUTE_DURATION_MS = 30 * 60 * 1000;

function getEscalationLevel(varianceSeconds: number): string {
  if (varianceSeconds >= DISPATCH_THRESHOLD) return "DISPATCH";
  if (varianceSeconds >= CLINIC_THRESHOLD) return "CLINIC";
  if (varianceSeconds >= WARN_THRESHOLD) return "WARN";
  return "NONE";
}

export async function checkEtaVariance(tripId: number, currentEtaSeconds: number): Promise<{
  varianceSeconds: number;
  escalationLevel: string;
  escalated: boolean;
} | null> {
  const now = Date.now();
  const lastCheck = throttleMap.get(tripId);
  if (lastCheck && now - lastCheck < THROTTLE_MS) return null;
  throttleMap.set(tripId, now);

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) return null;

  if (!trip.originalEtaSeconds) {
    await db.update(trips).set({
      originalEtaSeconds: currentEtaSeconds,
      etaLastCheckedAt: new Date(),
    } as any).where(eq(trips.id, tripId));
    return { varianceSeconds: 0, escalationLevel: "NONE", escalated: false };
  }

  const varianceSeconds = Math.max(0, currentEtaSeconds - trip.originalEtaSeconds);
  const newLevel = getEscalationLevel(varianceSeconds);
  const currentLevel = trip.etaEscalationLevel || "NONE";

  const muteExpiry = MUTE_MAP.get(tripId);
  if (muteExpiry && now < muteExpiry) {
    await db.update(trips).set({
      etaVarianceSeconds: varianceSeconds,
      etaLastCheckedAt: new Date(),
    } as any).where(eq(trips.id, tripId));
    return { varianceSeconds, escalationLevel: currentLevel, escalated: false };
  }

  const levels = ["NONE", "WARN", "CLINIC", "DISPATCH"];
  const newLevelIdx = levels.indexOf(newLevel);
  const currentLevelIdx = levels.indexOf(currentLevel);
  const shouldEscalate = newLevelIdx > currentLevelIdx;

  await db.update(trips).set({
    etaVarianceSeconds: varianceSeconds,
    etaLastCheckedAt: new Date(),
    ...(shouldEscalate ? {
      etaEscalationLevel: newLevel,
      etaEscalationLastAt: new Date(),
    } : {}),
  } as any).where(eq(trips.id, tripId));

  if (shouldEscalate) {
    await db.insert(automationEvents).values({
      eventType: "ETA_ESCALATION",
      tripId,
      companyId: trip.companyId,
      driverId: trip.driverId,
      payload: {
        previousLevel: currentLevel,
        newLevel,
        varianceSeconds,
        originalEtaSeconds: trip.originalEtaSeconds,
        currentEtaSeconds,
        tripPublicId: trip.publicId,
      },
    });

    if (newLevel === "WARN") {
      await db.insert(automationEvents).values({
        eventType: "ETA_VARIANCE_WARNING",
        tripId,
        companyId: trip.companyId,
        driverId: trip.driverId,
        payload: { varianceSeconds, threshold: WARN_THRESHOLD },
      });
    }
  }

  return { varianceSeconds, escalationLevel: shouldEscalate ? newLevel : currentLevel, escalated: shouldEscalate };
}

export async function muteEtaAlert(tripId: number, durationMs: number = MUTE_DURATION_MS, actorUserId?: number) {
  MUTE_MAP.set(tripId, Date.now() + durationMs);

  await db.insert(automationEvents).values({
    eventType: "ETA_ALERT_MUTED",
    tripId,
    actorUserId: actorUserId || null,
    payload: { durationMs, mutedUntil: new Date(Date.now() + durationMs).toISOString() },
  });

  return { muted: true, expiresAt: new Date(Date.now() + durationMs) };
}

export async function markEtaResolved(tripId: number, actorUserId?: number) {
  await db.update(trips).set({
    etaEscalationLevel: "NONE",
    etaVarianceSeconds: 0,
  } as any).where(eq(trips.id, tripId));

  await db.insert(automationEvents).values({
    eventType: "ETA_ALERT_RESOLVED",
    tripId,
    actorUserId: actorUserId || null,
    payload: { resolvedAt: new Date().toISOString() },
  });
}

export async function getEscalatedTrips(filters: {
  level?: string;
  companyId?: number;
  cityId?: number;
  limit?: number;
}) {
  const limit = Math.min(filters.limit || 50, 200);

  const conditions = [ne(trips.etaEscalationLevel, "NONE"), isNull(trips.deletedAt)];
  if (filters.level) conditions.push(eq(trips.etaEscalationLevel, filters.level));
  if (filters.companyId) conditions.push(eq(trips.companyId, filters.companyId));
  if (filters.cityId) conditions.push(eq(trips.cityId, filters.cityId));

  return db.select({
    id: trips.id,
    publicId: trips.publicId,
    companyId: trips.companyId,
    cityId: trips.cityId,
    driverId: trips.driverId,
    status: trips.status,
    pickupTime: trips.pickupTime,
    scheduledDate: trips.scheduledDate,
    estimatedArrivalTime: trips.estimatedArrivalTime,
    etaEscalationLevel: trips.etaEscalationLevel,
    etaVarianceSeconds: trips.etaVarianceSeconds,
    originalEtaSeconds: trips.originalEtaSeconds,
    etaLastCheckedAt: trips.etaLastCheckedAt,
    etaEscalationLastAt: trips.etaEscalationLastAt,
    pickupAddress: trips.pickupAddress,
    dropoffAddress: trips.dropoffAddress,
  }).from(trips)
    .where(and(...conditions))
    .orderBy(sql`${trips.etaVarianceSeconds} DESC NULLS LAST`)
    .limit(limit);
}
