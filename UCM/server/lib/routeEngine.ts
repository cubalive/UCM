import { storage } from "../storage";
import { db } from "../db";
import { trips } from "@shared/schema";
import { eq, and, inArray, isNull, gte, sql } from "drizzle-orm";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";

function getCityLocalTime(timezone: string): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function getTripsForRouting(cityId: number, date: string) {
  const today = date;
  const rows = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.cityId, cityId),
        eq(trips.scheduledDate, today),
        inArray(trips.status, ["SCHEDULED", "ASSIGNED"]),
        isNull(trips.deletedAt),
        eq(trips.routeStatus, "missing")
      )
    );
  return rows;
}

async function createRouteBatch(
  cityId: number,
  tripIds: number[],
  batchLabel: string
): Promise<number> {
  let count = 0;
  for (const tripId of tripIds) {
    try {
      await db
        .update(trips)
        .set({
          routeStatus: "queued",
          routeUpdatedAt: new Date(),
        })
        .where(eq(trips.id, tripId));
      count++;
    } catch (err: any) {
      console.error(`[ROUTE-ENGINE] Failed to queue trip ${tripId}: ${err.message}`);
    }
  }
  return count;
}

export async function runRouteBatchingForCity(city: { id: number; name: string; timezone?: string | null }) {
  const timezone = city.timezone || "America/New_York";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const tripsToRoute = await getTripsForRouting(city.id, today);

  if (tripsToRoute.length === 0) return { batches: 0, tripsRouted: 0 };

  const BATCH_SIZE = 25;
  const batches: number[][] = [];
  for (let i = 0; i < tripsToRoute.length; i += BATCH_SIZE) {
    batches.push(tripsToRoute.slice(i, i + BATCH_SIZE).map((t) => t.id));
  }

  let batchCount = 0;
  let totalRouted = 0;
  for (const batch of batches) {
    batchCount++;
    const routed = await createRouteBatch(
      city.id,
      batch,
      `${today}-batch-${batchCount}`
    );
    totalRouted += routed;
  }

  console.log(`[ROUTE-ENGINE] City ${city.name}: created ${batchCount} batches, ${totalRouted} trips routed`);
  return { batches: batchCount, tripsRouted: totalRouted };
}

let routeTask: HarnessedTask | null = null;

export function startRouteScheduler() {
  if (routeTask) return;

  const INTERVAL = 60 * 1000;

  routeTask = createHarnessedTask({
    name: "route_engine",
    lockKey: "scheduler:lock:route_engine",
    lockTtlSeconds: 30,
    timeoutMs: 120_000,
    fn: async () => {
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
    },
  });

  registerInterval("route_engine", INTERVAL, routeTask);
  console.log("[ROUTE-ENGINE] Scheduler started (checks every 60s for 5:30 AM window)");
}

export function stopRouteScheduler() {
  if (routeTask) {
    routeTask.stop();
    routeTask = null;
    console.log("[ROUTE-ENGINE] Scheduler stopped");
  }
}
