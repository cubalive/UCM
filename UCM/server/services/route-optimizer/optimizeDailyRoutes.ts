import { db } from "../../db";
import { trips, clinics, vehicles } from "@shared/schema";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { clusterTrips } from "./clusterTrips";
import { buildRoute } from "./buildRoute";
import { validateRoute } from "./validateRoute";
import { assignDriver } from "./assignDrivers";

export interface OptimizationResult {
  routesCreated: number;
  tripsAssigned: number;
  failedClusters: number;
  errors: string[];
  routes: Array<{
    clinicId: number | null;
    clinicName: string | null;
    driverId: number | null;
    driverName: string | null;
    stopCount: number;
    totalDistanceMiles: number;
    tripIds: number[];
  }>;
}

export async function optimizeDailyRoutes(
  options: {
    cityId?: number;
    clinicId?: number;
    date?: string;
    dryRun?: boolean;
  } = {}
): Promise<OptimizationResult> {
  const { cityId, clinicId, date, dryRun = false } = options;

  const today = date || new Date().toISOString().split("T")[0];

  console.log(`[ROUTE-OPTIMIZER] Starting optimization for date=${today}, cityId=${cityId || "all"}, clinicId=${clinicId || "all"}, dryRun=${dryRun}`);

  const conditions: any[] = [
    eq(trips.scheduledDate, today),
    eq(trips.status, "SCHEDULED"),
    isNull(trips.driverId),
    isNull(trips.deletedAt),
    isNotNull(trips.pickupLat),
    isNotNull(trips.pickupLng),
  ];

  if (cityId) conditions.push(eq(trips.cityId, cityId));
  if (clinicId) conditions.push(eq(trips.clinicId, clinicId));

  const pendingTrips = await db
    .select()
    .from(trips)
    .where(and(...conditions));

  console.log(`[ROUTE-OPTIMIZER] Found ${pendingTrips.length} pending trips`);

  if (pendingTrips.length === 0) {
    return { routesCreated: 0, tripsAssigned: 0, failedClusters: 0, errors: [], routes: [] };
  }

  const clinicIds = [...new Set(pendingTrips.filter((t) => t.clinicId).map((t) => t.clinicId!))];
  const clinicRows = clinicIds.length > 0
    ? await db.select().from(clinics).where(
        and(isNull(clinics.deletedAt), eq(clinics.active, true))
      )
    : [];
  const clinicMap = new Map(clinicRows.map((c) => [c.id, c]));

  const clusters = clusterTrips(pendingTrips as any);
  console.log(`[ROUTE-OPTIMIZER] Created ${clusters.length} clusters`);

  const result: OptimizationResult = {
    routesCreated: 0,
    tripsAssigned: 0,
    failedClusters: 0,
    errors: [],
    routes: [],
  };

  const assignedDriverIds: number[] = [];

  for (const cluster of clusters) {
    const clinic = cluster.clinicId ? clinicMap.get(cluster.clinicId) : null;
    const clinicLocation = clinic && clinic.lat && clinic.lng
      ? { lat: clinic.lat, lng: clinic.lng }
      : { lat: cluster.centroidLat, lng: cluster.centroidLng };

    const route = buildRoute(cluster.trips as any, clinicLocation);

    if (route.stops.length === 0) {
      result.failedClusters++;
      result.errors.push(`Empty route for cluster at (${cluster.centroidLat}, ${cluster.centroidLng})`);
      continue;
    }

    const sampleCityId = cluster.trips[0]?.cityId;
    if (!sampleCityId) {
      result.failedClusters++;
      result.errors.push(`No cityId for cluster`);
      continue;
    }

    const assignment = await assignDriver(
      cluster.centroidLat,
      cluster.centroidLng,
      sampleCityId as number,
      assignedDriverIds
    );

    let vehicleInfo = { capacity: 4, wheelchairAccessible: false };
    if (assignment?.vehicleId) {
      const [v] = await db
        .select({ capacity: vehicles.capacity, wheelchairAccessible: vehicles.wheelchairAccessible })
        .from(vehicles)
        .where(eq(vehicles.id, assignment.vehicleId))
        .limit(1);
      if (v) {
        vehicleInfo = { capacity: v.capacity, wheelchairAccessible: v.wheelchairAccessible };
      }
    }

    const validation = validateRoute(route, vehicleInfo);
    if (!validation.valid) {
      result.failedClusters++;
      result.errors.push(`Validation failed: ${validation.errors.join("; ")}`);
      continue;
    }

    if (assignment) {
      assignedDriverIds.push(assignment.driverId);
    }

    const tripIds = route.stops.map((s) => s.tripId);

    if (!dryRun && assignment) {
      for (const stop of route.stops) {
        await db
          .update(trips)
          .set({
            driverId: assignment.driverId,
            vehicleId: assignment.vehicleId,
            status: "ASSIGNED",
            assignedAt: new Date(),
            assignmentSource: "route_optimizer",
            assignmentReason: `Optimized route, order ${stop.order}`,
            routeOrder: stop.order,
          })
          .where(
            and(
              eq(trips.id, stop.tripId),
              eq(trips.status, "SCHEDULED"),
              isNull(trips.driverId)
            )
          );
      }
    }

    result.routesCreated++;
    result.tripsAssigned += dryRun ? 0 : tripIds.length;
    result.routes.push({
      clinicId: cluster.clinicId,
      clinicName: clinic?.name || null,
      driverId: assignment?.driverId || null,
      driverName: assignment?.driverName || null,
      stopCount: route.stops.length,
      totalDistanceMiles: route.totalDistanceMiles,
      tripIds,
    });
  }

  console.log(
    `[ROUTE-OPTIMIZER] Complete: ${result.routesCreated} routes, ${result.tripsAssigned} trips assigned, ${result.failedClusters} failed`
  );

  return result;
}
