interface Stop {
  id: number;
  lat: number;
  lng: number;
  pickupTime: string;
  type: "pickup";
  tripId: number;
  [key: string]: any;
}

interface ClinicLocation {
  lat: number;
  lng: number;
}

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface RouteStop {
  order: number;
  tripId: number;
  lat: number;
  lng: number;
  pickupTime: string;
  distanceFromPrevMiles: number;
}

export interface BuiltRoute {
  stops: RouteStop[];
  totalDistanceMiles: number;
  clinicLat: number;
  clinicLng: number;
}

export function buildRoute(
  trips: Array<{ id: number; pickupLat: number | null; pickupLng: number | null; pickupTime: string; [key: string]: any }>,
  clinic: ClinicLocation
): BuiltRoute {
  const stops: Stop[] = trips
    .filter((t) => t.pickupLat != null && t.pickupLng != null)
    .map((t) => ({
      id: t.id,
      lat: t.pickupLat!,
      lng: t.pickupLng!,
      pickupTime: t.pickupTime,
      type: "pickup" as const,
      tripId: t.id,
    }));

  if (stops.length === 0) {
    return { stops: [], totalDistanceMiles: 0, clinicLat: clinic.lat, clinicLng: clinic.lng };
  }

  const ordered: RouteStop[] = [];
  const remaining = new Set(stops.map((_, i) => i));
  let currentLat = clinic.lat;
  let currentLng = clinic.lng;
  let totalDistance = 0;
  let order = 1;

  while (remaining.size > 0) {
    let nearestIdx = -1;
    let nearestDist = Infinity;

    for (const idx of remaining) {
      const d = haversineDistance(currentLat, currentLng, stops[idx].lat, stops[idx].lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = idx;
      }
    }

    if (nearestIdx === -1) break;

    remaining.delete(nearestIdx);
    const stop = stops[nearestIdx];
    totalDistance += nearestDist;

    ordered.push({
      order,
      tripId: stop.tripId,
      lat: stop.lat,
      lng: stop.lng,
      pickupTime: stop.pickupTime,
      distanceFromPrevMiles: Math.round(nearestDist * 100) / 100,
    });

    currentLat = stop.lat;
    currentLng = stop.lng;
    order++;
  }

  return {
    stops: ordered,
    totalDistanceMiles: Math.round(totalDistance * 100) / 100,
    clinicLat: clinic.lat,
    clinicLng: clinic.lng,
  };
}
