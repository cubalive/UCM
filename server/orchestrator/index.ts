import {
  STREAM_EVENTS,
  GROUP_ORCHESTRATOR,
  readFromGroup,
  ackMessage,
  emitAction,
  ensureConsumerGroup,
  moveToDeadLetter,
  isEventBusEnabled,
  type StreamMessage,
} from "../lib/eventBus";
import { db } from "../db";
import { opsAuditLedger } from "@shared/schema";

const CONSUMER_NAME = `orchestrator-${process.pid}`;
const POLL_INTERVAL_MS = parseInt(process.env.ORCHESTRATOR_POLL_MS || "3000", 10);
const BATCH_SIZE = 20;

let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function writeAuditEntry(
  entityType: string,
  entityId: number,
  eventType: string,
  inputs: any,
  decision: any,
  actions: any,
): Promise<void> {
  try {
    await db.insert(opsAuditLedger).values({
      entityType,
      entityId,
      eventType,
      inputsJson: inputs,
      decisionJson: decision,
      actionsJson: actions,
    });
  } catch (err: any) {
    console.warn(`[ORCHESTRATOR] Audit write error: ${err.message}`);
  }
}

async function handleEvent(msg: StreamMessage): Promise<void> {
  const { fields } = msg;
  const eventType = fields.type;
  let payload: Record<string, any> = {};

  try {
    payload = JSON.parse(fields.payload || "{}");
  } catch {
    payload = {};
  }

  switch (eventType) {
    case "trip.created": {
      const { tripId, pickupLat, pickupLng, dropoffLat, dropoffLng } = payload;
      if (tripId && pickupLat && pickupLng && dropoffLat && dropoffLng) {
        const decision = { action: "enqueue_route_compute", reason: "trip_created_with_coords" };
        await emitAction("route.compute", {
          tripId,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          pickupPlaceId: payload.pickupPlaceId,
          dropoffPlaceId: payload.dropoffPlaceId,
          trigger: "trip.created",
        }, `route.compute:created:${tripId}`);
        await writeAuditEntry("trip", tripId, "trip.created", payload, decision, { enqueued: "route.compute" });
      } else {
        await writeAuditEntry("trip", tripId || 0, "trip.created", payload, { action: "no_op", reason: "missing_coords" }, null);
      }
      break;
    }

    case "trip.assigned": {
      const { tripId, pickupLat, pickupLng, dropoffLat, dropoffLng, driverId } = payload;
      if (tripId && pickupLat && pickupLng && dropoffLat && dropoffLng) {
        const decision = { action: "enqueue_route_compute", reason: "trip_assigned_to_driver" };
        await emitAction("route.compute", {
          tripId,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          driverId,
          trigger: "trip.assigned",
        }, `route.compute:assigned:${tripId}:${driverId}`);
        await writeAuditEntry("trip", tripId, "trip.assigned", payload, decision, { enqueued: "route.compute" });
      } else {
        await writeAuditEntry("trip", tripId || 0, "trip.assigned", payload, { action: "no_op", reason: "missing_coords" }, null);
      }
      break;
    }

    case "trip.status_changed": {
      const { tripId, to, from } = payload;
      if (to === "COMPLETED" && tripId) {
        const decision = { action: "enqueue_route_finalize", reason: "trip_completed" };
        await emitAction("route.finalize", {
          tripId,
          trigger: "trip.status_changed",
        }, `route.finalize:${tripId}`);
        await writeAuditEntry("trip", tripId, "trip.completed", payload, decision, { enqueued: "route.finalize" });
      } else {
        await writeAuditEntry("trip", tripId || 0, `trip.status:${from}→${to}`, payload, { action: "no_op", reason: "non_terminal" }, null);
      }
      break;
    }

    default: {
      break;
    }
  }
}

async function pollLoop(): Promise<void> {
  if (!running) return;

  try {
    const messages = await readFromGroup(STREAM_EVENTS, GROUP_ORCHESTRATOR, CONSUMER_NAME, BATCH_SIZE);

    for (const msg of messages) {
      try {
        await handleEvent(msg);
        await ackMessage(STREAM_EVENTS, GROUP_ORCHESTRATOR, msg.streamId);
      } catch (err: any) {
        console.error(JSON.stringify({
          event: "orchestrator_event_error",
          streamId: msg.streamId,
          type: msg.fields?.type,
          error: err.message?.slice(0, 200),
          ts: new Date().toISOString(),
        }));
        await moveToDeadLetter(msg.streamId, msg.fields, err.message);
        await ackMessage(STREAM_EVENTS, GROUP_ORCHESTRATOR, msg.streamId);
      }
    }
  } catch (err: any) {
    console.warn(JSON.stringify({
      event: "orchestrator_poll_error",
      error: err.message?.slice(0, 200),
      ts: new Date().toISOString(),
    }));
  }

  if (running) {
    pollTimer = setTimeout(pollLoop, POLL_INTERVAL_MS);
  }
}

export async function startOrchestrator(): Promise<void> {
  if (!isEventBusEnabled()) {
    console.log("[ORCHESTRATOR] Event bus disabled (UCM_AGENTIC_ROUTES!=1 or Redis unavailable), skipping");
    return;
  }

  await ensureConsumerGroup(STREAM_EVENTS, GROUP_ORCHESTRATOR);

  running = true;
  console.log(JSON.stringify({
    event: "orchestrator_started",
    consumer: CONSUMER_NAME,
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    ts: new Date().toISOString(),
  }));

  pollLoop();
}

export function stopOrchestrator(): void {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log("[ORCHESTRATOR] Stopped");
}
