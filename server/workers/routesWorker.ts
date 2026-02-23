import {
  STREAM_ACTIONS,
  GROUP_WORKER_ROUTES,
  readFromGroup,
  ackMessage,
  ensureConsumerGroup,
  moveToDeadLetter,
  isEventBusEnabled,
  type StreamMessage,
} from "../lib/eventBus";
import { db } from "../db";
import { tripRoutePlans, tripRouteSummary, tripRoutePointChunks, tripLocationPoints, trips, tripRouteEvents } from "@shared/schema";
import { eq, asc } from "drizzle-orm";
import { buildRoute } from "../lib/googleMaps";
import { broadcastToTrip } from "../lib/realtime";
import { encodePolyline, decodePolyline, computePolylineDistance, type LatLng } from "../lib/polylineCodec";

const CONSUMER_NAME = `routes-worker-${process.pid}`;
const POLL_INTERVAL_MS = parseInt(process.env.ROUTES_WORKER_POLL_MS || "5000", 10);
const BATCH_SIZE = 10;

let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function handleRouteCompute(payload: Record<string, any>): Promise<void> {
  const { tripId, pickupLat, pickupLng, dropoffLat, dropoffLng, pickupPlaceId, dropoffPlaceId } = payload;
  if (!tripId || !pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
    console.warn(`[ROUTES-WORKER] route.compute missing fields, tripId=${tripId}`);
    return;
  }

  const existing = await db.select({ id: tripRoutePlans.id }).from(tripRoutePlans).where(eq(tripRoutePlans.tripId, tripId)).limit(1);
  if (existing.length > 0) {
    return;
  }

  let route;
  try {
    route = await buildRoute(
      { lat: Number(pickupLat), lng: Number(pickupLng) },
      { lat: Number(dropoffLat), lng: Number(dropoffLng) },
    );
  } catch (err: any) {
    console.warn(`[ROUTES-WORKER] Google route failed for trip ${tripId}: ${err.message}`);
    throw err;
  }

  const distanceMeters = Math.round(route.totalMiles * 1609.344);
  const durationSeconds = Math.round(route.totalMinutes * 60);

  await db.insert(tripRoutePlans).values({
    tripId,
    provider: "google",
    originPlaceId: pickupPlaceId || null,
    destinationPlaceId: dropoffPlaceId || null,
    polyline: route.polyline,
    distanceMeters,
    durationSeconds,
    boundsJson: null,
  });

  await db.insert(tripRouteSummary).values({
    tripId,
    plannedDistanceMeters: distanceMeters,
    plannedDurationSeconds: durationSeconds,
    computedAt: new Date(),
  }).onConflictDoUpdate({
    target: tripRouteSummary.tripId,
    set: {
      plannedDistanceMeters: distanceMeters,
      plannedDurationSeconds: durationSeconds,
      computedAt: new Date(),
    },
  });

  const totalMiles = Math.round((distanceMeters / 1609.344) * 10) / 10;
  const totalMinutes = Math.round(durationSeconds / 60);
  await db.update(trips).set({
    routePolyline: route.polyline,
    routeDistanceMeters: distanceMeters,
    routeDurationSeconds: durationSeconds,
    routeProvider: "google",
    routeStatus: "computed",
    routeUpdatedAt: new Date(),
    routeSource: "agentic_worker",
    distanceMiles: String(totalMiles),
    durationMinutes: totalMinutes,
    updatedAt: new Date(),
  }).where(eq(trips.id, tripId));

  try {
    broadcastToTrip(tripId, {
      type: "status_change",
      data: { event: "route_plan_ready", tripId, distanceMeters, durationSeconds, polyline: route.polyline },
    });
  } catch {}

  try {
    await db.insert(tripRouteEvents).values({
      tripId,
      eventType: "route_computed",
      ts: new Date(),
      lat: Number(pickupLat),
      lng: Number(pickupLng),
      metaJson: { distanceMeters, durationSeconds, totalMiles, trigger: payload.trigger, provider: "google" },
    });
  } catch {}

  console.log(JSON.stringify({
    event: "route_computed",
    tripId,
    distanceMeters,
    durationSeconds,
    totalMiles,
    trigger: payload.trigger,
    ts: new Date().toISOString(),
  }));
}

