export const ONLINE_CUTOFF_MS = 120 * 1000;

export type DriverGroup = "available" | "busy" | "hold" | "logged_out";

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
}

export interface DriverStatusGroups {
  available: ClassifiedDriver[];
  busy: ClassifiedDriver[];
  hold: ClassifiedDriver[];
  logged_out: ClassifiedDriver[];
}

export function isDriverOnline(d: { dispatchStatus: string | null; lastSeenAt: string | Date | null }): boolean {
  if (d.dispatchStatus === "off") return false;
  if (!d.lastSeenAt) return false;
  const elapsed = Date.now() - new Date(d.lastSeenAt as string).getTime();
  return elapsed <= ONLINE_CUTOFF_MS;
}

export function classifyDriverGroup(
  d: { dispatchStatus: string | null; lastSeenAt: string | Date | null },
  hasActiveTrip: boolean
): DriverGroup {
  const online = isDriverOnline(d);
  if (!online) return "logged_out";
  if (d.dispatchStatus === "hold") return "hold";
  if (d.dispatchStatus === "enroute" || hasActiveTrip) return "busy";
  if (d.dispatchStatus === "available") return "available";
  return "logged_out";
}

export function classifyDrivers(
  drivers: any[],
  activeTripsMap: Map<number, any>,
  vehicleMap: Map<number, any>
): DriverStatusGroups {
  const groups: DriverStatusGroups = { available: [], busy: [], hold: [], logged_out: [] };

  for (const d of drivers) {
    const vehicle = d.vehicleId ? vehicleMap.get(d.vehicleId) : null;
    const activeTrip = activeTripsMap.get(d.id);
    const online = isDriverOnline(d);
    const group = classifyDriverGroup(d, !!activeTrip);

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
    };

    groups[group].push(driverObj);
  }

  return groups;
}

export function isDriverAssignable(d: { dispatchStatus: string | null; lastSeenAt: string | Date | null }): { ok: boolean; reason?: string } {
  if (d.dispatchStatus === "off") {
    return { ok: false, reason: "Driver is logged out (dispatch_status=off). Only available drivers can be assigned trips." };
  }
  if (d.dispatchStatus === "hold") {
    return { ok: false, reason: "Driver is on hold/break. Remove hold status before assigning trips." };
  }
  if (!d.lastSeenAt) {
    return { ok: false, reason: "Driver has never checked in (no GPS signal). Cannot assign trips to an unreachable driver." };
  }
  const elapsed = Date.now() - new Date(d.lastSeenAt as string).getTime();
  if (elapsed > ONLINE_CUTOFF_MS) {
    const mins = Math.round(elapsed / 60000);
    return { ok: false, reason: `Driver last seen ${mins} minutes ago (stale GPS). Only recently active drivers can be assigned trips.` };
  }
  return { ok: true };
}

export function isDriverVisibleOnMap(d: { dispatchStatus: string | null; lastSeenAt: string | Date | null; lastLat: number | null; lastLng: number | null }): boolean {
  if (d.dispatchStatus === "off") return false;
  if (d.lastLat == null || d.lastLng == null) return false;
  return isDriverOnline(d);
}
