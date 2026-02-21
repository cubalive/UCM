import { db } from "../../db";
import { trips, driverEarningsAdjustments } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getCompanyPayRules } from "./payrollRulesService";

interface AdjustmentResult {
  type: "ON_TIME_BONUS" | "NO_SHOW_PENALTY";
  amountCents: number;
  idempotencyKey: string;
  metadata: Record<string, any>;
}

export async function computeTripModifiers(tripId: number): Promise<AdjustmentResult[]> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) return [];
  if (!trip.driverId || !trip.companyId) return [];

  const rules = await getCompanyPayRules(trip.companyId);
  if (!rules) return [];

  const results: AdjustmentResult[] = [];

  if (rules.onTimeBonusEnabled && rules.onTimeBonusCents && rules.onTimeBonusCents > 0) {
    if (rules.onTimeBonusMode === "PER_TRIP" && trip.status === "COMPLETED") {
      const isOnTime = checkOnTime(trip, rules);
      if (isOnTime) {
        results.push({
          type: "ON_TIME_BONUS",
          amountCents: rules.onTimeBonusCents,
          idempotencyKey: `ON_TIME_BONUS:${tripId}`,
          metadata: {
            reason: "On-time pickup bonus",
            tripId,
            thresholdMinutes: rules.onTimeThresholdMinutes || 5,
          },
        });
      }
    }
  }

  if (rules.noShowPenaltyEnabled && rules.noShowPenaltyCents && rules.noShowPenaltyCents > 0) {
    if (trip.status === "NO_SHOW") {
      results.push({
        type: "NO_SHOW_PENALTY",
        amountCents: -(rules.noShowPenaltyCents),
        idempotencyKey: `NO_SHOW_PENALTY:${tripId}`,
        metadata: {
          reason: "No-show penalty deduction",
          tripId,
        },
      });
    }
  }

  const inserted: AdjustmentResult[] = [];
  for (const adj of results) {
    try {
      const tripDate = trip.scheduledDate || new Date().toISOString().split("T")[0];
      const weekStart = getWeekStart(tripDate);

      await db.insert(driverEarningsAdjustments).values({
        companyId: trip.companyId,
        driverId: trip.driverId!,
        relatedTripId: tripId,
        periodDate: tripDate,
        weekStart,
        type: adj.type,
        amountCents: adj.amountCents,
        idempotencyKey: adj.idempotencyKey,
        metadata: adj.metadata,
      }).onConflictDoNothing();
      inserted.push(adj);
    } catch (err: any) {
      if (err.message?.includes("duplicate") || err.message?.includes("unique")) {
        continue;
      }
      console.error(`[MODIFIERS] Failed to insert adjustment ${adj.idempotencyKey}:`, err.message);
    }
  }

  return inserted;
}

function checkOnTime(
  trip: any,
  rules: { onTimeThresholdMinutes: number | null; onTimeRequiresConfirmedPickup: boolean }
): boolean {
  const threshold = (rules.onTimeThresholdMinutes || 5) * 60 * 1000;

  const actualPickupTime = trip.arrivedPickupAt || trip.pickedUpAt;
  if (!actualPickupTime) return false;

  if (!trip.scheduledDate || !trip.pickupTime) return false;

  try {
    const [hours, minutes] = trip.pickupTime.split(":").map(Number);
    const scheduled = new Date(trip.scheduledDate);
    scheduled.setHours(hours, minutes, 0, 0);

    const actual = new Date(actualPickupTime);
    const diff = actual.getTime() - scheduled.getTime();

    return diff <= threshold;
  } catch {
    return false;
  }
}

export function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split("T")[0];
}
