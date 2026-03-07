import { db } from "../../db";
import { trips, driverEarningsAdjustments, driverEarningsLedger, drivers } from "@shared/schema";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { getCompanyPayRules } from "./payrollRulesService";
import { getWeekStart } from "./modifiersEngine";

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface DailyMinTopup {
  driverId: number;
  amountCents: number;
  dailyEarningsCents: number;
  minimumCents: number;
}

export async function computeDailyMinimumTopups(
  companyId: number,
  dateStr: string
): Promise<DailyMinTopup[]> {
  const rules = await getCompanyPayRules(companyId);
  if (!rules || !rules.dailyMinEnabled || !rules.dailyMinCents || rules.dailyMinCents <= 0) {
    return [];
  }

  const date = new Date(dateStr);
  const dayName = DAY_NAMES[date.getDay()];
  if (rules.dailyMinAppliesDays && rules.dailyMinAppliesDays.length > 0) {
    if (!rules.dailyMinAppliesDays.includes(dayName)) {
      return [];
    }
  }

  const companyDrivers = await db.select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.companyId, companyId));

  const topups: DailyMinTopup[] = [];

  for (const driver of companyDrivers) {
    const dailyTrips = await db.select({
      totalPayout: sql<number>`COALESCE(SUM(amount_cents), 0)`.as("totalPayout"),
    })
      .from(driverEarningsLedger)
      .where(
        and(
          eq(driverEarningsLedger.companyId, companyId),
          eq(driverEarningsLedger.driverId, driver.id),
          sql`DATE(${driverEarningsLedger.earnedAt}) = ${dateStr}`
        )
      );

    const dailyAdjustments = await db.select({
      totalAdj: sql<number>`COALESCE(SUM(amount_cents), 0)`.as("totalAdj"),
    })
      .from(driverEarningsAdjustments)
      .where(
        and(
          eq(driverEarningsAdjustments.companyId, companyId),
          eq(driverEarningsAdjustments.driverId, driver.id),
          eq(driverEarningsAdjustments.periodDate, dateStr),
          sql`type != 'DAILY_MIN_TOPUP'`
        )
      );

    const earnedCents = Number(dailyTrips[0]?.totalPayout || 0);
    const adjCents = Number(dailyAdjustments[0]?.totalAdj || 0);
    const totalDailyEarnings = earnedCents + adjCents;

    if (totalDailyEarnings >= rules.dailyMinCents) continue;
    if (totalDailyEarnings === 0 && earnedCents === 0) continue;

    const topupAmount = rules.dailyMinCents - totalDailyEarnings;
    const idempotencyKey = `DAILY_MIN_TOPUP:${companyId}:${driver.id}:${dateStr}`;
    const weekStart = getWeekStart(dateStr);

    try {
      await db.insert(driverEarningsAdjustments).values({
        companyId,
        driverId: driver.id,
        periodDate: dateStr,
        weekStart,
        type: "DAILY_MIN_TOPUP",
        amountCents: topupAmount,
        idempotencyKey,
        metadata: {
          reason: "Daily minimum guarantee top-up",
          dailyEarningsCents: totalDailyEarnings,
          minimumCents: rules.dailyMinCents,
          topupCents: topupAmount,
          dayOfWeek: dayName,
        },
      }).onConflictDoNothing();

      topups.push({
        driverId: driver.id,
        amountCents: topupAmount,
        dailyEarningsCents: totalDailyEarnings,
        minimumCents: rules.dailyMinCents,
      });
    } catch (err: any) {
      if (!err.message?.includes("duplicate") && !err.message?.includes("unique")) {
        console.error(`[DAILY-MIN] Error inserting topup for driver ${driver.id}:`, err.message);
      }
    }
  }

  return topups;
}
