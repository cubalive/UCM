export const ONLINE_CUTOFF_MS = 90 * 1000;

export type DriverGroup = "on_trip" | "available" | "paused" | "hold" | "logged_out";

export interface ClassifiedDriver {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  publicId: string;
  phone: string;
  dispatch_status: string;
  is_online: boolean;
  last_seen_at: string | null;
  vehicle_id: number | null;
  vehicle_name: string | null;
  vehicle_color_hex: string | null;
  active_trip_id: number | null;
  active_trip_public_id: string | null;
  active_trip_status: string | null;
  cityId: number;
  group: DriverGroup;
  operational_status: "AVAILABLE" | "BUSY" | "OFFLINE";
  today_trip_count: number;
  performance_score: number | null;
}

export interface DriverStatusGroups {
  on_trip: ClassifiedDriver[];
  available: ClassifiedDriver[];
  paused: ClassifiedDriver[];
  hold: ClassifiedDriver[];
  logged_out: ClassifiedDriver[];
}

export function isDriverOnline(d: { dispatchStatus: string | null; lastSeenAt: string | Date | null }): boolean {
  if (d.dispatchStatus === "off") return false;
  if (!d.lastSeenAt) return false;
  const elapsed = Date.now() - new Date(d.lastSeenAt as string).getTime();
  return elapsed <= ONLINE_CUTOFF_MS;
}

export function isDriverPaused(d: { dispatchStatus: string | null; lastSeenAt: string | Date | null }): boolean {
  if (d.dispatchStatus === "off") return false;
  if (!d.lastSeenAt) return false;
  const elapsed = Date.now() - new Date(d.lastSeenAt as string).getTime();
  return elapsed > ONLINE_CUTOFF_MS;
}

const BUSY_STATUSES = new Set([
  "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP",
  "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS",
]);

export function classifyDriverGroup(
  d: { dispatchStatus: string | null; lastSeenAt: string | Date | null },
  hasActiveTrip: boolean,
  activeTripStatus?: string | null,
): DriverGroup {
  if (d.dispatchStatus === "off") return "logged_out";

  const online = isDriverOnline(d);

  if (!online) {
    if (isDriverPaused(d)) return "paused";
    return "logged_out";
  }

  if (d.dispatchStatus === "hold") return "hold";

  const isBusy = activeTripStatus ? BUSY_STATUSES.has(activeTripStatus) : hasActiveTrip;
  if (isBusy || d.dispatchStatus === "enroute") return "on_trip";
  if (d.dispatchStatus === "available") return "available";
  return "logged_out";
}

export function classifyDrivers(
  drivers: any[],
  activeTripsMap: Map<number, any>,
  vehicleMap: Map<number, any>,
  todayTripCounts?: Map<number, number>,
  performanceScores?: Map<number, number>,
): DriverStatusGroups {
  const groups: DriverStatusGroups = { on_trip: [], available: [], paused: [], hold: [], logged_out: [] };

  for (const d of drivers) {
    const vehicle = d.vehicleId ? vehicleMap.get(d.vehicleId) : null;
    const activeTrip = activeTripsMap.get(d.id);
    const online = isDriverOnline(d);
    const group = classifyDriverGroup(d, !!activeTrip, activeTrip?.status);

    const driverObj: ClassifiedDriver = {
      id: d.id,
      name: `${d.firstName} ${d.lastName}`,
      firstName: d.firstName,
      lastName: d.lastName,
      publicId: d.publicId,
      phone: d.phone,
      dispatch_status: d.dispatchStatus,
      is_online: online,
      last_seen_at: d.lastSeenAt ? new Date(d.lastSeenAt as string).toISOString() : null,
      vehicle_id: d.vehicleId,
      vehicle_name: vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : null,
      vehicle_color_hex: (vehicle as any)?.colorHex || null,
      active_trip_id: activeTrip?.id || null,
      active_trip_public_id: activeTrip?.publicId || null,
      active_trip_status: activeTrip?.status || null,
      cityId: d.cityId,
      group,
      operational_status: computeOperationalLabel(group, !!activeTrip, activeTrip?.status),
      today_trip_count: todayTripCounts?.get(d.id) ?? 0,
      performance_score: performanceScores?.get(d.id) ?? null,
    };

    groups[group].push(driverObj);
  }

  return groups;
}

export function isDriverAssignable(d: { dispatchStatus: string | null; lastSeenAt: string | Date | null }): { ok: boolean; reason?: string; warning?: string } {
  if (d.dispatchStatus === "off") {
    return { ok: false, reason: "Driver is logged out (dispatch_status=off). Only available drivers can be assigned trips." };
  }
  if (d.dispatchStatus === "hold") {
    return { ok: true, warning: "Driver is on break. Trip can be assigned but driver may not see it until they resume." };
  }
  if (!d.lastSeenAt) {
    return { ok: false, reason: "Driver has never checked in (no GPS signal). Cannot assign trips to an unreachable driver." };
  }
  const elapsed = Date.now() - new Date(d.lastSeenAt as string).getTime();
  if (elapsed > ONLINE_CUTOFF_MS) {
    const mins = Math.round(elapsed / 60000);
    return { ok: true, warning: `Driver GPS paused (last seen ${mins}m ago). Trip can be assigned but driver may not see it immediately.` };
  }
  return { ok: true };
}

export function isDriverVisibleOnMap(d: { dispatchStatus: string | null; lastSeenAt: string | Date | null; lastLat: number | null; lastLng: number | null }): boolean {
  if (d.dispatchStatus === "off") return false;
  if (d.dispatchStatus === "hold") return false;
  if (d.lastLat == null || d.lastLng == null) return false;
  return isDriverOnline(d);
}

export function computeOperationalLabel(
  group: DriverGroup,
  hasActiveTrip: boolean,
  activeTripStatus?: string | null,
): "AVAILABLE" | "BUSY" | "OFFLINE" {
  if (group === "on_trip") return "BUSY";
  if (hasActiveTrip && activeTripStatus && BUSY_STATUSES.has(activeTripStatus)) return "BUSY";
  if (group === "available") return "AVAILABLE";
  return "OFFLINE";
}
