import { db } from "../db";
import { cities, trips } from "@shared/schema";
import { eq } from "drizzle-orm";

// M-2: No silent default timezone — cities MUST have timezone configured
const FALLBACK_TZ = "America/New_York"; // Only used for error recovery, logged as warning

const cityTzCache = new Map<number, string>();

export async function getCityTimezone(cityId: number): Promise<string> {
  const cached = cityTzCache.get(cityId);
  if (cached) return cached;

  try {
    const [city] = await db.select({ timezone: cities.timezone }).from(cities).where(eq(cities.id, cityId));
    if (!city) {
      console.error(`[TIMEZONE] City ${cityId} not found in database. Using fallback timezone.`);
      return FALLBACK_TZ;
    }
    if (!city.timezone) {
      console.error(
        `[TIMEZONE] City ${cityId} has no timezone configured. ` +
        `Add timezone to the city record before scheduling trips. Using fallback.`,
      );
      return FALLBACK_TZ;
    }
    cityTzCache.set(cityId, city.timezone);
    return city.timezone;
  } catch (err: any) {
    console.error(`[TIMEZONE] Failed to look up timezone for city ${cityId}:`, err.message);
    return FALLBACK_TZ;
  }
}

export async function getTripTimezone(tripId: number): Promise<string> {
  try {
    const [trip] = await db.select({ tripTimezone: trips.tripTimezone, cityId: trips.cityId }).from(trips).where(eq(trips.id, tripId));
    if (trip?.tripTimezone) return trip.tripTimezone;
    if (trip?.cityId) return getCityTimezone(trip.cityId);
    console.error(`[TIMEZONE] Trip ${tripId} has no timezone or city. Using fallback.`);
    return FALLBACK_TZ;
  } catch (err: any) {
    console.error(`[TIMEZONE] Failed to look up timezone for trip ${tripId}:`, err.message);
    return FALLBACK_TZ;
  }
}

export function clearTzCache(): void {
  cityTzCache.clear();
}
