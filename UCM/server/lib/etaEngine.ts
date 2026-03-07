import { storage } from "../storage";
import { autoNotifyPatient } from "./dispatchAutoSms";
import { getThrottledEta } from "./etaThrottle";
import { getDriverLocationFromCache } from "./driverLocationIngest";
import { broadcastToTrip } from "./realtime";
import { broadcastTripSupabaseThrottled } from "./supabaseRealtime";
import { shouldPublishEta } from "./backpressure";
import { tickJob, failJob } from "./jobHeartbeat";

const ETA_INTERVAL_MS = 120_000;
const TEN_MIN_THRESHOLD = 10;
const FIVE_MIN_THRESHOLD = 5;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

async function processTripsForEta(cityId?: number): Promise<number> {
  let activeTrips = await storage.getActiveEnRouteTrips();

  if (cityId) {
    activeTrips = activeTrips.filter(t => t.cityId === cityId);
  }

  if (activeTrips.length === 0) return 0;

  let processed = 0;

  for (const trip of activeTrips) {
    try {
      if (!trip.driverId) continue;

      const toDropoff = ["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF"].includes(trip.status);
      const destLat = toDropoff ? trip.dropoffLat : trip.pickupLat;
      const destLng = toDropoff ? trip.dropoffLng : trip.pickupLng;
      if (!destLat || !destLng) continue;

      const cachedLoc = getDriverLocationFromCache(trip.driverId);

      if (!cachedLoc) {
        const driver = await storage.getDriver(trip.driverId);
        if (!driver || !driver.lastLat || !driver.lastLng) continue;
      }

      const eta = await getThrottledEta(trip.driverId, { lat: destLat, lng: destLng }, trip.id);

      if (!eta) continue;

      await storage.updateTrip(trip.id, {
        lastEtaMinutes: eta.minutes,
        distanceMiles: eta.distanceMiles.toString(),
        lastEtaUpdatedAt: new Date(),
      } as any);

      if (await shouldPublishEta(trip.id)) {
        broadcastToTrip(trip.id, {
          type: "eta_update",
          data: { minutes: eta.minutes, distanceMiles: eta.distanceMiles, source: eta.source },
        });

        broadcastTripSupabaseThrottled(trip.id, {
          type: "eta_update",
          data: { minutes: eta.minutes, distanceMiles: eta.distanceMiles, source: eta.source },
        }).catch(() => {});
      }

      if (eta.minutes <= TEN_MIN_THRESHOLD) {
        const alreadySent10 = await storage.hasSmsBeenSent(trip.id, "eta_10");
        if (!alreadySent10) {
          await autoNotifyPatient(trip.id, "eta_10", { eta_minutes: eta.minutes });
          console.log(`[ETA-ENGINE] 10-min alert triggered for trip ${trip.id}, ETA: ${eta.minutes}min`);
        }
      }

      if (eta.minutes <= FIVE_MIN_THRESHOLD) {
        const alreadySent5 = await storage.hasSmsBeenSent(trip.id, "eta_5");
        if (!alreadySent5) {
          await autoNotifyPatient(trip.id, "eta_5", { eta_minutes: eta.minutes });
          console.log(`[ETA-ENGINE] 5-min alert triggered for trip ${trip.id}, ETA: ${eta.minutes}min`);
        }
      }

      console.log(`[ETA-ENGINE] Trip ${trip.id}: ETA ${eta.minutes}min, ${eta.distanceMiles}mi (${eta.source})`);
      processed++;
    } catch (err: any) {
      console.warn(`[ETA-ENGINE] Failed for trip ${trip.id}: ${err.message}`);
    }
  }

  return processed;
}

export async function executeEtaCycleForCity(cityId: number): Promise<{ tripsProcessed: number }> {
  const processed = await processTripsForEta(cityId);
  return { tripsProcessed: processed };
}

async function recalculateActiveETAs() {
  if (running) {
    console.log("[ETA-ENGINE] Skipping cycle — previous cycle still running");
    return;
  }

  running = true;
  tickJob("eta");
  try {
    await processTripsForEta();
  } catch (err: any) {
    console.error(`[ETA-ENGINE] Cycle error: ${err.message}`);
    failJob("eta", err.message);
  } finally {
    running = false;
  }
}

export async function runEtaCycleOnce(): Promise<{ tripsProcessed: number; skipped: boolean }> {
  if (running) {
    return { tripsProcessed: 0, skipped: true };
  }
  await recalculateActiveETAs();
  return { tripsProcessed: 0, skipped: false };
}

export function isEtaEngineRunning(): boolean {
  return intervalHandle !== null;
}

export function startEtaEngine() {
  if (intervalHandle) return;
  console.log(`[ETA-ENGINE] Started (interval: ${ETA_INTERVAL_MS / 1000}s)`);
  intervalHandle = setInterval(recalculateActiveETAs, ETA_INTERVAL_MS);
  setTimeout(recalculateActiveETAs, 5000);
}

export function stopEtaEngine() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[ETA-ENGINE] Stopped");
  }
}
