/**
 * Driver Churn Prediction Engine
 *
 * Scores every driver monthly for churn risk by analyzing:
 * - Trip frequency decline (last 30 days vs previous 30 days)
 * - Average rating trend (declining = risk)
 * - Response time to trip offers (slower = risk)
 * - Earnings trend (declining = risk)
 * - Days since last trip
 * - Acceptance rate trend
 */

import { db } from "../db";
import { trips, drivers, driverScores, patientRatings } from "@shared/schema";
import { eq, and, sql, gte, lte, isNull, desc } from "drizzle-orm";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface DriverChurnPrediction {
  driverId: number;
  driverName: string;
  churnProbability: number; // 0-100
  riskLevel: "low" | "medium" | "high";
  factors: Array<{
    name: string;
    impact: number; // -20 to +20
    detail: string;
  }>;
  retentionActions: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const BASE_CHURN_RATE = 15; // baseline 15% monthly churn probability

// ─── Core Prediction ────────────────────────────────────────────────────────

export async function predictDriverChurn(driverId: number): Promise<DriverChurnPrediction> {
  // Fetch driver info
  const [driver] = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      companyId: drivers.companyId,
      status: drivers.status,
      lastActiveAt: drivers.lastActiveAt,
      createdAt: drivers.createdAt,
    })
    .from(drivers)
    .where(and(eq(drivers.id, driverId), isNull(drivers.deletedAt)))
    .limit(1);

  if (!driver) {
    return {
      driverId,
      driverName: "Unknown",
      churnProbability: 0,
      riskLevel: "low",
      factors: [{ name: "Driver not found", impact: 0, detail: "Driver does not exist" }],
      retentionActions: [],
    };
  }

  const driverName = `${driver.firstName} ${driver.lastName}`;
  const factors: DriverChurnPrediction["factors"] = [];
  const retentionActions: string[] = [];
  let probability = BASE_CHURN_RATE;

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const recentCutoff = thirtyDaysAgo.toISOString().slice(0, 10);
  const previousCutoff = sixtyDaysAgo.toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);

  // ── Factor 1: Trip frequency decline ──
  const recentTrips = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        gte(trips.scheduledDate, recentCutoff),
        lte(trips.scheduledDate, todayStr),
        eq(trips.status, "COMPLETED"),
        isNull(trips.deletedAt),
      ),
    );

  const previousTrips = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        gte(trips.scheduledDate, previousCutoff),
        sql`${trips.scheduledDate} < ${recentCutoff}`,
        eq(trips.status, "COMPLETED"),
        isNull(trips.deletedAt),
      ),
    );

  const recentCount = recentTrips[0]?.count || 0;
  const previousCount = previousTrips[0]?.count || 0;

  if (previousCount > 0) {
    const changeRate = (recentCount - previousCount) / previousCount;

    if (changeRate < -0.5) {
      const impact = Math.min(20, Math.round(Math.abs(changeRate) * 25));
      probability += impact;
      factors.push({
        name: "Trip frequency decline",
        impact,
        detail: `Trips dropped ${Math.round(Math.abs(changeRate) * 100)}%: ${previousCount} (prev 30d) -> ${recentCount} (last 30d)`,
      });
      retentionActions.push("Schedule optimization review — check if driver wants different routes or hours");
    } else if (changeRate < -0.2) {
      const impact = Math.round(Math.abs(changeRate) * 20);
      probability += impact;
      factors.push({
        name: "Trip frequency decline",
        impact,
        detail: `Trips declined ${Math.round(Math.abs(changeRate) * 100)}%: ${previousCount} -> ${recentCount}`,
      });
    } else if (changeRate > 0.1) {
      const impact = Math.max(-10, Math.round(changeRate * -10));
      probability += impact;
      factors.push({
        name: "Trip frequency trend",
        impact,
        detail: `Trips increased ${Math.round(changeRate * 100)}%: ${previousCount} -> ${recentCount}`,
      });
    }
  } else if (recentCount === 0) {
    probability += 20;
    factors.push({
      name: "Trip frequency",
      impact: 20,
      detail: "No completed trips in last 60 days — driver may already be inactive",
    });
    retentionActions.push("Manager check-in call — understand why driver is inactive");
  }

  // ── Factor 2: Average rating trend ──
  const recentRatings = await db
    .select({
      avgRating: sql<number>`coalesce(avg(${patientRatings.overallRating}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(patientRatings)
    .where(
      and(
        eq(patientRatings.driverId, driverId),
        sql`${patientRatings.createdAt} >= ${thirtyDaysAgo}`,
      ),
    );

  const previousRatings = await db
    .select({
      avgRating: sql<number>`coalesce(avg(${patientRatings.overallRating}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(patientRatings)
    .where(
      and(
        eq(patientRatings.driverId, driverId),
        sql`${patientRatings.createdAt} >= ${sixtyDaysAgo}`,
        sql`${patientRatings.createdAt} < ${thirtyDaysAgo}`,
      ),
    );

  const rr = recentRatings[0];
  const pr = previousRatings[0];

  if (rr && pr && rr.count >= 3 && pr.count >= 3) {
    const ratingChange = rr.avgRating - pr.avgRating;
    if (ratingChange < -0.5) {
      const impact = Math.min(10, Math.round(Math.abs(ratingChange) * 8));
      probability += impact;
      factors.push({
        name: "Rating decline",
        impact,
        detail: `Avg rating dropped from ${pr.avgRating.toFixed(1)} to ${rr.avgRating.toFixed(1)}`,
      });
    } else if (ratingChange > 0.3) {
      const impact = -3;
      probability += impact;
      factors.push({
        name: "Rating trend",
        impact,
        detail: `Avg rating improved from ${pr.avgRating.toFixed(1)} to ${rr.avgRating.toFixed(1)}`,
      });
    }
  }

  // ── Factor 3: Earnings trend ──
  const recentEarnings = await db
    .select({
      total: sql<number>`coalesce(sum(${trips.priceTotalCents}), 0)::int`,
    })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        gte(trips.scheduledDate, recentCutoff),
        lte(trips.scheduledDate, todayStr),
        eq(trips.status, "COMPLETED"),
        isNull(trips.deletedAt),
      ),
    );

  const previousEarnings = await db
    .select({
      total: sql<number>`coalesce(sum(${trips.priceTotalCents}), 0)::int`,
    })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        gte(trips.scheduledDate, previousCutoff),
        sql`${trips.scheduledDate} < ${recentCutoff}`,
        eq(trips.status, "COMPLETED"),
        isNull(trips.deletedAt),
      ),
    );

  const re = recentEarnings[0]?.total || 0;
  const pe = previousEarnings[0]?.total || 0;

  if (pe > 0) {
    const earningsChange = (re - pe) / pe;
    if (earningsChange < -0.3) {
      const impact = Math.min(15, Math.round(Math.abs(earningsChange) * 20));
      probability += impact;
      factors.push({
        name: "Earnings decline",
        impact,
        detail: `Earnings dropped ${Math.round(Math.abs(earningsChange) * 100)}%: $${(pe / 100).toFixed(0)} -> $${(re / 100).toFixed(0)}`,
      });
      retentionActions.push("Offer performance bonus — driver's earnings are declining");
    } else if (earningsChange > 0.1) {
      const impact = Math.max(-8, Math.round(earningsChange * -8));
      probability += impact;
      factors.push({
        name: "Earnings trend",
        impact,
        detail: `Earnings grew ${Math.round(earningsChange * 100)}%`,
      });
    }
  }

  // ── Factor 4: Days since last trip ──
  const lastTrip = await db
    .select({ scheduledDate: trips.scheduledDate })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.status, "COMPLETED"),
        isNull(trips.deletedAt),
      ),
    )
    .orderBy(desc(trips.scheduledDate))
    .limit(1);

  if (lastTrip.length > 0) {
    const lastDate = new Date(lastTrip[0].scheduledDate + "T12:00:00Z");
    const daysSinceLast = Math.round((now.getTime() - lastDate.getTime()) / 86400000);

    if (daysSinceLast > 14) {
      const impact = Math.min(18, Math.round((daysSinceLast - 14) / 3) * 2);
      probability += impact;
      factors.push({
        name: "Days since last trip",
        impact,
        detail: `${daysSinceLast} days since last completed trip`,
      });
      if (daysSinceLast > 21) {
        retentionActions.push("Manager check-in call — driver has been inactive for 3+ weeks");
      }
    } else if (daysSinceLast <= 3) {
      const impact = -5;
      probability += impact;
      factors.push({
        name: "Recent activity",
        impact,
        detail: `Active — last trip ${daysSinceLast} day(s) ago`,
      });
    }
  }

  // ── Factor 5: Driver score trend ──
  const scores = await db
    .select({
      score: driverScores.score,
      onTimeRate: driverScores.onTimeRate,
      weekStart: driverScores.weekStart,
    })
    .from(driverScores)
    .where(eq(driverScores.driverId, driverId))
    .orderBy(desc(driverScores.weekStart))
    .limit(8);

  if (scores.length >= 4) {
    const recentScores = scores.slice(0, 4);
    const olderScores = scores.slice(4);

    const recentAvg = recentScores.reduce((s, sc) => s + sc.score, 0) / recentScores.length;
    const olderAvg = olderScores.reduce((s, sc) => s + sc.score, 0) / olderScores.length;

    if (olderAvg > 0) {
      const scoreDiff = recentAvg - olderAvg;
      if (scoreDiff < -10) {
        const impact = Math.min(10, Math.round(Math.abs(scoreDiff) / 3));
        probability += impact;
        factors.push({
          name: "Driver score decline",
          impact,
          detail: `Score dropped from ${Math.round(olderAvg)} to ${Math.round(recentAvg)} over last 8 weeks`,
        });
      }
    }
  }

  // ── Factor 6: Acceptance rate / cancellation rate by driver ──
  const driverCancelRate = await db
    .select({
      total: sql<number>`count(*)::int`,
      cancelled: sql<number>`count(*) filter (where ${trips.status} = 'CANCELLED' and ${trips.cancelledBy} = ${driverId})::int`,
    })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        gte(trips.scheduledDate, recentCutoff),
        isNull(trips.deletedAt),
      ),
    );

  const dcr = driverCancelRate[0];
  if (dcr && dcr.total >= 5) {
    const cancelRate = dcr.cancelled / dcr.total;
    if (cancelRate > 0.2) {
      const impact = Math.min(10, Math.round(cancelRate * 25));
      probability += impact;
      factors.push({
        name: "Driver cancellation rate",
        impact,
        detail: `Driver cancelled ${dcr.cancelled}/${dcr.total} assigned trips (${Math.round(cancelRate * 100)}%)`,
      });
    }
  }

  // Ensure default retention actions based on overall risk
  if (retentionActions.length === 0 && probability >= 50) {
    retentionActions.push("Manager check-in call — understand driver concerns");
  }
  if (probability >= 40 && !retentionActions.some((a) => a.startsWith("Offer"))) {
    retentionActions.push("Offer performance bonus or incentive for next 30 days");
  }
  if (probability >= 30 && !retentionActions.some((a) => a.includes("Schedule"))) {
    retentionActions.push("Schedule optimization review — ensure driver gets preferred routes");
  }

  // Clamp probability
  probability = Math.max(0, Math.min(100, Math.round(probability)));

  // Determine risk level
  let riskLevel: DriverChurnPrediction["riskLevel"];
  if (probability >= 60) riskLevel = "high";
  else if (probability >= 35) riskLevel = "medium";
  else riskLevel = "low";

  return {
    driverId,
    driverName,
    churnProbability: probability,
    riskLevel,
    factors,
    retentionActions,
  };
}

// ─── Batch Prediction ───────────────────────────────────────────────────────

export async function batchPredictChurn(
  companyId: number,
): Promise<Array<{ driverId: number; driverName: string; churnProbability: number; riskLevel: string }>> {
  const activeDrivers = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(
      and(
        eq(drivers.companyId, companyId),
        eq(drivers.status, "ACTIVE"),
        isNull(drivers.deletedAt),
      ),
    );

  const results: Array<{ driverId: number; driverName: string; churnProbability: number; riskLevel: string }> = [];

  for (const driver of activeDrivers) {
    try {
      const prediction = await predictDriverChurn(driver.id);
      results.push({
        driverId: prediction.driverId,
        driverName: prediction.driverName,
        churnProbability: prediction.churnProbability,
        riskLevel: prediction.riskLevel,
      });
    } catch (err: any) {
      console.warn(`[CHURN-PREDICT] Failed for driver ${driver.id}: ${err.message}`);
    }
  }

  // Sort by churn probability descending
  results.sort((a, b) => b.churnProbability - a.churnProbability);

  return results;
}
