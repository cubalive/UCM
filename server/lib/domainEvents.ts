import crypto from "crypto";
import { emitEvent } from "./eventBus";

// ── Domain Event Types ──────────────────────────────────────────────────────

export type DomainEventType =
  // Trip lifecycle
  | "trip.created"
  | "trip.assigned"
  | "trip.started"
  | "trip.at_pickup"
  | "trip.picked_up"
  | "trip.at_dropoff"
  | "trip.completed"
  | "trip.cancelled"
  | "trip.no_show"
  // Billing
  | "invoice.created"
  | "invoice.paid"
  | "claim.submitted"
  | "claim.approved"
  | "claim.denied"
  // Driver
  | "driver.online"
  | "driver.offline"
  | "driver.location_update"
  // Patient
  | "patient.confirmed"
  | "patient.no_show"
  | "patient.cancelled"
  // Dispatch
  | "dispatch.auto_assigned"
  | "dispatch.manual_override"
  | "dispatch.reassigned"
  // Circuit breaker
  | "circuit_breaker.opened"
  | "circuit_breaker.closed"
  | "circuit_breaker.half_open";

export interface DomainEventMetadata {
  userId?: number;
  companyId?: number;
  source: string;
  correlationId?: string;
}

export interface DomainEvent<T = any> {
  id: string;
  type: DomainEventType;
  timestamp: Date;
  payload: T;
  metadata: DomainEventMetadata;
}

type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;

// ── Ring Buffer for in-memory event log ─────────────────────────────────────

const RING_BUFFER_SIZE = 2048;
const ringBuffer: DomainEvent[] = [];
let ringBufferIndex = 0;

// ── Subscription Registry ───────────────────────────────────────────────────

const subscribers = new Map<DomainEventType | "*", Set<DomainEventHandler>>();

// ── Flush queue for periodic DB persistence ─────────────────────────────────

const flushQueue: DomainEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH_SIZE = 100;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Emit a domain event. Publishes to all subscribers, stores in ring buffer,
 * queues for DB flush, and forwards to the Redis event bus if available.
 */
export async function emit<T = any>(
  type: DomainEventType,
  payload: T,
  metadata: DomainEventMetadata,
): Promise<DomainEvent<T>> {
  const event: DomainEvent<T> = {
    id: crypto.randomUUID(),
    type,
    timestamp: new Date(),
    payload,
    metadata,
  };

  // Store in ring buffer
  if (ringBuffer.length < RING_BUFFER_SIZE) {
    ringBuffer.push(event);
  } else {
    ringBuffer[ringBufferIndex % RING_BUFFER_SIZE] = event;
  }
  ringBufferIndex++;

  // Queue for DB flush
  flushQueue.push(event);

  // Notify type-specific subscribers
  const typeHandlers = subscribers.get(type);
  if (typeHandlers) {
    for (const handler of typeHandlers) {
      try {
        await handler(event);
      } catch (err: any) {
        console.error(
          JSON.stringify({
            event: "domain_event_handler_error",
            eventType: type,
            eventId: event.id,
            error: err.message?.slice(0, 500),
            ts: new Date().toISOString(),
          }),
        );
      }
    }
  }

  // Notify wildcard subscribers
  const wildcardHandlers = subscribers.get("*");
  if (wildcardHandlers) {
    for (const handler of wildcardHandlers) {
      try {
        await handler(event);
      } catch (err: any) {
        console.error(
          JSON.stringify({
            event: "domain_event_wildcard_handler_error",
            eventType: type,
            eventId: event.id,
            error: err.message?.slice(0, 500),
            ts: new Date().toISOString(),
          }),
        );
      }
    }
  }

  // Forward to Redis event bus (fire-and-forget)
  emitEvent(`domain.${type}`, {
    id: event.id,
    type: event.type,
    payload: event.payload,
    metadata: event.metadata,
    timestamp: event.timestamp.toISOString(),
  }).catch(() => {
    // Redis event bus is optional — swallow errors silently
  });

  return event;
}

/**
 * Subscribe to a specific domain event type, or "*" for all events.
 * Returns an unsubscribe function.
 */