async function handleRouteFinalize(payload: Record<string, any>): Promise<void> {
  const { tripId } = payload;
  if (!tripId) return;

  const chunks = await db.select().from(tripRoutePointChunks).where(eq(tripRoutePointChunks.tripId, tripId)).orderBy(asc(tripRoutePointChunks.chunkIndex));

  let allPoints: LatLng[] = [];
  for (const chunk of chunks) {
    const decoded = decodePolyline(chunk.polylineChunk);
    allPoints = allPoints.concat(decoded);
  }

  if (allPoints.length < 2) {
    const rawPoints = await db.select({
      lat: tripLocationPoints.lat,
      lng: tripLocationPoints.lng,
      ts: tripLocationPoints.ts,
    }).from(tripLocationPoints).where(eq(tripLocationPoints.tripId, tripId)).orderBy(asc(tripLocationPoints.ts));

    if (rawPoints.length >= 2) {
      allPoints = rawPoints.map(p => ({ lat: p.lat, lng: p.lng }));
    }
  }

  let actualDistanceMeters = 0;
  let actualDurationSeconds = 0;
  const pointsTotal = allPoints.length;

  if (allPoints.length >= 2) {
    actualDistanceMeters = computePolylineDistance(allPoints);

    const trip = await db.select({
      pickedUpAt: trips.pickedUpAt,
      completedAt: trips.completedAt,
    }).from(trips).where(eq(trips.id, tripId)).limit(1);

    if (trip[0]?.pickedUpAt && trip[0]?.completedAt) {
      const start = new Date(trip[0].pickedUpAt).getTime();
      const end = new Date(trip[0].completedAt).getTime();
      actualDurationSeconds = Math.round((end - start) / 1000);
    }
  }

  let gpsQualityScore = "0";
  if (pointsTotal >= 10) gpsQualityScore = "0.9";
  else if (pointsTotal >= 5) gpsQualityScore = "0.7";
  else if (pointsTotal >= 2) gpsQualityScore = "0.4";

  await db.insert(tripRouteSummary).values({
    tripId,
    actualDistanceMeters,
    actualDurationSeconds,
    pointsTotal,
    gpsQualityScore,
    computedAt: new Date(),
  }).onConflictDoUpdate({
    target: tripRouteSummary.tripId,
    set: {
      actualDistanceMeters,
      actualDurationSeconds,
      pointsTotal,
      gpsQualityScore,
      computedAt: new Date(),
    },
  });

  const actualPolylineStr = allPoints.length >= 2 ? encodePolyline(allPoints) : null;
  const actualMiles = Math.round((actualDistanceMeters / 1609.344) * 10) / 10;
  await db.update(trips).set({
    actualDistanceMeters,
    actualDurationSeconds,
    actualPolyline: actualPolylineStr,
    actualDistanceSource: pointsTotal >= 10 ? "gps" : pointsTotal >= 2 ? "gps_sparse" : "estimated",
    routeQualityScore: parseInt(gpsQualityScore.replace("0.", ""), 10) || 0,
    updatedAt: new Date(),
  }).where(eq(trips.id, tripId));

  try {
    await db.insert(tripRouteEvents).values({
      tripId,
      eventType: "route_finalized",
      ts: new Date(),
      metaJson: { actualDistanceMeters, actualDurationSeconds, actualMiles, pointsTotal, gpsQuality: gpsQualityScore },
    });
  } catch {}

  console.log(JSON.stringify({
    event: "route_finalized",
    tripId,
    actualDistanceMeters,
    actualDurationSeconds,
    actualMiles,
    pointsTotal,
    gpsQuality: gpsQualityScore,
    hasActualPolyline: !!actualPolylineStr,
    ts: new Date().toISOString(),
  }));
}

async function handleAction(msg: StreamMessage): Promise<void> {
  const { fields } = msg;
  const actionType = fields.type;
  let payload: Record<string, any> = {};

  try {
    payload = JSON.parse(fields.payload || "{}");
  } catch {
    payload = {};
  }

  switch (actionType) {
    case "route.compute":
      await handleRouteCompute(payload);
      break;
    case "route.finalize":
      await handleRouteFinalize(payload);
      break;
    default:
      break;
  }
}

async function pollLoop(): Promise<void> {
  if (!running) return;

  try {
    const messages = await readFromGroup(STREAM_ACTIONS, GROUP_WORKER_ROUTES, CONSUMER_NAME, BATCH_SIZE);

    for (const msg of messages) {
      try {
        await handleAction(msg);
        await ackMessage(STREAM_ACTIONS, GROUP_WORKER_ROUTES, msg.streamId);
      } catch (err: any) {
        console.error(JSON.stringify({
          event: "routes_worker_error",
          streamId: msg.streamId,
          type: msg.fields?.type,
          error: err.message?.slice(0, 200),
          ts: new Date().toISOString(),
        }));
        await moveToDeadLetter(msg.streamId, msg.fields, err.message);
        await ackMessage(STREAM_ACTIONS, GROUP_WORKER_ROUTES, msg.streamId);
      }
    }
  } catch (err: any) {
    console.warn(JSON.stringify({
      event: "routes_worker_poll_error",
      error: err.message?.slice(0, 200),
      ts: new Date().toISOString(),
    }));
  }

  if (running) {
    pollTimer = setTimeout(pollLoop, POLL_INTERVAL_MS);
  }
}

export async function startRoutesWorker(): Promise<void> {
  if (!isEventBusEnabled()) {
    console.log("[ROUTES-WORKER] Event bus disabled, skipping");
    return;
  }

  await ensureConsumerGroup(STREAM_ACTIONS, GROUP_WORKER_ROUTES);

  running = true;
  console.log(JSON.stringify({
    event: "routes_worker_started",
    consumer: CONSUMER_NAME,
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    ts: new Date().toISOString(),
  }));

  pollLoop();
}

export function stopRoutesWorker(): void {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log("[ROUTES-WORKER] Stopped");
}
