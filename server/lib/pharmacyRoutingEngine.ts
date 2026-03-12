/**
 * Pharmacy Smart Routing Engine
 *
 * Uses AI-driven optimization to create efficient delivery routes
 * for pharmacy orders. Groups nearby deliveries, optimizes stop
 * order using nearest-neighbor heuristic, and estimates ETAs.
 */

import { db } from "../db";
import { pharmacyOrders, pharmacyOrderEvents, drivers, pharmacies } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

export interface DeliveryStop {
  orderId: number;
  publicId: string;
  recipientName: string;
  recipientPhone: string | null;
  deliveryAddress: string;
  lat: number;
  lng: number;
  priority: string;
  isControlledSubstance: boolean;
  requiresSignature: boolean;
  requiresIdVerification: boolean;
  temperatureRequirement: string;
  estimatedMinutes?: number;
  distanceMiles?: number;
  windowStart?: string;
  windowEnd?: string;
}

export interface OptimizedRoute {
  routeId: string;
  pharmacyId: number;
  pharmacyName: string;
  pharmacyAddress: string;
  pharmacyLat: number;
  pharmacyLng: number;
  stops: DeliveryStop[];
  totalDistanceMiles: number;
  totalDurationMinutes: number;
  estimatedFuelCost: number;
  urgencyScore: number;
  requiresRefrigeration: boolean;
  hasControlledSubstances: boolean;
  createdAt: string;
}

// Haversine distance in miles
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDriveMinutes(distMiles: number): number {
  return Math.ceil((distMiles / 25) * 60);
}

const PRIORITY_WEIGHTS: Record<string, number> = {
  STAT: 100, URGENT: 75, EXPRESS: 50, STANDARD: 10,
};

function optimizeStopOrder(pharmacyLat: number, pharmacyLng: number, stops: DeliveryStop[]): DeliveryStop[] {
  if (stops.length <= 1) return stops;

  const remaining = [...stops];
  const ordered: DeliveryStop[] = [];
  let curLat = pharmacyLat;
  let curLng = pharmacyLng;
  let accumulatedMinutes = 0;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      const dist = haversine(curLat, curLng, s.lat, s.lng);
      const priorityBonus = -(PRIORITY_WEIGHTS[s.priority] || 10) * 0.1;
      const controlledBonus = s.isControlledSubstance ? -2 : 0;
      const score = dist + priorityBonus + controlledBonus;
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    }

    const next = remaining.splice(bestIdx, 1)[0];
    const dist = haversine(curLat, curLng, next.lat, next.lng);
    accumulatedMinutes += estimateDriveMinutes(dist) + 5;

    next.distanceMiles = Math.round(dist * 10) / 10;
    next.estimatedMinutes = accumulatedMinutes;

    ordered.push(next);
    curLat = next.lat;
    curLng = next.lng;
  }

  return ordered;
}

function clusterOrders(stops: DeliveryStop[], maxStopsPerRoute = 8): DeliveryStop[][] {
  if (stops.length <= maxStopsPerRoute) return [stops];

  const CELL_SIZE = 0.07;
  const cells: Map<string, DeliveryStop[]> = new Map();

  for (const stop of stops) {
    const cellKey = `${Math.floor(stop.lat / CELL_SIZE)},${Math.floor(stop.lng / CELL_SIZE)}`;
    if (!cells.has(cellKey)) cells.set(cellKey, []);
    cells.get(cellKey)!.push(stop);
  }

  const routes: DeliveryStop[][] = [];
  let currentBatch: DeliveryStop[] = [];

  for (const cellStops of cells.values()) {
    if (currentBatch.length + cellStops.length > maxStopsPerRoute && currentBatch.length > 0) {
      routes.push(currentBatch);
      currentBatch = [];
    }
    currentBatch.push(...cellStops);
  }
  if (currentBatch.length > 0) routes.push(currentBatch);

  return routes;
}

