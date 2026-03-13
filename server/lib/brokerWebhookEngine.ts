/**
 * Broker Webhook Delivery Engine
 *
 * Delivers webhook events to registered broker URLs with HMAC-SHA256 signing,
 * automatic retries with exponential backoff, and failure tracking.
 */
import { createHmac } from "crypto";
import { db } from "../db";
import {
  brokerWebhooks,
  brokerWebhookDeliveries,
} from "@shared/schema";
import { eq, and, lte, sql } from "drizzle-orm";

// Valid webhook events
export const WEBHOOK_EVENTS = [
  "trip.status_changed",
  "trip.completed",
  "trip.cancelled",
  "trip.assigned",
  "claim.submitted",
  "settlement.ready",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MAX_RETRY_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Sign a payload using HMAC-SHA256 for webhook verification.
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Deliver a webhook event to all registered endpoints for a broker.
 */
export async function deliverWebhook(
  brokerId: number,
  event: WebhookEvent,
  payload: Record<string, any>,
): Promise<{ delivered: number; queued: number }> {
  // Find all active webhooks for this broker that subscribe to this event
  const webhooks = await db
    .select()
    .from(brokerWebhooks)
    .where(and(eq(brokerWebhooks.brokerId, brokerId), eq(brokerWebhooks.isActive, true)));

  const matchingWebhooks = webhooks.filter((wh) => wh.events.includes(event));

  if (matchingWebhooks.length === 0) {
    return { delivered: 0, queued: 0 };
  }

  let delivered = 0;
  let queued = 0;

  for (const webhook of matchingWebhooks) {
    // Create delivery record
    const [delivery] = await db
      .insert(brokerWebhookDeliveries)
      .values({
        webhookId: webhook.id,
        event,
        payload,
        status: "pending",
        attempts: 0,
      })
      .returning();

    // Attempt immediate delivery
    const success = await attemptDelivery(webhook, delivery.id, event, payload);
    if (success) {
      delivered++;
    } else {
      queued++;
    }
  }

  return { delivered, queued };
}

/**
 * Attempt to deliver a single webhook payload.
 */
async function attemptDelivery(
  webhook: { id: number; url: string; secret: string; brokerId: number },
  deliveryId: number,
  event: string,
  payload: Record<string, any>,
): Promise<boolean> {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const signature = signPayload(body, webhook.secret);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UCM-Signature": `sha256=${signature}`,
        "X-UCM-Event": event,
        "X-UCM-Delivery": deliveryId.toString(),
        "User-Agent": "UCM-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = await response.text().catch(() => "");
    const isSuccess = response.status >= 200 && response.status < 300;

    await db
      .update(brokerWebhookDeliveries)
      .set({
        attempts: 1,
        responseStatus: response.status,
        responseBody: responseBody.slice(0, 2000),
        deliveredAt: isSuccess ? new Date() : null,
        status: isSuccess ? "delivered" : "pending",
        nextRetryAt: isSuccess
          ? null
          : new Date(Date.now() + calculateBackoff(1)),
      })
      .where(eq(brokerWebhookDeliveries.id, deliveryId));

    if (isSuccess) {
      // Reset failure count and update last delivered
      await db
        .update(brokerWebhooks)
        .set({ failureCount: 0, lastDeliveredAt: new Date() })
        .where(eq(brokerWebhooks.id, webhook.id));
      return true;
    } else {
      await db
        .update(brokerWebhooks)
        .set({ failureCount: sql`${brokerWebhooks.failureCount} + 1` })
        .where(eq(brokerWebhooks.id, webhook.id));
      return false;
    }
  } catch (err: any) {
    // Network error or timeout
    await db
      .update(brokerWebhookDeliveries)
      .set({
        attempts: 1,
        responseBody: `Error: ${err.message}`.slice(0, 2000),
        status: "pending",
        nextRetryAt: new Date(Date.now() + calculateBackoff(1)),
      })
      .where(eq(brokerWebhookDeliveries.id, deliveryId));

    await db
      .update(brokerWebhooks)
      .set({ failureCount: sql`${brokerWebhooks.failureCount} + 1` })
      .where(eq(brokerWebhooks.id, webhook.id));

    return false;
  }
}

/**
 * Calculate exponential backoff delay in milliseconds.
 * Attempts: 1=30s, 2=2min, 3=8min, 4=32min, 5=2hr
 */
function calculateBackoff(attempt: number): number {
  const baseMs = 30_000; // 30 seconds
  return baseMs * Math.pow(4, attempt - 1);
}

/**
 * Background job: Retry failed webhook deliveries.
 * Should be called periodically (e.g., every 30 seconds).
 */