export function on(
  type: DomainEventType | "*",
  handler: DomainEventHandler,
): () => void {
  let handlerSet = subscribers.get(type);
  if (!handlerSet) {
    handlerSet = new Set();
    subscribers.set(type, handlerSet);
  }
  handlerSet.add(handler);

  return () => {
    handlerSet!.delete(handler);
    if (handlerSet!.size === 0) {
      subscribers.delete(type);
    }
  };
}

/**
 * Replay events of a given type from the in-memory ring buffer since a given date.
 * For full replay from DB, use replayFromDb().
 */
export function replay(
  type: DomainEventType,
  since: Date,
): DomainEvent[] {
  return ringBuffer
    .filter((e) => e && e.type === type && e.timestamp >= since)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Replay events from the database domain_events table.
 */
export async function replayFromDb(
  type: DomainEventType,
  since: Date,
): Promise<DomainEvent[]> {
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");

    const rows: any[] = await db.execute(
      sql`SELECT id, type, payload, metadata, created_at
          FROM domain_events
          WHERE type = ${type} AND created_at >= ${since.toISOString()}
          ORDER BY created_at ASC
          LIMIT 1000`,
    );

    const resultRows = Array.isArray(rows) ? rows : (rows as any).rows || [];

    return resultRows.map((row: any) => ({
      id: row.id,
      type: row.type as DomainEventType,
      timestamp: new Date(row.created_at),
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    }));
  } catch (err: any) {
    console.warn(
      JSON.stringify({
        event: "domain_event_replay_db_error",
        eventType: type,
        error: err.message?.slice(0, 300),
        ts: new Date().toISOString(),
      }),
    );
    return [];
  }
}

/**
 * Flush queued events to the database. Called periodically and on shutdown.
 */
export async function flushToDb(): Promise<number> {
  if (flushQueue.length === 0) return 0;

  const batch = flushQueue.splice(0, FLUSH_BATCH_SIZE);

  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");

    for (const event of batch) {
      await db.execute(
        sql`INSERT INTO domain_events (id, type, payload, metadata, created_at)
            VALUES (${event.id}, ${event.type}, ${JSON.stringify(event.payload)}::jsonb, ${JSON.stringify(event.metadata)}::jsonb, ${event.timestamp.toISOString()})
            ON CONFLICT (id) DO NOTHING`,
      );
    }

    return batch.length;
  } catch (err: any) {
    // Put events back at the front of the queue for retry
    flushQueue.unshift(...batch);
    console.warn(
      JSON.stringify({
        event: "domain_event_flush_error",
        batchSize: batch.length,
        queueDepth: flushQueue.length,
        error: err.message?.slice(0, 300),
        ts: new Date().toISOString(),
      }),
    );
    return 0;
  }
}

/**
 * Start the periodic DB flush timer. Call once at boot.
 */
export function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushToDb().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  // Ensure the timer doesn't prevent process exit
  if (flushTimer.unref) flushTimer.unref();
}

/**
 * Stop the flush timer and flush remaining events.
 */
export async function stopFlushTimer(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Final flush
  while (flushQueue.length > 0) {
    const flushed = await flushToDb();
    if (flushed === 0) break; // DB unavailable, stop trying
  }
}

/**
 * Get recent events from the ring buffer (most recent first).
 */
export function getRecentEvents(limit = 50): DomainEvent[] {
  return ringBuffer
    .filter((e) => e != null)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, limit);
}

/**
 * Get event system stats.
 */
export function getStats(): {
  ringBufferSize: number;
  flushQueueDepth: number;
  subscriberCount: number;
  eventTypes: string[];
} {
  return {
    ringBufferSize: ringBuffer.filter((e) => e != null).length,
    flushQueueDepth: flushQueue.length,
    subscriberCount: Array.from(subscribers.values()).reduce(
      (sum, set) => sum + set.size,
      0,
    ),
    eventTypes: Array.from(subscribers.keys()),
  };
}

/**
 * Ensure the domain_events table exists (called at boot).
 */
export async function ensureDomainEventsTable(): Promise<void> {
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS domain_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS domain_events_type_created_idx ON domain_events(type, created_at)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS domain_events_created_idx ON domain_events(created_at)`,
    );
  } catch (err: any) {
    console.warn(
      JSON.stringify({
        event: "domain_events_table_init_error",
        error: err.message?.slice(0, 300),
        ts: new Date().toISOString(),
      }),
    );
  }
}