export async function generateOptimizedRoutes(
  pharmacyId: number,
  orderIds?: number[],
): Promise<OptimizedRoute[]> {
  const [pharmacy] = await db.select().from(pharmacies).where(eq(pharmacies.id, pharmacyId)).limit(1);
  if (!pharmacy) throw new Error("Pharmacy not found");

  const conditions = [eq(pharmacyOrders.pharmacyId, pharmacyId)];
  if (orderIds && orderIds.length > 0) {
    conditions.push(inArray(pharmacyOrders.id, orderIds));
  } else {
    conditions.push(inArray(pharmacyOrders.status, ["READY_FOR_PICKUP", "CONFIRMED", "PREPARING"]));
  }

  const orders = await db.select().from(pharmacyOrders).where(and(...conditions));
  if (orders.length === 0) return [];

  const stops: DeliveryStop[] = orders
    .filter(o => o.deliveryLat && o.deliveryLng)
    .map(o => ({
      orderId: o.id, publicId: o.publicId, recipientName: o.recipientName,
      recipientPhone: o.recipientPhone, deliveryAddress: o.deliveryAddress,
      lat: o.deliveryLat!, lng: o.deliveryLng!, priority: o.priority,
      isControlledSubstance: o.isControlledSubstance, requiresSignature: o.requiresSignature,
      requiresIdVerification: o.requiresIdVerification, temperatureRequirement: o.temperatureRequirement,
      windowStart: o.requestedDeliveryWindow?.split("-")[0],
      windowEnd: o.requestedDeliveryWindow?.split("-")[1],
    }));

  if (stops.length === 0) return [];

  const pharmacyLat = pharmacy.lat || 0;
  const pharmacyLng = pharmacy.lng || 0;

  const clusters = clusterOrders(stops);
  const routes: OptimizedRoute[] = [];

  for (let i = 0; i < clusters.length; i++) {
    const optimizedStops = optimizeStopOrder(pharmacyLat, pharmacyLng, clusters[i]);

    let totalDist = 0;
    let prevLat = pharmacyLat, prevLng = pharmacyLng;
    for (const s of optimizedStops) {
      totalDist += haversine(prevLat, prevLng, s.lat, s.lng);
      prevLat = s.lat; prevLng = s.lng;
    }

    const totalMinutes = estimateDriveMinutes(totalDist) + optimizedStops.length * 5;
    const urgencyScore = optimizedStops.reduce((acc, s) => acc + (PRIORITY_WEIGHTS[s.priority] || 10), 0);
    const routeId = `ROUTE-${pharmacy.publicId || pharmacyId}-${Date.now().toString(36).toUpperCase()}-${i + 1}`;

    routes.push({
      routeId, pharmacyId, pharmacyName: pharmacy.name, pharmacyAddress: pharmacy.address,
      pharmacyLat, pharmacyLng, stops: optimizedStops,
      totalDistanceMiles: Math.round(totalDist * 10) / 10,
      totalDurationMinutes: totalMinutes,
      estimatedFuelCost: Math.round(totalDist * 0.15 * 100) / 100,
      urgencyScore,
      requiresRefrigeration: optimizedStops.some(s => s.temperatureRequirement !== "AMBIENT"),
      hasControlledSubstances: optimizedStops.some(s => s.isControlledSubstance),
      createdAt: new Date().toISOString(),
    });
  }

  routes.sort((a, b) => b.urgencyScore - a.urgencyScore);
  return routes;
}

export async function dispatchRoute(
  routeId: string,
  route: OptimizedRoute,
  mode: "pharmacy_driver" | "dispatch",
  driverId?: number,
  dispatchedBy?: number,
): Promise<{ success: boolean; message: string }> {
  const orderIds = route.stops.map(s => s.orderId);

  if (mode === "pharmacy_driver" && driverId) {
    await db.update(pharmacyOrders).set({
      status: "DRIVER_ASSIGNED", driverId, assignedAt: new Date(), updatedAt: new Date(),
    }).where(inArray(pharmacyOrders.id, orderIds));

    for (const orderId of orderIds) {
      await db.insert(pharmacyOrderEvents).values({
        orderId, eventType: "ROUTE_ASSIGNED",
        description: `Assigned to pharmacy driver via route ${routeId}`,
        performedBy: dispatchedBy,
        metadata: { routeId, driverId, mode: "pharmacy_driver" },
      });
    }

    return { success: true, message: `Route ${routeId} assigned to driver #${driverId}` };
  }

  if (mode === "dispatch") {
    await db.update(pharmacyOrders).set({
      status: "READY_FOR_PICKUP", updatedAt: new Date(),
      notes: sql`COALESCE(${pharmacyOrders.notes}, '') || ${`\n[DISPATCH REQUEST] Route: ${routeId}`}`,
    }).where(inArray(pharmacyOrders.id, orderIds));

    for (const orderId of orderIds) {
      await db.insert(pharmacyOrderEvents).values({
        orderId, eventType: "DISPATCH_REQUESTED",
        description: `Sent to dispatch for driver assignment via route ${routeId}`,
        performedBy: dispatchedBy,
        metadata: { routeId, mode: "dispatch", stopsCount: route.stops.length, totalDistanceMiles: route.totalDistanceMiles },
      });
    }

    return { success: true, message: `Route ${routeId} sent to dispatch (${route.stops.length} stops)` };
  }

  return { success: false, message: "Invalid dispatch mode" };
}
