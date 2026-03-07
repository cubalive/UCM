import type { BuiltRoute } from "./buildRoute";

interface VehicleInfo {
  capacity: number;
  wheelchairAccessible: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_ROUTE_TIME_MINUTES = 60;
const AVG_SPEED_MPH = 25;

export function validateRoute(
  route: BuiltRoute,
  vehicle: VehicleInfo
): ValidationResult {
  const errors: string[] = [];

  if (route.stops.length > vehicle.capacity) {
    errors.push(
      `Route has ${route.stops.length} stops but vehicle capacity is ${vehicle.capacity}`
    );
  }

  const estimatedMinutes = (route.totalDistanceMiles / AVG_SPEED_MPH) * 60;
  if (estimatedMinutes > MAX_ROUTE_TIME_MINUTES) {
    errors.push(
      `Estimated route time ${Math.round(estimatedMinutes)} min exceeds max ${MAX_ROUTE_TIME_MINUTES} min`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
