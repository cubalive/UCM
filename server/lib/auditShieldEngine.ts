import { db } from "../db";
import { trips, clinics, cities, auditReadinessSnapshots } from "@shared/schema";
import { eq, and, gte, lte, isNull } from "drizzle-orm";

interface AuditInput {
  periodStart: string;
  periodEnd: string;
  scope?: "general" | "state" | "city" | "clinic";
  state?: string;
  city?: string;
  clinicId?: number;
}

interface MissingCategory {
  category: string;
  count: number;
  description: string;
}

interface AuditResult {
  clinicId: number;
  clinicName: string;
  score: number;
  totalTrips: number;
  completeTrips: number;
  missingBreakdown: MissingCategory[];
}

export async function computeAuditReadiness(input: AuditInput): Promise<AuditResult[]> {
  let clinicList: { id: number; name: string; cityId: number; addressState: string | null }[];

  if (input.clinicId) {
    clinicList = await db
      .select({ id: clinics.id, name: clinics.name, cityId: clinics.cityId, addressState: clinics.addressState })
      .from(clinics)
      .where(eq(clinics.id, input.clinicId));
  } else {
    clinicList = await db
      .select({ id: clinics.id, name: clinics.name, cityId: clinics.cityId, addressState: clinics.addressState })
      .from(clinics)
      .where(and(eq(clinics.active, true), isNull(clinics.deletedAt)));
  }

  if (input.scope === "state" && input.state) {
    const stateCities = await db.select({ id: cities.id }).from(cities).where(eq(cities.state, input.state));
    const cityIds = new Set(stateCities.map((c) => c.id));
    clinicList = clinicList.filter((c) => cityIds.has(c.cityId) || c.addressState === input.state);
  } else if (input.scope === "city" && input.city) {
    const cityId = parseInt(input.city);
    if (!isNaN(cityId)) clinicList = clinicList.filter((c) => c.cityId === cityId);
  }

  const results: AuditResult[] = [];

  for (const clinic of clinicList) {
    const completedTrips = await db
      .select({
        id: trips.id,
        status: trips.status,
        scheduledTime: trips.scheduledTime,
        scheduledDate: trips.scheduledDate,
        arrivedPickupAt: trips.arrivedPickupAt,
        pickedUpAt: trips.pickedUpAt,
        arrivedDropoffAt: trips.arrivedDropoffAt,
        completedAt: trips.completedAt,
        driverId: trips.driverId,
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

    if (completedTrips.length === 0) continue;

    const missing: Record<string, number> = {
      missing_scheduled_time: 0,
      missing_arrived_pickup: 0,
      missing_completed_at: 0,
      missing_driver_assignment: 0,
      missing_cancel_reason: 0,
      missing_proof_photo: 0,
    };

    let evidenceComplete = 0;

    for (const t of completedTrips) {
      let complete = true;

      if (!t.scheduledTime) { missing.missing_scheduled_time++; complete = false; }

      if (t.status === "COMPLETED") {
        if (!t.arrivedPickupAt) { missing.missing_arrived_pickup++; complete = false; }
        if (!t.completedAt) { missing.missing_completed_at++; complete = false; }
        if (!t.driverId) { missing.missing_driver_assignment++; complete = false; }
      } else if (t.status === "CANCELLED" || t.status === "NO_SHOW") {
        if (!t.cancelledReason && !t.billingOutcome) { missing.missing_cancel_reason++; complete = false; }
      }

      if (complete) evidenceComplete++;
    }

    const totalTrips = completedTrips.length;
    const score = totalTrips > 0 ? Math.round((evidenceComplete / totalTrips) * 100 * 10) / 10 : 0;

    const missingBreakdown: MissingCategory[] = [
      { category: "missing_scheduled_time", count: missing.missing_scheduled_time, description: "Missing scheduled time" },
      { category: "missing_arrived_pickup", count: missing.missing_arrived_pickup, description: "Missing pickup arrival timestamp" },
      { category: "missing_completed_at", count: missing.missing_completed_at, description: "Missing completion timestamp" },
      { category: "missing_driver_assignment", count: missing.missing_driver_assignment, description: "Missing driver assignment" },
      { category: "missing_cancel_reason", count: missing.missing_cancel_reason, description: "Missing cancel/no-show reason" },
      { category: "missing_proof_photo", count: missing.missing_proof_photo, description: "Missing proof photo" },
    ].filter((m) => m.count > 0);

    results.push({
      clinicId: clinic.id,
      clinicName: clinic.name,
      score,
      totalTrips,
      completeTrips: evidenceComplete,
      missingBreakdown,
    });
  }

  return results.sort((a, b) => a.score - b.score);
}

export async function saveAuditSnapshot(clinicId: number, snapshotDate: string, result: AuditResult) {
  await db
    .insert(auditReadinessSnapshots)
    .values({
      clinicId,
      snapshotDate,
      score: String(result.score),
      missingBreakdownJson: result.missingBreakdown,
      totalTrips: result.totalTrips,
      completeTrips: result.completeTrips,
    })
    .onConflictDoUpdate({
      target: [auditReadinessSnapshots.clinicId, auditReadinessSnapshots.snapshotDate],
      set: {
        score: String(result.score),
        missingBreakdownJson: result.missingBreakdown,
        totalTrips: result.totalTrips,
        completeTrips: result.completeTrips,
      },
    });
}
