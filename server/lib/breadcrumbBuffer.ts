import { db } from "../db";
import { tripRoutePointChunks } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { encodePolyline, type LatLng } from "./polylineCodec";

const FLUSH_INTERVAL_MS = parseInt(process.env.BREADCRUMB_FLUSH_MS || "30000", 10);
const MAX_BUFFER_SIZE = parseInt(process.env.BREADCRUMB_MAX_BUFFER || "50", 10);

const FEATURE_FLAG = process.env.UCM_AGENTIC_ROUTES === "1";

interface BufferEntry {
  points: Array<LatLng & { ts: number }>;
  firstTs: number;
  lastTs: number;
}

const buffers = new Map<number, BufferEntry>();
const chunkCounters = new Map<number, number>();

let flushTimer: ReturnType<typeof setInterval> | null = null;

function getNextChunkIndex(tripId: number): number {
  const current = chunkCounters.get(tripId) || 0;
  const next = current + 1;
  chunkCounters.set(tripId, next);
  return next;
}

async function flushBuffer(tripId: number): Promise<void> {
  const entry = buffers.get(tripId);
  if (!entry || entry.points.length === 0) return;

  const points = [...entry.points];
  buffers.delete(tripId);

  const polyline = encodePolyline(points);
  const chunkIndex = getNextChunkIndex(tripId);

  try {
    await db.insert(tripRoutePointChunks).values({
      tripId,
      chunkIndex,
      polylineChunk: polyline,
      pointCount: points.length,
      startedAt: new Date(points[0].ts),
      endedAt: new Date(points[points.length - 1].ts),
    });
  } catch (err: any) {
    console.warn(`[BREADCRUMB-BUF] Flush error for trip ${tripId}: ${err.message}`);
    const existing = buffers.get(tripId);
    if (existing) {
      existing.points.unshift(...points);
    } else {
      buffers.set(tripId, {
        points,
        firstTs: points[0].ts,
        lastTs: points[points.length - 1].ts,
      });
    }
  }
}

export function addBreadcrumb(tripId: number, lat: number, lng: number, ts: number): void {
  if (!FEATURE_FLAG) return;

  let entry = buffers.get(tripId);
  if (!entry) {
    entry = { points: [], firstTs: ts, lastTs: ts };
    buffers.set(tripId, entry);
  }

  entry.points.push({ lat, lng, ts });
  entry.lastTs = ts;

  if (entry.points.length >= MAX_BUFFER_SIZE) {
    flushBuffer(tripId).catch(err => {
      console.warn(`[BREADCRUMB-BUF] Auto-flush error: ${err.message}`);
    });
  }
}

export async function flushTrip(tripId: number): Promise<void> {
  await flushBuffer(tripId);
}

async function flushAll(): Promise<void> {
  const tripIds = Array.from(buffers.keys());
  for (const tripId of tripIds) {
    await flushBuffer(tripId).catch(err => {
      console.warn(`[BREADCRUMB-BUF] Periodic flush error for trip ${tripId}: ${err.message}`);
    });
  }
}

export function startBreadcrumbFlusher(): void {
  if (!FEATURE_FLAG) return;

  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushAll().catch(() => {});
  }, FLUSH_INTERVAL_MS);

  console.log(`[BREADCRUMB-BUF] Started (interval=${FLUSH_INTERVAL_MS}ms, maxBuffer=${MAX_BUFFER_SIZE})`);
}

export function stopBreadcrumbFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushAll().catch(() => {});
}

export function getBufferStats(): { activeTrips: number; totalPoints: number } {
  let totalPoints = 0;
  for (const entry of buffers.values()) {
    totalPoints += entry.points.length;
  }
  return { activeTrips: buffers.size, totalPoints };
}
