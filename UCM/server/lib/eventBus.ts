import { Redis } from "@upstash/redis";
import crypto from "crypto";

const FEATURE_FLAG = process.env.UCM_AGENTIC_ROUTES === "1";

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

let redis: Redis | null = null;
if (UPSTASH_URL && UPSTASH_TOKEN) {
  redis = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
}

export const STREAM_EVENTS = "ucm:events";
export const STREAM_ACTIONS = "ucm:actions";
export const STREAM_DEADLETTERS = "ucm:deadletters";

export const GROUP_ORCHESTRATOR = "orchestrator-group";
export const GROUP_WORKER_ROUTES = "worker-routes-group";
export const GROUP_WORKER_NOTIFY = "worker-notify-group";

const STREAM_MAX_LEN = 10000;
const IDEMPOTENCY_TTL = 3600;

export interface BusEvent {
  id?: string;
  type: string;
  payload: Record<string, any>;
  idempotencyKey: string;
  ts: number;
}

function generateEventId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export async function emitEvent(type: string, payload: Record<string, any>, idempotencyKey?: string): Promise<string | null> {
  if (!FEATURE_FLAG || !redis) return null;

  const eventId = generateEventId();
  const idemKey = idempotencyKey || `${type}:${eventId}`;

  try {
    const dedup = await redis.set(`ucm:idem:${idemKey}`, "1", { nx: true, ex: IDEMPOTENCY_TTL });
    if (!dedup) {
      return null;
    }

    const streamId = await redis.xadd(STREAM_EVENTS, "*", {
      id: eventId,
      type,
      payload: JSON.stringify(payload),
      idempotencyKey: idemKey,
      ts: String(Date.now()),
    });

    await redis.xtrim(STREAM_EVENTS, { strategy: "MAXLEN", threshold: STREAM_MAX_LEN, exactness: "~" });

    return streamId as string;
  } catch (err: any) {
    console.warn(JSON.stringify({
      event: "event_bus_emit_error",
      eventType: type,
      error: err.message?.slice(0, 200),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

export async function emitAction(type: string, payload: Record<string, any>, idempotencyKey?: string): Promise<string | null> {
  if (!FEATURE_FLAG || !redis) return null;

  const actionId = generateEventId();
  const idemKey = idempotencyKey || `${type}:${actionId}`;

  try {
    const dedup = await redis.set(`ucm:idem:${idemKey}`, "1", { nx: true, ex: IDEMPOTENCY_TTL });
    if (!dedup) {
      return null;
    }

    const streamId = await redis.xadd(STREAM_ACTIONS, "*", {
      id: actionId,
      type,
      payload: JSON.stringify(payload),
      idempotencyKey: idemKey,
      ts: String(Date.now()),
    });

    await redis.xtrim(STREAM_ACTIONS, { strategy: "MAXLEN", threshold: STREAM_MAX_LEN, exactness: "~" });

    return streamId as string;
  } catch (err: any) {
    console.warn(JSON.stringify({
      event: "event_bus_action_error",
      actionType: type,
      error: err.message?.slice(0, 200),
      ts: new Date().toISOString(),
    }));
    return null;
  }
}

export async function moveToDeadLetter(streamId: string, data: Record<string, any>, error: string): Promise<void> {
  if (!redis) return;

  try {
    await redis.xadd(STREAM_DEADLETTERS, "*", {
      originalStreamId: streamId,
      data: JSON.stringify(data),
      error: error.slice(0, 500),
      ts: String(Date.now()),
    });

    await redis.xtrim(STREAM_DEADLETTERS, { strategy: "MAXLEN", threshold: 5000, exactness: "~" });
  } catch (err: any) {
    console.error(JSON.stringify({
      event: "deadletter_write_error",
      error: err.message?.slice(0, 200),
      ts: new Date().toISOString(),
    }));
  }
}

export async function ensureConsumerGroup(stream: string, group: string): Promise<void> {
  if (!redis) return;

  try {
    await redis.xgroup(stream, {
      type: "CREATE",
      group,
      id: "0",
      options: { MKSTREAM: true },
    });
  } catch (err: any) {
    if (!err.message?.includes("BUSYGROUP")) {
      console.warn(`[EVENT-BUS] Group create error ${group}: ${err.message}`);
    }
  }
}

export interface StreamMessage {
  streamId: string;
  fields: Record<string, string>;
}

export async function readFromGroup(
  stream: string,
  group: string,
  consumer: string,
  count: number = 10,
  blockMs: number = 0,
): Promise<StreamMessage[]> {
  if (!redis) return [];

  try {
    const raw: any = await redis.xreadgroup(group, consumer, stream, ">", { count });

    if (!raw || !Array.isArray(raw) || raw.length === 0) return [];

    const messages: StreamMessage[] = [];
    for (const item of raw) {
      if (!item) continue;
      if (typeof item === "object" && !Array.isArray(item)) {
        const streamId = (item as any).id || (item as any).streamId;
        if (streamId) {
          const fields: Record<string, string> = {};
          for (const [k, v] of Object.entries(item)) {
            if (k !== "id" && k !== "streamId") fields[k] = String(v);
          }
          messages.push({ streamId, fields });
          continue;
        }
      }
      if (Array.isArray(item)) {
        const [streamName, entries] = item;
        if (!entries || !Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (!entry || !Array.isArray(entry)) continue;
          const [id, fieldArr] = entry;
          const fields: Record<string, string> = {};
          if (Array.isArray(fieldArr)) {
            for (let i = 0; i < fieldArr.length; i += 2) {
              fields[fieldArr[i]] = fieldArr[i + 1];
            }
          }
          messages.push({ streamId: id, fields });
        }
      }
    }
    return messages;
  } catch (err: any) {
    if (err.message?.includes("NOGROUP")) {
      await ensureConsumerGroup(stream, group);
      return [];
    }
    console.warn(JSON.stringify({
      event: "event_bus_read_error",
      stream,
      group,
      error: err.message?.slice(0, 200),
      ts: new Date().toISOString(),
    }));
    return [];
  }
}

export async function ackMessage(stream: string, group: string, streamId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.xack(stream, group, streamId);
  } catch (err: any) {
    console.warn(`[EVENT-BUS] ACK error: ${err.message}`);
  }
}

export function isEventBusEnabled(): boolean {
  return FEATURE_FLAG && redis !== null;
}

export function getRedisClient(): Redis | null {
  return redis;
}
