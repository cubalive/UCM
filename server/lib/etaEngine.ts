import { storage } from "../storage";
import { etaMinutes } from "./googleMaps";
import { autoNotifyPatient } from "./dispatchAutoSms";
import { GOOGLE_MAPS_SERVER_KEY } from "../../lib/mapsConfig";
const GOOGLE_MAPS_KEY = GOOGLE_MAPS_SERVER_KEY;

const ETA_INTERVAL_MS = 120_000;
const TEN_MIN_THRESHOLD = 10;
const FIVE_MIN_THRESHOLD = 5;

let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function recalculateActiveETAs() {
  if (!GOOGLE_MAPS_KEY) return;

  try {
    const activeTrips = await storage.getActiveEnRouteTrips();
    if (activeTrips.length === 0) return;

    for (const trip of activeTrips) {
      try {
        if (!trip.driverId) continue;

        const driver = await storage.getDriver(trip.driverId);
        if (!driver || driver.dispatchStatus !== "enroute") continue;
        if (!driver.lastLat || !driver.lastLng) continue;

        const destination = (trip.pickupLat && trip.pickupLng)
          ? { lat: trip.pickupLat, lng: trip.pickupLng }
          : trip.pickupAddress;

        const eta = await etaMinutes(
          { lat: driver.lastLat, lng: driver.lastLng },
          destination
        );

        await storage.updateTrip(trip.id, {
          lastEtaMinutes: eta.minutes,
          distanceMiles: eta.distanceMiles.toString(),
          lastEtaUpdatedAt: new Date(),
        } as any);

        if (eta.minutes <= TEN_MIN_THRESHOLD) {
          const alreadySent10 = await storage.hasSmsBeenSent(trip.id, "eta_10");
          if (!alreadySent10) {
            autoNotifyPatient(trip.id, "eta_10", { eta_minutes: eta.minutes });
            console.log(`[ETA-ENGINE] 10-min alert triggered for trip ${trip.id}, ETA: ${eta.minutes}min`);
          }
        }

        if (eta.minutes <= FIVE_MIN_THRESHOLD) {
          const alreadySent5 = await storage.hasSmsBeenSent(trip.id, "eta_5");
          if (!alreadySent5) {
            autoNotifyPatient(trip.id, "eta_5", { eta_minutes: eta.minutes });
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
  }
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
