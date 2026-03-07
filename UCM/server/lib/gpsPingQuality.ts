import { db } from "../db";
import { tripLocationPoints, tripRouteSummary } from "@shared/schema";
import { eq, asc, sql } from "drizzle-orm";

const ACCURACY_THRESHOLD_M = 50;
const STALE_THRESHOLD_S = 60;

export interface PingQualityResult {
  score: number;
  totalPings: number;
  avgIntervalSeconds: number | null;
  accuratePingPercent: number;
  stalePeriods: number;
  maxGapSeconds: number;
  grade: "GREAT" | "OK" | "POOR" | "NONE";
}

export async function computeTripPingQuality(tripId: number): Promise<PingQualityResult> {
  const points = await db.select({
    ts: tripLocationPoints.ts,
    accuracy: tripLocationPoints.accuracyM,
  }).from(tripLocationPoints)
    .where(eq(tripLocationPoints.tripId, tripId))
    .orderBy(asc(tripLocationPoints.ts))
    .limit(5000);

  if (points.length === 0) {
    return { score: 0, totalPings: 0, avgIntervalSeconds: null, accuratePingPercent: 0, stalePeriods: 0, maxGapSeconds: 0, grade: "NONE" };
  }

  let accurateCount = 0;
  let intervalSum = 0;
  let intervalCount = 0;
  let stalePeriods = 0;
  let maxGap = 0;

  for (let i = 0; i < points.length; i++) {
    const acc = points[i].accuracy;
    if (acc != null && acc <= ACCURACY_THRESHOLD_M) {
      accurateCount++;
    }

    if (i > 0) {
      const prevTs = new Date(points[i - 1].ts).getTime();
      const currTs = new Date(points[i].ts).getTime();
      const gapSeconds = (currTs - prevTs) / 1000;
      intervalSum += gapSeconds;
      intervalCount++;
      if (gapSeconds > STALE_THRESHOLD_S) stalePeriods++;
      if (gapSeconds > maxGap) maxGap = gapSeconds;
    }
  }

  const totalPings = points.length;
  const avgIntervalSeconds = intervalCount > 0 ? Math.round(intervalSum / intervalCount) : null;
  const accuratePingPercent = Math.round((accurateCount / totalPings) * 100);

  let score = 0;

  const pingDensityScore = Math.min(totalPings / 20, 1) * 30;
  score += pingDensityScore;

  if (avgIntervalSeconds !== null) {
    const intervalScore = avgIntervalSeconds <= 10 ? 25 : avgIntervalSeconds <= 20 ? 20 : avgIntervalSeconds <= 30 ? 15 : avgIntervalSeconds <= 60 ? 8 : 3;
    score += intervalScore;
  }

  const accuracyScore = (accuratePingPercent / 100) * 25;
  score += accuracyScore;

  const staleDeduction = Math.min(stalePeriods * 5, 20);
  score += (20 - staleDeduction);

  score = Math.round(Math.max(0, Math.min(100, score)));

  let grade: PingQualityResult["grade"];
  if (score >= 70) grade = "GREAT";
  else if (score >= 40) grade = "OK";
  else grade = "POOR";

  return {
    score,
    totalPings,
    avgIntervalSeconds,
    accuratePingPercent,
    stalePeriods,
    maxGapSeconds: Math.round(maxGap),
    grade,
  };
}

export async function saveTripPingQuality(tripId: number): Promise<PingQualityResult> {
  const quality = await computeTripPingQuality(tripId);

  try {
    await db.insert(tripRouteSummary).values({
      tripId,
      gpsQualityScore: String(quality.score),
      pointsTotal: quality.totalPings,
      computedAt: new Date(),
    }).onConflictDoUpdate({
      target: tripRouteSummary.tripId,
      set: {
        gpsQualityScore: String(quality.score),
        pointsTotal: quality.totalPings,
        computedAt: new Date(),
      },
    });
  } catch (err: any) {
    console.warn(`[GPS-QUALITY] Failed to save for trip ${tripId}: ${err.message}`);
  }

  return quality;
}

export const RECOMMENDED_PING_INTERVALS = {
  IN_TRIP: { minSeconds: 5, maxSeconds: 10, description: "While driver has an active trip" },
  IDLE_ONLINE: { minSeconds: 25, maxSeconds: 30, description: "Driver online but no active trip" },
  OFFLINE: { minSeconds: 0, maxSeconds: 0, description: "No pings needed when offline" },
};
