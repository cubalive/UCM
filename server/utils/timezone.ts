import { db } from "../db";
import { cities, trips } from "@shared/schema";
import { eq } from "drizzle-orm";

const DEFAULT_TZ = "America/Chicago";

const cityTzCache = new Map<number, string>();

export async function getCityTimezone(cityId: number): Promise<string> {
  const cached = cityTzCache.get(cityId);
  if (cached) return cached;

  try {
    const [city] = await db.select({ timezone: cities.timezone }).from(cities).where(eq(cities.id, cityId));
    const tz = city?.timezone || DEFAULT_TZ;
    cityTzCache.set(cityId, tz);
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

export async function getTripTimezone(tripId: number): Promise<string> {
  try {
    const [trip] = await db.select({ tripTimezone: trips.tripTimezone, cityId: trips.cityId }).from(trips).where(eq(trips.id, tripId));
    if (trip?.tripTimezone) return trip.tripTimezone;
    if (trip?.cityId) return getCityTimezone(trip.cityId);
    return DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

export function clearTzCache(): void {
  cityTzCache.clear();
}
