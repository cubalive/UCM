import { db } from "../db";
import { trips, clinics, cities, quarterlyRankings, quarterlyRankingEntries } from "@shared/schema";
import { eq, and, gte, lte, isNull, sql } from "drizzle-orm";

const GRACE_MINUTES = 10;

interface RankingInput {
  quarterKey: string;
  periodStart: string;
  periodEnd: string;
  scope: "city" | "state" | "national";
  state?: string;
  city?: string;
  metricKey?: string;
}

interface RankEntry {
  clinicId: number;
  clinicName: string;
  rank: number;
  score: number;
  percentile: number;
  payload: {
    completed: number;
    onTime: number;
    late: number;
    noShow: number;
    triScore: number;
    ctsScore: number;
  };
}

export async function computeRankings(input: RankingInput): Promise<RankEntry[]> {
  const allClinics = await db
    .select({ id: clinics.id, name: clinics.name, cityId: clinics.cityId, addressState: clinics.addressState })
    .from(clinics)
    .where(and(eq(clinics.active, true), isNull(clinics.deletedAt)));

  let filteredClinics = allClinics;

  if (input.scope === "state" && input.state) {
    const stateCities = await db.select({ id: cities.id }).from(cities).where(eq(cities.state, input.state));
    const cityIds = new Set(stateCities.map((c) => c.id));
    filteredClinics = allClinics.filter((c) => cityIds.has(c.cityId) || c.addressState === input.state);
  } else if (input.scope === "city" && input.city) {
    const cityId = parseInt(input.city);
    if (!isNaN(cityId)) {
      filteredClinics = allClinics.filter((c) => c.cityId === cityId);
    }
  }

  const scores: { clinicId: number; clinicName: string; triScore: number; ctsScore: number; completed: number; onTime: number; late: number; noShow: number }[] = [];

  for (const clinic of filteredClinics) {
    const clinicTrips = await db
      .select({
        status: trips.status,
        scheduledTime: trips.scheduledTime,
        pickupTime: trips.pickupTime,
        arrivedPickupAt: trips.arrivedPickupAt,
        completedAt: trips.completedAt,
        billingOutcome: trips.billingOutcome,
        cancelledReason: trips.cancelledReason,
      })
      .from(trips)
      .where(
        and(
          eq(trips.clinicId, clinic.id),
          gte(trips.scheduledDate, input.periodStart),
          lte(trips.scheduledDate, input.periodEnd),
          isNull(trips.deletedAt),
        )
      );

    if (clinicTrips.length === 0) continue;

    let completed = 0, noShow = 0, onTime = 0, late = 0, evidenceComplete = 0;

    for (const t of clinicTrips) {
      if (t.status === "NO_SHOW" || t.billingOutcome === "no_show") { noShow++; continue; }
      if (t.status !== "COMPLETED") continue;
      completed++;

      if (t.arrivedPickupAt && (t.scheduledTime || t.pickupTime)) {
        const timeStr = t.scheduledTime || t.pickupTime || "00:00";
        const [h, m] = timeStr.split(":").map(Number);
        const scheduledMs = (h * 60 + m + GRACE_MINUTES) * 60000;
        const arrivedDate = new Date(t.arrivedPickupAt);
        const arrivedMs = (arrivedDate.getUTCHours() * 60 + arrivedDate.getUTCMinutes()) * 60000;
        if (arrivedMs <= scheduledMs) onTime++;
        else late++;
      } else {
        onTime++;
      }

      if (t.arrivedPickupAt && t.completedAt) evidenceComplete++;
    }

    const total = completed + noShow;
    if (total === 0) continue;

    const triScore = completed > 0
      ? Math.max(0, Math.min(100, 100 * (onTime / completed) - 0.5 * 100 * (late / completed) - 1.0 * 100 * (noShow / total)))
      : 0;

    const returnRate = completed / total;
    const proofRate = completed > 0 ? evidenceComplete / completed : 0;
    const ctsScore = triScore * 0.5 + returnRate * 100 * 0.25 + proofRate * 100 * 0.25;

    scores.push({
      clinicId: clinic.id,
      clinicName: clinic.name,
      triScore: Math.round(triScore * 10) / 10,
      ctsScore: Math.round(ctsScore * 10) / 10,
      completed, onTime, late, noShow,
    });
  }

  const metricKey = input.metricKey || "tri";
  scores.sort((a, b) => {
    const aScore = metricKey === "cts" ? b.ctsScore : b.triScore;
    const bScore = metricKey === "cts" ? a.ctsScore : a.triScore;
    return aScore - bScore;
  });

  const total = scores.length;
  return scores.map((s, i) => ({
    clinicId: s.clinicId,
    clinicName: s.clinicName,
    rank: i + 1,
    score: metricKey === "cts" ? s.ctsScore : s.triScore,
    percentile: total > 1 ? Math.round(((total - i - 1) / (total - 1)) * 100 * 10) / 10 : 100,
    payload: {
      completed: s.completed,
      onTime: s.onTime,
      late: s.late,
      noShow: s.noShow,
      triScore: s.triScore,
      ctsScore: s.ctsScore,
    },
  }));
}

export async function saveRankings(input: RankingInput, entries: RankEntry[]) {
  const [ranking] = await db
    .insert(quarterlyRankings)
    .values({
      quarterKey: input.quarterKey,
      scope: input.scope,
      state: input.state || null,
      city: input.city || null,
      metricKey: input.metricKey || "tri",
    })
    .onConflictDoUpdate({
      target: [quarterlyRankings.quarterKey, quarterlyRankings.scope, quarterlyRankings.state, quarterlyRankings.city, quarterlyRankings.metricKey],
      set: { computedAt: new Date() },
    })
    .returning();

  await db.delete(quarterlyRankingEntries).where(eq(quarterlyRankingEntries.rankingId, ranking.id));

  for (const entry of entries) {
    await db.insert(quarterlyRankingEntries).values({
      rankingId: ranking.id,
      clinicId: entry.clinicId,
      rank: entry.rank,
      score: String(entry.score),
      percentile: String(entry.percentile),
      payloadJson: entry.payload,
    });
  }

  return ranking;
}
