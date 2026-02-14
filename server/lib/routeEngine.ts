import { storage } from "../storage";
import type { City, Trip } from "@shared/schema";

function getCityLocalDate(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone });
}

function getCityLocalTime(timezone: string): string {
  return new Date().toLocaleTimeString("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" });
}

function getTimeWindow(pickupTime: string): string {
  const [h] = pickupTime.split(":");
  const hour = parseInt(h);
  if (hour < 8) return "early";
  if (hour < 10) return "morning";
  if (hour < 12) return "midday";
  if (hour < 14) return "afternoon";
  return "late";
}

function getZipCluster(trip: Trip): string {
  return (trip.pickupZip || "00000").substring(0, 3);
}

export async function runRouteBatchingForCity(city: City): Promise<{ batches: number; tripsRouted: number }> {
  const timezone = city.timezone || "America/New_York";
  const today = getCityLocalDate(timezone);

  const existing = await storage.getRouteBatchesByDate(city.id, today);
  if (existing.length > 0) {
    return { batches: existing.length, tripsRouted: 0 };
  }

  const allTrips = await storage.getTrips(city.id);
  const todayTrips = allTrips.filter(t =>
    t.scheduledDate === today &&
    !t.deletedAt &&
    (t.status === "SCHEDULED" || t.status === "ASSIGNED") &&
    t.approvalStatus === "approved"
  );

  if (todayTrips.length === 0) {
    return { batches: 0, tripsRouted: 0 };
  }

  const recurringTrips = todayTrips.filter(t => t.tripType === "recurring");
  const oneTimeTrips = todayTrips.filter(t => t.tripType !== "recurring");

  const sorted = [
    ...recurringTrips.sort((a, b) => (a.pickupTime || "").localeCompare(b.pickupTime || "")),
    ...oneTimeTrips.sort((a, b) => (a.pickupTime || "").localeCompare(b.pickupTime || "")),
  ];

  const groups: Map<string, Trip[]> = new Map();
  for (const trip of sorted) {
    const window = getTimeWindow(trip.pickupTime);
    const zip = getZipCluster(trip);
    const key = `${window}_${zip}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(trip);
  }

  let batchCount = 0;
  let totalRouted = 0;

  const entries = Array.from(groups.entries());
  for (const [key, batchTrips] of entries) {
    const tripIds = batchTrips.map((t: Trip) => t.id);
    const label = `Batch ${key.replace("_", " - ZIP ")} (${batchTrips.length} trips)`;

    await storage.createRouteBatch({
      cityId: city.id,
      date: today,
      batchLabel: label,
      tripIds,
      status: "pending",
    });

    for (let i = 0; i < batchTrips.length; i++) {
      await storage.updateTrip(batchTrips[i].id, {
        routeOrder: i + 1,
      } as any);
    }

    batchCount++;
    totalRouted += tripIds.length;
  }

  console.log(`[ROUTE-ENGINE] City ${city.name}: created ${batchCount} batches, ${totalRouted} trips routed`);
  return { batches: batchCount, tripsRouted: totalRouted };
}

let routeSchedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startRouteScheduler() {
  if (routeSchedulerInterval) return;

  const INTERVAL = 60 * 1000;

  routeSchedulerInterval = setInterval(async () => {
    try {
      const cities = await storage.getActiveCities();
      for (const city of cities) {
        const timezone = city.timezone || "America/New_York";
        const localTime = getCityLocalTime(timezone);

        if (localTime >= "05:25" && localTime <= "05:35") {
          const dayName = new Date().toLocaleDateString("en-US", { timeZone: timezone, weekday: "short" }).substring(0, 3);
          if (dayName === "Sun") continue;

          await runRouteBatchingForCity(city);
        }
      }
    } catch (err: any) {
      console.error("[ROUTE-ENGINE] Scheduler error:", err.message);
    }
  }, INTERVAL);

  console.log("[ROUTE-ENGINE] Scheduler started (checks every 60s for 5:30 AM window)");
}

export function stopRouteScheduler() {
  if (routeSchedulerInterval) {
    clearInterval(routeSchedulerInterval);
    routeSchedulerInterval = null;
    console.log("[ROUTE-ENGINE] Scheduler stopped");
  }
}
