import { storage } from "../storage";
import { etaMinutes } from "./googleMaps";
import { autoNotifyPatient } from "./dispatchAutoSms";
import { GOOGLE_MAPS_SERVER_KEY } from "../../lib/mapsConfig";
const GOOGLE_MAPS_KEY = GOOGLE_MAPS_SERVER_KEY;

const ETA_INTERVAL_MS = 120_000;
const TEN_MIN_THRESHOLD = 10;
const FIVE_MIN_THRESHOLD = 5;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

async function recalculateActiveETAs() {
  if (!GOOGLE_MAPS_KEY) return;
  if (running) {
    console.log("[ETA-ENGINE] Skipping cycle — previous cycle still running");
    return;
  }

  running = true;
  try {
    const activeTrips = await storage.getActiveEnRouteTrips();
    if (activeTrips.length === 0) return;

    for (const trip of activeTrips) {
      try {
        if (!trip.driverId) continue;

        const driver = await storage.getDriver(trip.driverId);
        if (!driver) continue;
        if (!driver.lastLat || !driver.lastLng) continue;

        const toDropoff = ["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF"].includes(trip.status);
        const destLat = toDropoff ? trip.dropoffLat : trip.pickupLat;
        const destLng = toDropoff ? trip.dropoffLng : trip.pickupLng;
        if (!destLat || !destLng) continue;

        const eta = await etaMinutes(
          { lat: driver.lastLat, lng: driver.lastLng },
          { lat: destLat, lng: destLng }
        );

        await storage.updateTrip(trip.id, {
          lastEtaMinutes: eta.minutes,
          distanceMiles: eta.distanceMiles.toString(),
          lastEtaUpdatedAt: new Date(),
        } as any);

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

        console.log(`[ETA-ENGINE] Trip ${trip.id}: ETA ${eta.minutes}min, ${eta.distanceMiles}mi`);
      } catch (err: any) {
        console.warn(`[ETA-ENGINE] Failed for trip ${trip.id}: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.error(`[ETA-ENGINE] Cycle error: ${err.message}`);
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
