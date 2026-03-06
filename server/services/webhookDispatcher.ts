import crypto from "crypto";
import { db } from "../db";
import { companyWebhooks } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { setJson, getJson, del, isRedisConnected } from "../lib/redis";
import { logSystemEvent } from "../lib/systemEvents";

// ---------------------------------------------------------------------------
// Supported webhook events
// ---------------------------------------------------------------------------

export const WEBHOOK_EVENTS = [
  "trip.created",
  "trip.assigned",
  "trip.started",
  "trip.completed",
  "trip.cancelled",
  "driver.location_updated",
  "invoice.created",
  "invoice.paid",
  "subscription.updated",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// ---------------------------------------------------------------------------
// HMAC signature generation
// ---------------------------------------------------------------------------

export function generateWebhookSignature(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// ---------------------------------------------------------------------------
// In-memory queue (with Redis persistence when available)
// ---------------------------------------------------------------------------

const QUEUE_KEY = "webhook-delivery";
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const DELIVERY_TIMEOUT_MS = 5000;

export interface WebhookJob {
  id: string;
  webhookId: string;
  companyId: number;
  eventName: WebhookEvent;
  payload: Record<string, unknown>;
  attempt: number;
  createdAt: string;
  deliverAfter?: number; // epoch ms for delayed retry
}

// In-memory queue as primary mechanism (Redis used for persistence/cross-process)
const jobQueue: WebhookJob[] = [];
const delayedQueue: WebhookJob[] = [];

export function getQueueLength(): number {
  return jobQueue.length;
}

export function getDelayedQueueLength(): number {
  return delayedQueue.length;
}

export async function enqueueWebhookJob(job: Omit<WebhookJob, "id" | "attempt" | "createdAt">): Promise<string> {
  const fullJob: WebhookJob = {
    ...job,
    id: crypto.randomUUID(),
    attempt: 0,
    createdAt: new Date().toISOString(),
  };

  jobQueue.push(fullJob);

  // Persist queue snapshot to Redis for observability
  if (isRedisConnected()) {
    await setJson(`${QUEUE_KEY}:pending:${fullJob.id}`, fullJob, 3600).catch(() => {});
  }

  console.log(JSON.stringify({
    event: "webhook_job_enqueued",
    jobId: fullJob.id,
    webhookId: job.webhookId,
    eventName: job.eventName,
    companyId: job.companyId,
    ts: new Date().toISOString(),
  }));

  return fullJob.id;
}

// ---------------------------------------------------------------------------
// Dispatch: find matching webhooks and enqueue jobs
// ---------------------------------------------------------------------------

export async function dispatchWebhookEvent(
  companyId: number,
  eventName: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const webhooks = await db
      .select()
      .from(companyWebhooks)
      .where(and(eq(companyWebhooks.companyId, companyId), eq(companyWebhooks.active, true)));

    const matching = webhooks.filter((w) => w.events.includes(eventName));

    for (const webhook of matching) {
      await enqueueWebhookJob({
        webhookId: webhook.id,
        companyId,
        eventName,
        payload,
      });
    }
  } catch (err: any) {
    console.error(JSON.stringify({
      event: "webhook_dispatch_error",
      companyId,
      eventName,
      error: err.message,
      ts: new Date().toISOString(),
    }));
  }
}

// ---------------------------------------------------------------------------
// Delivery: deliver a single webhook
// ---------------------------------------------------------------------------

export async function deliverWebhook(job: WebhookJob): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const webhook = await db
    .select()
    .from(companyWebhooks)
    .where(eq(companyWebhooks.id, job.webhookId))
    .then((rows) => rows[0]);

  if (!webhook || !webhook.active) {
    return { success: false, error: "webhook_not_found_or_inactive" };
  }

  const body = JSON.stringify({
    event: job.eventName,
    timestamp: new Date().toISOString(),
    data: job.payload,
  });

  const signature = generateWebhookSignature(body, webhook.secret);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UCM-Signature": signature,
        "X-UCM-Event": job.eventName,
        "X-UCM-Delivery": job.id,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    console.log(JSON.stringify({
      event: "webhook_delivered",
      jobId: job.id,
      webhookId: job.webhookId,
      eventName: job.eventName,
      statusCode: response.status,
      attempt: job.attempt,
      ts: new Date().toISOString(),
    }));

    return { success: response.ok, statusCode: response.status };
  } catch (err: any) {
    clearTimeout(timeout);

    console.error(JSON.stringify({
      event: "webhook_delivery_failed",
      jobId: job.id,
      webhookId: job.webhookId,
      eventName: job.eventName,
      attempt: job.attempt,
      error: err.name === "AbortError" ? "timeout" : err.message,
      ts: new Date().toISOString(),
    }));

    return { success: false, error: err.name === "AbortError" ? "timeout" : err.message };
  }
}

// ---------------------------------------------------------------------------
// Worker: process webhook delivery queue
// ---------------------------------------------------------------------------

export async function processWebhookQueue(): Promise<number> {
  // Promote delayed jobs that are ready
  const now = Date.now();
  const ready = delayedQueue.filter((j) => !j.deliverAfter || j.deliverAfter <= now);
  for (const job of ready) {
    const idx = delayedQueue.indexOf(job);
    if (idx >= 0) delayedQueue.splice(idx, 1);
    jobQueue.push(job);
  }

  const job = jobQueue.shift();
  if (!job) return 0;

  job.attempt += 1;
  const result = await deliverWebhook(job);

  // Clean up Redis tracking
  if (isRedisConnected()) {
    await del(`${QUEUE_KEY}:pending:${job.id}`).catch(() => {});
  }

  if (!result.success && job.attempt < MAX_RETRIES) {
    const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, job.attempt - 1);
    job.deliverAfter = Date.now() + backoffMs;
    delayedQueue.push(job);

    await logSystemEvent({
      companyId: job.companyId,
      eventType: "webhook_retry_scheduled",
      entityType: "webhook",
      entityId: job.webhookId,
      payload: { jobId: job.id, attempt: job.attempt, backoffMs, error: result.error },
    }).catch(() => {});
  } else if (!result.success) {
    await logSystemEvent({
      companyId: job.companyId,
      eventType: "webhook_delivery_exhausted",
      entityType: "webhook",
      entityId: job.webhookId,
      payload: { jobId: job.id, attempts: job.attempt, lastError: result.error },
    }).catch(() => {});
  }

  return 1;
}

// For testing: clear queues
export function _clearQueues(): void {
  jobQueue.length = 0;
  delayedQueue.length = 0;
}

// For testing: get queues
export function _getQueues(): { jobQueue: WebhookJob[]; delayedQueue: WebhookJob[] } {
  return { jobQueue, delayedQueue };
}
