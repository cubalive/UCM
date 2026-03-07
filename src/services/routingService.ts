import logger from "../lib/logger.js";

export interface RouteResult {
  distanceMiles: number;
  durationMinutes: number;
  polyline: string; // encoded polyline
  summary: string;
}

const routeCache = new Map<string, { result: RouteResult; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cacheKey(originLat: number, originLng: number, destLat: number, destLng: number): string {
  // Round to 4 decimal places (~11m precision) for cache hits on nearby points
  return `${originLat.toFixed(4)},${originLng.toFixed(4)}-${destLat.toFixed(4)},${destLng.toFixed(4)}`;
}

export async function getRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  apiKey: string
): Promise<RouteResult | null> {
  const key = cacheKey(originLat, originLng, destLat, destLng);

  // Check cache
  const cached = routeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    // Build URL safely via URL class to prevent key leaking into template-string logs
    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.set("origin", `${originLat},${originLng}`);
    url.searchParams.set("destination", `${destLat},${destLng}`);
    url.searchParams.set("mode", "driving");
    url.searchParams.set("key", apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      logger.warn("Google Directions API HTTP error", { status: response.status });
      return null;
    }

    const data = await response.json();
    if (data.status !== "OK" || !data.routes?.length) {
      logger.warn("Google Directions API no route", { status: data.status });
      return null;
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    const result: RouteResult = {
      distanceMiles: Math.round((leg.distance.value / 1609.344) * 100) / 100,
      durationMinutes: Math.round(leg.duration.value / 60),
      polyline: route.overview_polyline.points,
      summary: route.summary || "",
    };

    // Cache result
    routeCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    // Evict old entries periodically
    if (routeCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of routeCache) {
        if (v.expiresAt < now) routeCache.delete(k);
      }
    }

    return result;
  } catch (err) {
    logger.error("Google Directions API error", { error: (err as Error).message });
    return null;
  }
}

// Haversine fallback when Google Maps API is unavailable
export function haversineEstimate(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): { distanceMiles: number; durationMinutes: number } {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLine = R * c;
  // Driving distance is typically 1.3x straight line
  const drivingDistance = Math.round(straightLine * 1.3 * 100) / 100;
  // Assume average 25 mph for NEMT
  const durationMinutes = Math.round((drivingDistance / 25) * 60);
  return { distanceMiles: drivingDistance, durationMinutes };
}