export async function retryFailedWebhooks(): Promise<{ retried: number; failed: number }> {
  const now = new Date();
  let retried = 0;
  let failed = 0;

  // Find deliveries ready for retry
  const pendingDeliveries = await db
    .select()
    .from(brokerWebhookDeliveries)
    .where(
      and(
        eq(brokerWebhookDeliveries.status, "pending"),
        lte(brokerWebhookDeliveries.nextRetryAt, now),
      ),
    )
    .limit(50);

  for (const delivery of pendingDeliveries) {
    if (delivery.attempts >= MAX_RETRY_ATTEMPTS) {
      // Mark as permanently failed
      await db
        .update(brokerWebhookDeliveries)
        .set({ status: "failed" })
        .where(eq(brokerWebhookDeliveries.id, delivery.id));

      // Disable webhook if too many consecutive failures
      const [webhook] = await db
        .select()
        .from(brokerWebhooks)
        .where(eq(brokerWebhooks.id, delivery.webhookId))
        .limit(1);

      if (webhook && webhook.failureCount >= 50) {
        await db
          .update(brokerWebhooks)
          .set({ isActive: false })
          .where(eq(brokerWebhooks.id, webhook.id));
        console.warn(
          `[WebhookEngine] Disabled webhook ${webhook.id} for broker ${webhook.brokerId} after ${webhook.failureCount} failures`,
        );
      }

      failed++;
      continue;
    }

    // Get the webhook config
    const [webhook] = await db
      .select()
      .from(brokerWebhooks)
      .where(eq(brokerWebhooks.id, delivery.webhookId))
      .limit(1);

    if (!webhook || !webhook.isActive) {
      await db
        .update(brokerWebhookDeliveries)
        .set({ status: "failed" })
        .where(eq(brokerWebhookDeliveries.id, delivery.id));
      failed++;
      continue;
    }

    // Attempt redelivery
    const body = JSON.stringify({
      event: delivery.event,
      timestamp: new Date().toISOString(),
      data: delivery.payload,
    });

    const signature = signPayload(body, webhook.secret);
    const nextAttempt = delivery.attempts + 1;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      const response = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-UCM-Signature": `sha256=${signature}`,
          "X-UCM-Event": delivery.event,
          "X-UCM-Delivery": delivery.id.toString(),
          "X-UCM-Retry": nextAttempt.toString(),
          "User-Agent": "UCM-Webhook/1.0",
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseBody = await response.text().catch(() => "");
      const isSuccess = response.status >= 200 && response.status < 300;

      await db
        .update(brokerWebhookDeliveries)
        .set({
          attempts: nextAttempt,
          responseStatus: response.status,
          responseBody: responseBody.slice(0, 2000),
          deliveredAt: isSuccess ? new Date() : null,
          status: isSuccess ? "delivered" : nextAttempt >= MAX_RETRY_ATTEMPTS ? "failed" : "pending",
          nextRetryAt: isSuccess
            ? null
            : nextAttempt >= MAX_RETRY_ATTEMPTS
              ? null
              : new Date(Date.now() + calculateBackoff(nextAttempt)),
        })
        .where(eq(brokerWebhookDeliveries.id, delivery.id));

      if (isSuccess) {
        await db
          .update(brokerWebhooks)
          .set({ failureCount: 0, lastDeliveredAt: new Date() })
          .where(eq(brokerWebhooks.id, webhook.id));
        retried++;
      } else {
        await db
          .update(brokerWebhooks)
          .set({ failureCount: sql`${brokerWebhooks.failureCount} + 1` })
          .where(eq(brokerWebhooks.id, webhook.id));
        if (nextAttempt >= MAX_RETRY_ATTEMPTS) failed++;
      }
    } catch (err: any) {
      await db
        .update(brokerWebhookDeliveries)
        .set({
          attempts: nextAttempt,
          responseBody: `Error: ${err.message}`.slice(0, 2000),
          status: nextAttempt >= MAX_RETRY_ATTEMPTS ? "failed" : "pending",
          nextRetryAt:
            nextAttempt >= MAX_RETRY_ATTEMPTS
              ? null
              : new Date(Date.now() + calculateBackoff(nextAttempt)),
        })
        .where(eq(brokerWebhookDeliveries.id, delivery.id));

      await db
        .update(brokerWebhooks)
        .set({ failureCount: sql`${brokerWebhooks.failureCount} + 1` })
        .where(eq(brokerWebhooks.id, webhook.id));

      if (nextAttempt >= MAX_RETRY_ATTEMPTS) failed++;
    }
  }

  return { retried, failed };
}

/**
 * Background scheduler: Retry failed webhook deliveries every 30 seconds.
 */
let webhookRetryInterval: ReturnType<typeof setInterval> | null = null;

export function startWebhookRetryScheduler(): void {
  if (webhookRetryInterval) return;
  webhookRetryInterval = setInterval(async () => {
    try {
      const result = await retryFailedWebhooks();
      if (result.retried > 0 || result.failed > 0) {
        console.log(
          `[WebhookRetry] retried=${result.retried} failed=${result.failed}`,
        );
      }
    } catch (err: any) {
      console.warn(`[WebhookRetry] Error: ${err.message}`);
    }
  }, 30_000);
}

export function stopWebhookRetryScheduler(): void {
  if (webhookRetryInterval) {
    clearInterval(webhookRetryInterval);
    webhookRetryInterval = null;
  }
}

/**
 * Send a test webhook delivery to verify endpoint connectivity.
 */
export async function sendTestWebhook(
  webhookId: number,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const [webhook] = await db
    .select()
    .from(brokerWebhooks)
    .where(eq(brokerWebhooks.id, webhookId))
    .limit(1);

  if (!webhook) {
    return { success: false, error: "Webhook not found" };
  }

  const testPayload = {
    event: "test",
    timestamp: new Date().toISOString(),
    data: {
      message: "This is a test webhook delivery from UCM",
      webhookId: webhook.id,
      brokerId: webhook.brokerId,
    },
  };

  const body = JSON.stringify(testPayload);
  const signature = signPayload(body, webhook.secret);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-UCM-Signature": `sha256=${signature}`,
        "X-UCM-Event": "test",
        "X-UCM-Delivery": "test",
        "User-Agent": "UCM-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    return {
      success: response.status >= 200 && response.status < 300,
      statusCode: response.status,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
