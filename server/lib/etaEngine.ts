import { storage } from "../storage";
import { etaMinutes } from "./googleMaps";
import { autoNotifyPatient } from "./dispatchAutoSms";
import { GOOGLE_MAPS_KEY } from "../../lib/mapsConfig";

const ETA_INTERVAL_MS = 60_000;
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

        if (eta.minutes <= FIVE_MIN_THRESHOLD && !trip.fiveMinAlertSent) {
          await storage.updateTrip(trip.id, {
            fiveMinAlertSent: true,
          } as any);

          autoNotifyPatient(trip.id, "arriving_soon", { eta_minutes: eta.minutes });
          console.log(`[ETA-ENGINE] 5-min alert triggered for trip ${trip.id}, ETA: ${eta.minutes}min`);
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
