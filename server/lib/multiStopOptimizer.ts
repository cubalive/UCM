/**
 * Multi-Stop Route Optimizer
 *
 * Optimizes route order for trips with multiple stops using nearest-neighbor
 * heuristic with time window constraints.
 */

interface Stop {
  lat: number;
  lng: number;
  priority: number; // higher = more important
  timeWindow?: { start: string; end: string }; // HH:MM format
  id?: string | number;
}

interface OptimizedRoute {
  order: number[];
  totalDistanceKm: number;
  estimatedDurationMinutes: number;
  savings: {
    distanceKm: number;
    durationMinutes: number;
    percentSaved: number;
  };
}

interface BatchResult {
  driverId: number;
  optimizedOrder: number[];
  totalDistanceKm: number;
  estimatedDurationMinutes: number;
  savings: {
    distanceKm: number;
    durationMinutes: number;
    percentSaved: number;
  };
  tripSequence: { tripId: number; order: number }[];
}

/**
 * Haversine distance between two lat/lng points in kilometers.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius in km
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

/**
 * Parse HH:MM time string to minutes from midnight.
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Estimate driving time in minutes from distance (assumes avg 40 km/h in urban areas).
 */
function estimateDriveMinutes(distKm: number): number {
  return (distKm / 40) * 60;
}

/**
 * Calculate total route distance for a given order.
 */
function routeDistance(stops: Stop[], order: number[]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const a = stops[order[i]];
    const b = stops[order[i + 1]];
    total += haversineKm(a.lat, a.lng, b.lat, b.lng);
  }
  return total;
}

/**
 * Check if a stop can be visited at a given accumulated time (minutes from start).
 */
function isWithinTimeWindow(stop: Stop, arrivalMinutes: number, startTime: number): boolean {
  if (!stop.timeWindow) return true;
  const windowStart = timeToMinutes(stop.timeWindow.start);
  const windowEnd = timeToMinutes(stop.timeWindow.end);
  const actualArrival = startTime + arrivalMinutes;
  return actualArrival >= windowStart && actualArrival <= windowEnd;
}

/**
 * Nearest-neighbor heuristic with priority and time window awareness.
 */
function nearestNeighborWithConstraints(stops: Stop[], startTime: number = 480): number[] {
  const n = stops.length;
  if (n <= 1) return stops.map((_, i) => i);

  const visited = new Set<number>();
  const order: number[] = [];

  // Start with highest-priority stop that has the earliest time window, or index 0
  let startIdx = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < n; i++) {
    const s = stops[i];
    const hasTightWindow = s.timeWindow
      ? timeToMinutes(s.timeWindow.end) - timeToMinutes(s.timeWindow.start)
      : 1440;
    // Score: priority * 100 - time window tightness (tighter windows should go first)
    const score = s.priority * 100 - hasTightWindow;
    if (score > bestScore) {
      bestScore = score;
      startIdx = i;
    }
  }

  order.push(startIdx);
  visited.add(startIdx);

  let accumulatedMinutes = 0;

  while (order.length < n) {
    const current = stops[order[order.length - 1]];
    let bestNext = -1;
    let bestDist = Infinity;

    // Find nearest unvisited stop that fits time window constraints
    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;

      const dist = haversineKm(current.lat, current.lng, stops[i].lat, stops[i].lng);
      const driveTime = estimateDriveMinutes(dist);

      // Check time window feasibility
      if (!isWithinTimeWindow(stops[i], accumulatedMinutes + driveTime, startTime)) {
        // If the window hasn't opened yet, it might still be ok - add wait time
        if (stops[i].timeWindow) {
          const windowStart = timeToMinutes(stops[i].timeWindow!.start);
          const arrivalTime = startTime + accumulatedMinutes + driveTime;
          if (arrivalTime < windowStart) {
            // We'd need to wait - penalize but don't exclude
            const adjustedDist = dist + (windowStart - arrivalTime) * 0.5;
            if (adjustedDist < bestDist) {
              bestDist = adjustedDist;
              bestNext = i;
            }
            continue;
          }
          // Window has passed - heavy penalty but still consider
          const adjustedDist = dist * 3;
          if (adjustedDist < bestDist) {
            bestDist = adjustedDist;
            bestNext = i;
          }
          continue;
        }
      }

      // Adjust distance by priority (higher priority = lower effective distance)
      const priorityFactor = Math.max(0.3, 1 - stops[i].priority * 0.1);
      const effectiveDist = dist * priorityFactor;

      if (effectiveDist < bestDist) {
        bestDist = effectiveDist;
        bestNext = i;
      }
    }

    if (bestNext === -1) {
      // Fallback: pick first unvisited
      for (let i = 0; i < n; i++) {
        if (!visited.has(i)) {
          bestNext = i;
          break;
        }
      }
    }

    if (bestNext === -1) break;

    const dist = haversineKm(current.lat, current.lng, stops[bestNext].lat, stops[bestNext].lng);
    accumulatedMinutes += estimateDriveMinutes(dist);

    order.push(bestNext);
    visited.add(bestNext);
  }

  return order;
}

/**
 * Try 2-opt improvement on the route.
 */
