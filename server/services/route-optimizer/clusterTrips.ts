interface TripWithCoords {
  id: number;
  pickupLat: number | null;
  pickupLng: number | null;
  pickupTime: string;
  clinicId: number | null;
  driverId: number | null;
  status: string;
  [key: string]: any;
}

export interface TripCluster {
  centroidLat: number;
  centroidLng: number;
  trips: TripWithCoords[];
  clinicId: number | null;
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

function parseTimeMinutes(timeStr: string): number {
  const parts = timeStr.split(":");
  if (parts.length < 2) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

const TIME_WINDOW_MINUTES = 60;

export function clusterTrips(
  trips: TripWithCoords[],
  radiusMiles: number = 3
): TripCluster[] {
  const valid = trips.filter(
    (t) =>
      t.pickupLat != null &&
      t.pickupLng != null &&
      t.status === "SCHEDULED" &&
      t.driverId == null
  );

  if (valid.length === 0) return [];

  const assigned = new Set<number>();
  const clusters: TripCluster[] = [];

  for (const trip of valid) {
    if (assigned.has(trip.id)) continue;

    const cluster: TripWithCoords[] = [trip];
    assigned.add(trip.id);
    const tripTime = parseTimeMinutes(trip.pickupTime);

    for (const candidate of valid) {
      if (assigned.has(candidate.id)) continue;

      const dist = haversineDistance(
        trip.pickupLat!,
        trip.pickupLng!,
        candidate.pickupLat!,
        candidate.pickupLng!
      );

      const candidateTime = parseTimeMinutes(candidate.pickupTime);
      const timeDiff = Math.abs(candidateTime - tripTime);

      if (dist <= radiusMiles && timeDiff <= TIME_WINDOW_MINUTES) {
        cluster.push(candidate);
        assigned.add(candidate.id);
      }
    }

    const centroidLat =
      cluster.reduce((s, t) => s + t.pickupLat!, 0) / cluster.length;
    const centroidLng =
      cluster.reduce((s, t) => s + t.pickupLng!, 0) / cluster.length;

    clusters.push({
      centroidLat,
      centroidLng,
      trips: cluster,
      clinicId: trip.clinicId,
    });
  }

  return clusters;
}
