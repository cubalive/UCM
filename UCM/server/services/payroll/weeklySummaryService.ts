import { db } from "../../db";
import { driverEarningsLedger, driverEarningsAdjustments, trips } from "@shared/schema";
import { eq, and, sql, gte, lte } from "drizzle-orm";

interface WeeklyEarningsSummary {
  weekStart: string;
  weekEnd: string;
  baseEarningsCents: number;
  modifiersCents: number;
  totalCents: number;
  completedTrips: Array<{
    tripId: number;
    payoutCents: number;
    status: string;
    completedAt: string | null;
    publicId: string | null;
  }>;
  adjustments: Array<{
    id: number;
    type: string;
    amountCents: number;
    relatedTripId: number | null;
    periodDate: string | null;
    metadata: any;
    createdAt: string;
  }>;
  projectedOpenTripsCents: number;
}

export async function getWeeklyEarnings(
  driverId: number,
  companyId: number,
  weekStartDate: string
): Promise<WeeklyEarningsSummary> {
  const weekStart = weekStartDate;
  const weekEnd = getWeekEnd(weekStart);

  const ledgerEntries = await db.select({
    totalBase: sql<number>`COALESCE(SUM(amount_cents), 0)`.as("totalBase"),
  })
    .from(driverEarningsLedger)
    .where(
      and(
        eq(driverEarningsLedger.companyId, companyId),
        eq(driverEarningsLedger.driverId, driverId),
        gte(driverEarningsLedger.earnedAt, new Date(weekStart)),
        lte(driverEarningsLedger.earnedAt, new Date(weekEnd + "T23:59:59Z"))
      )
    );

  const baseEarningsCents = Number(ledgerEntries[0]?.totalBase || 0);

  const adjustmentRows = await db.select()
    .from(driverEarningsAdjustments)
    .where(
      and(
        eq(driverEarningsAdjustments.companyId, companyId),
        eq(driverEarningsAdjustments.driverId, driverId),
        eq(driverEarningsAdjustments.weekStart, weekStart)
      )
    );

  const modifiersCents = adjustmentRows.reduce((sum, a) => sum + a.amountCents, 0);

  const completedTripRows = await db.select({
    id: trips.id,
    publicId: trips.publicId,
    status: trips.status,
    completedAt: trips.completedAt,
    priceTotalCents: trips.priceTotalCents,
  })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.driverId, driverId),
        gte(trips.scheduledDate, weekStart),
        lte(trips.scheduledDate, weekEnd),
        sql`${trips.status} IN ('COMPLETED','NO_SHOW')`
      )
    );

  const completedTrips = completedTripRows.map(t => {
    const ledgerMatch = adjustmentRows.find(a => a.relatedTripId === t.id);
    return {
      tripId: t.id,
      payoutCents: t.priceTotalCents || 0,
      status: t.status,
      completedAt: t.completedAt?.toISOString() || null,
      publicId: t.publicId,
    };
  });

  const openTrips = await db.select({
    totalProjected: sql<number>`COALESCE(SUM(price_total_cents), 0)`.as("totalProjected"),
  })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.driverId, driverId),
        gte(trips.scheduledDate, weekStart),
        lte(trips.scheduledDate, weekEnd),
        sql`${trips.status} NOT IN ('COMPLETED','CANCELLED','NO_SHOW')`
      )
    );

  const projectedOpenTripsCents = Number(openTrips[0]?.totalProjected || 0);

  return {
    weekStart,
    weekEnd,
    baseEarningsCents,
    modifiersCents,
    totalCents: baseEarningsCents + modifiersCents,
    completedTrips,
    adjustments: adjustmentRows.map(a => ({
      id: a.id,
      type: a.type,
      amountCents: a.amountCents,
      relatedTripId: a.relatedTripId,
      periodDate: a.periodDate,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
    })),
    projectedOpenTripsCents,
  };
}

function getWeekEnd(weekStartStr: string): string {
  const d = new Date(weekStartStr);
  d.setDate(d.getDate() + 6);
  return d.toISOString().split("T")[0];
}

export function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split("T")[0];
}
