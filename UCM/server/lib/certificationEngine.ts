import { db } from "../db";
import { trips, clinics, cities, clinicCertifications } from "@shared/schema";
import { eq, and, gte, lte, isNull, sql, count } from "drizzle-orm";

const GRACE_MINUTES = 10;

interface CertInput {
  quarterKey: string;
  periodStart: string;
  periodEnd: string;
  computedBy: number;
}

interface CertResult {
  clinicId: number;
  clinicName: string;
  certLevel: string;
  score: number;
  breakdown: {
    tri: number;
    auditReadiness: number;
    completionRate: number;
    onTimeRate: number;
  };
}

function determineCertLevel(score: number): string {
  if (score >= 90) return "PLATINUM";
  if (score >= 75) return "GOLD";
  if (score >= 55) return "SILVER";
  return "AT_RISK";
}

export async function computeCertifications(input: CertInput): Promise<CertResult[]> {
  const allClinics = await db
    .select({ id: clinics.id, name: clinics.name })
    .from(clinics)
    .where(and(eq(clinics.active, true), isNull(clinics.deletedAt)));

  const results: CertResult[] = [];

  for (const clinic of allClinics) {
    const clinicTrips = await db
      .select({
        id: trips.id,
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

    let completed = 0;
    let noShow = 0;
    let onTime = 0;
    let late = 0;
    let evidenceComplete = 0;

    for (const t of clinicTrips) {
      if (t.status === "NO_SHOW" || t.billingOutcome === "no_show") {
        noShow++;
        continue;
      }
      if (t.status === "COMPLETED") {
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

        let hasEvidence = true;
        if (!t.arrivedPickupAt) hasEvidence = false;
        if (!t.completedAt) hasEvidence = false;
        if (hasEvidence) evidenceComplete++;
      }
    }

    const total = completed + noShow;
    if (total === 0) continue;

    const triScore = completed > 0
      ? Math.max(0, Math.min(100, 100 * (onTime / completed) - 0.5 * 100 * (late / completed) - 1.0 * 100 * (noShow / total)))
      : 0;

    const completionRate = (completed / total) * 100;
    const onTimeRate = completed > 0 ? (onTime / completed) * 100 : 0;
    const auditReadiness = completed > 0 ? (evidenceComplete / completed) * 100 : 0;

    const score = triScore * 0.4 + completionRate * 0.2 + onTimeRate * 0.2 + auditReadiness * 0.2;

    results.push({
      clinicId: clinic.id,
      clinicName: clinic.name,
      certLevel: determineCertLevel(score),
      score: Math.round(score * 10) / 10,
      breakdown: {
        tri: Math.round(triScore * 10) / 10,
        auditReadiness: Math.round(auditReadiness * 10) / 10,
        completionRate: Math.round(completionRate * 10) / 10,
        onTimeRate: Math.round(onTimeRate * 10) / 10,
      },
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

export async function saveCertifications(input: CertInput, results: CertResult[]) {
  for (const r of results) {
    await db
      .insert(clinicCertifications)
      .values({
        clinicId: r.clinicId,
        quarterKey: input.quarterKey,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        certLevel: r.certLevel,
        score: String(r.score),
        breakdownJson: r.breakdown,
        computedBy: input.computedBy,
      })
      .onConflictDoUpdate({
        target: [clinicCertifications.clinicId, clinicCertifications.quarterKey],
        set: {
          certLevel: r.certLevel,
          score: String(r.score),
          breakdownJson: r.breakdown,
          computedAt: new Date(),
          computedBy: input.computedBy,
        },
      });
  }
}

export function getQuarterDates(quarterKey: string): { periodStart: string; periodEnd: string } {
  const [year, q] = quarterKey.split("-Q");
  const qNum = parseInt(q);
  const startMonth = (qNum - 1) * 3;
  const periodStart = `${year}-${String(startMonth + 1).padStart(2, "0")}-01`;
  const endMonth = startMonth + 3;
  const endYear = endMonth > 12 ? parseInt(year) + 1 : parseInt(year);
  const endM = endMonth > 12 ? endMonth - 12 : endMonth;
  const periodEnd = `${endYear}-${String(endM).padStart(2, "0")}-01`;
  const lastDay = new Date(endYear, endM, 0).getDate();
  return { periodStart, periodEnd: `${year}-${String(startMonth + 3).padStart(2, "0")}-${lastDay}` };
}

export function getCurrentQuarterKey(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}
