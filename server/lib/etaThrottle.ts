import { cache, cacheKeys, CACHE_TTL, type CachedEta, type CachedDriverLocation } from "./cache";
import { haversineDistanceMeters, getDriverLocationFromCache } from "./driverLocationIngest";
import { etaMinutes } from "./googleMaps";
import { GOOGLE_MAPS_SERVER_KEY } from "../../lib/mapsConfig";
import { getJson, setJson, setNx, recordLockContention } from "./redis";

const MOVEMENT_THRESHOLD_M = 300;
const TIME_THRESHOLD_MS = 45_000;
const AVG_SPEED_MPS = 11.2; // ~25 mph for urban areas

interface EtaCalcPosition {
  lat: number;
  lng: number;
}

interface EtaLastCalc {
  lat: number;
  lng: number;
  computedAt: number;
}

function haversineEta(from: EtaCalcPosition, to: EtaCalcPosition): CachedEta {
  const distM = haversineDistanceMeters(from.lat, from.lng, to.lat, to.lng);
  const distMiles = Math.round((distM / 1609.34) * 10) / 10;
  const seconds = distM / AVG_SPEED_MPS;
  const minutes = Math.max(1, Math.round(seconds / 60));
  return {
    minutes,
    distanceMiles: distMiles,
    computedAt: Date.now(),
    source: "haversine",
  };
}

export async function getThrottledEta(
  driverId: number,
  destination: EtaCalcPosition,
  tripId: number,
): Promise<CachedEta | null> {
  const etaCacheKey = cacheKeys("trip_eta", tripId);
  let cachedEta = cache.get<CachedEta>(etaCacheKey);

  if (!cachedEta) {
    const redisEta = await getJson<CachedEta>(`trip:${tripId}:eta`);
    if (redisEta) {
      cachedEta = redisEta;
      cache.set(etaCacheKey, redisEta, CACHE_TTL.TRIP_ETA);
    }
  }

  const driverLoc = getDriverLocationFromCache(driverId);
  if (!driverLoc) {
    return cachedEta;
  }

  const calcKey = cacheKeys("eta_last_calc", driverId);
  const lastCalc = cache.get<EtaLastCalc>(calcKey);

  let shouldRecompute = false;

  if (!lastCalc) {
    shouldRecompute = true;
  } else {
    const distMoved = haversineDistanceMeters(lastCalc.lat, lastCalc.lng, driverLoc.lat, driverLoc.lng);
    const timeSinceCalc = Date.now() - lastCalc.computedAt;

    if (distMoved > MOVEMENT_THRESHOLD_M || timeSinceCalc > TIME_THRESHOLD_MS) {
      shouldRecompute = true;
    }
  }

  if (!shouldRecompute && cachedEta) {
    return cachedEta;
  }

  const lockAcquired = await setNx(`lock:eta:${tripId}`, "1", 10);
  if (!lockAcquired) {
    recordLockContention();
    return cachedEta;
  }

  let eta: CachedEta;

  if (GOOGLE_MAPS_SERVER_KEY) {
    try {
      const result = await etaMinutes(
        { lat: driverLoc.lat, lng: driverLoc.lng },
        destination,
      );
      eta = {
        minutes: result.minutes,
        distanceMiles: result.distanceMiles,
        computedAt: Date.now(),
        source: "google",
      };
    } catch {
      eta = haversineEta(
        { lat: driverLoc.lat, lng: driverLoc.lng },
        destination,
      );
    }
  } else {
    eta = haversineEta(
      { lat: driverLoc.lat, lng: driverLoc.lng },
      destination,
    );
  }

  cache.set(etaCacheKey, eta, CACHE_TTL.TRIP_ETA);
  setJson(`trip:${tripId}:eta`, eta, 60).catch(() => {});
  cache.set(calcKey, { lat: driverLoc.lat, lng: driverLoc.lng, computedAt: Date.now() }, 120_000);

  return eta;
}

export { haversineEta };