function twoOptImprove(stops: Stop[], order: number[]): number[] {
  const n = order.length;
  if (n <= 3) return order;

  let improved = true;
  let best = [...order];
  let bestDist = routeDistance(stops, best);

  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        const newOrder = [...best];
        // Reverse the segment between i+1 and j
        const segment = newOrder.slice(i + 1, j + 1).reverse();
        newOrder.splice(i + 1, segment.length, ...segment);

        const newDist = routeDistance(stops, newOrder);
        if (newDist < bestDist) {
          best = newOrder;
          bestDist = newDist;
          improved = true;
        }
      }
    }
  }

  return best;
}

/**
 * Optimize route order for trips with multiple stops.
 */
export function optimizeMultiStopRoute(stops: Stop[]): OptimizedRoute {
  if (stops.length <= 1) {
    return {
      order: stops.map((_, i) => i),
      totalDistanceKm: 0,
      estimatedDurationMinutes: 0,
      savings: { distanceKm: 0, durationMinutes: 0, percentSaved: 0 },
    };
  }

  // Original distance (naive order)
  const originalOrder = stops.map((_, i) => i);
  const originalDistance = routeDistance(stops, originalOrder);
  const originalDuration = estimateDriveMinutes(originalDistance);

  // Nearest-neighbor heuristic
  let optimizedOrder = nearestNeighborWithConstraints(stops);

  // 2-opt improvement (only for reasonable sizes to avoid perf issues)
  if (stops.length <= 50) {
    optimizedOrder = twoOptImprove(stops, optimizedOrder);
  }

  const optimizedDistance = routeDistance(stops, optimizedOrder);
  const optimizedDuration = estimateDriveMinutes(optimizedDistance);

  const distanceSaved = originalDistance - optimizedDistance;
  const durationSaved = originalDuration - optimizedDuration;

  return {
    order: optimizedOrder,
    totalDistanceKm: Math.round(optimizedDistance * 100) / 100,
    estimatedDurationMinutes: Math.round(optimizedDuration),
    savings: {
      distanceKm: Math.round(Math.max(0, distanceSaved) * 100) / 100,
      durationMinutes: Math.round(Math.max(0, durationSaved)),
      percentSaved:
        originalDistance > 0
          ? Math.round((Math.max(0, distanceSaved) / originalDistance) * 100)
          : 0,
    },
  };
}

/**
 * Optimize trip sequence for a driver with multiple assignments.
 */
export function batchOptimizeRoutes(
  driverId: number,
  tripList: { id: number; pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number; pickupTime: string; priority?: number }[]
): BatchResult {
  if (tripList.length === 0) {
    return {
      driverId,
      optimizedOrder: [],
      totalDistanceKm: 0,
      estimatedDurationMinutes: 0,
      savings: { distanceKm: 0, durationMinutes: 0, percentSaved: 0 },
      tripSequence: [],
    };
  }

  // Build stops from trips: pickup then dropoff for each trip
  // But for batch optimization, we optimize the ORDER of trips, not individual stops
  const stops: Stop[] = tripList.map((t) => ({
    lat: t.pickupLat,
    lng: t.pickupLng,
    priority: t.priority ?? 1,
    timeWindow: t.pickupTime
      ? {
          start: t.pickupTime,
          end: (() => {
            const [h, m] = t.pickupTime.split(":").map(Number);
            const endMin = h * 60 + m + 30; // 30 min window
            return `${Math.floor(endMin / 60).toString().padStart(2, "0")}:${(endMin % 60).toString().padStart(2, "0")}`;
          })(),
        }
      : undefined,
    id: t.id,
  }));

  const result = optimizeMultiStopRoute(stops);

  // Calculate full route distance including dropoffs
  let fullDistance = 0;
  const optimizedTrips = result.order.map((idx) => tripList[idx]);
  for (let i = 0; i < optimizedTrips.length; i++) {
    const t = optimizedTrips[i];
    // Pickup to dropoff
    fullDistance += haversineKm(t.pickupLat, t.pickupLng, t.dropoffLat, t.dropoffLng);
    // Dropoff to next pickup
    if (i < optimizedTrips.length - 1) {
      const next = optimizedTrips[i + 1];
      fullDistance += haversineKm(t.dropoffLat, t.dropoffLng, next.pickupLat, next.pickupLng);
    }
  }

  // Original full distance
  let originalFullDistance = 0;
  for (let i = 0; i < tripList.length; i++) {
    const t = tripList[i];
    originalFullDistance += haversineKm(t.pickupLat, t.pickupLng, t.dropoffLat, t.dropoffLng);
    if (i < tripList.length - 1) {
      const next = tripList[i + 1];
      originalFullDistance += haversineKm(t.dropoffLat, t.dropoffLng, next.pickupLat, next.pickupLng);
    }
  }

  const distanceSaved = originalFullDistance - fullDistance;
  const durationSaved = estimateDriveMinutes(Math.max(0, distanceSaved));

  return {
    driverId,
    optimizedOrder: result.order,
    totalDistanceKm: Math.round(fullDistance * 100) / 100,
    estimatedDurationMinutes: Math.round(estimateDriveMinutes(fullDistance)),
    savings: {
      distanceKm: Math.round(Math.max(0, distanceSaved) * 100) / 100,
      durationMinutes: Math.round(durationSaved),
      percentSaved:
        originalFullDistance > 0
          ? Math.round((Math.max(0, distanceSaved) / originalFullDistance) * 100)
          : 0,
    },
    tripSequence: result.order.map((idx, order) => ({
      tripId: tripList[idx].id,
      order,
    })),
  };
}
