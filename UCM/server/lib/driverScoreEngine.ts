import { storage } from "../storage";
import { db } from "../db";
import { trips, tripEvents, drivers } from "@shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import type { City } from "@shared/schema";

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().split("T")[0];
}

function getWeekEnd(weekStartStr: string): string {
  const d = new Date(weekStartStr);
  d.setDate(d.getDate() + 6);
  return d.toISOString().split("T")[0];
}

export async function computeDriverScoresForCity(city: City, weekStart: string): Promise<{ computed: number }> {
  const weekEnd = getWeekEnd(weekStart);

  await storage.deleteDriverScoresByWeek(city.id, weekStart);

  const cityDrivers = (await storage.getDrivers(city.id)).filter(d => d.status === "ACTIVE");

  const weekTrips = await db.select().from(trips)
    .where(
      and(
        eq(trips.cityId, city.id),
        sql`${trips.scheduledDate} >= ${weekStart}`,
        sql`${trips.scheduledDate} <= ${weekEnd}`,
        isNull(trips.deletedAt),
      )
    );

  const weekEvents = await storage.getTripEventsByDateRange(city.id, weekStart, weekEnd);

  let computed = 0;

  for (const driver of cityDrivers) {
    const driverTrips = weekTrips.filter(t => t.driverId === driver.id);
    const totalTrips = driverTrips.length;
    const completedTrips = driverTrips.filter(t => t.status === "COMPLETED").length;
    const cancellations = driverTrips.filter(t => t.status === "CANCELLED").length;

    const driverTripIds = new Set(driverTrips.map(t => t.id));
    const driverEvents = weekEvents.filter(e => driverTripIds.has(e.tripId));

    const noShowDriver = driverEvents.filter(e => e.eventType === "no_show_driver").length;
    const lateDriver = driverEvents.filter(e => e.eventType === "late_driver").length;
    const noShowPatient = driverEvents.filter(e => e.eventType === "no_show_patient").length;

    const completionRate = totalTrips > 0 ? completedTrips / totalTrips : 0;
    const onTimeRate = totalTrips > 0 ? Math.max(0, 1 - (lateDriver / totalTrips)) : 1;
    const noShowAvoided = totalTrips > 0 ? totalTrips - noShowDriver : 0;

    let score = 50;

    score += Math.round(completionRate * 25);
    score += Math.round(onTimeRate * 15);

    score -= noShowDriver * 5;
    score -= lateDriver * 2;
    score -= cancellations * 3;

    score += Math.min(totalTrips, 10);

    score = Math.max(0, Math.min(100, score));

    await storage.createDriverScore({
      driverId: driver.id,
      cityId: city.id,
      weekStart,
      weekEnd,
      onTimeRate: Math.round(onTimeRate * 100) / 100,
      completedTrips,
      totalTrips,
      noShowAvoided,
      cancellations,
      lateCount: lateDriver,
      score,
    });

    computed++;
  }

  console.log(`[DRIVER-SCORE] Computed scores for ${computed} drivers in ${city.name} (week ${weekStart})`);
  return { computed };
}

export async function computeAllCityScores(weekStart: string): Promise<{ total: number }> {
  const cities = await storage.getActiveCities();
  let total = 0;
  for (const city of cities) {
    const result = await computeDriverScoresForCity(city, weekStart);
    total += result.computed;
  }
  return { total };
}
