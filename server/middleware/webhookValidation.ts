/**
 * S9 FIX: Webhook replay attack prevention middleware.
 * Validates timestamp, HMAC signature, and nonce for incoming webhooks.
 */
import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { setWithTtl, getString } from "../lib/redis";

const MAX_TIMESTAMP_DRIFT_SECONDS = 300; // 5 minutes
const NONCE_TTL_SECONDS = 600; // 10 minutes (2x drift to ensure coverage)

export interface WebhookValidationOptions {
  /** Function to retrieve the shared secret for a given request */
  getSecret: (req: Request) => Promise<string | null>;
  /** Header name for timestamp (default: X-Webhook-Timestamp) */
  timestampHeader?: string;
  /** Header name for signature (default: X-Webhook-Signature) */
  signatureHeader?: string;
  /** Header name for nonce (default: X-Webhook-Nonce) */
  nonceHeader?: string;
}

/**
 * Middleware that validates webhook requests for replay protection.
 * Requires: X-Webhook-Timestamp, X-Webhook-Signature, X-Webhook-Nonce headers.
 *
 * Signature: HMAC-SHA256(timestamp + "." + nonce + "." + rawBody)
 */
export function validateWebhook(options: WebhookValidationOptions) {
  const {
    getSecret,
    timestampHeader = "x-webhook-timestamp",
    signatureHeader = "x-webhook-signature",
    nonceHeader = "x-webhook-nonce",
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const timestamp = req.headers[timestampHeader] as string;
    const signature = req.headers[signatureHeader] as string;
    const nonce = req.headers[nonceHeader] as string;

    // All three headers are required
    if (!timestamp || !signature || !nonce) {
      return res.status(401).json({
        error: "Missing required webhook headers",
      });
    }

    // Validate timestamp is within acceptable drift
    const requestTime = parseInt(timestamp, 10);
    if (isNaN(requestTime)) {
      return res.status(401).json({ error: "Invalid timestamp" });
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - requestTime) > MAX_TIMESTAMP_DRIFT_SECONDS) {
      return res.status(401).json({
        error: "Request timestamp too old or too far in the future",
      });
    }

    // Check nonce for replay — fail open if Redis is unavailable
    try {
      const nonceKey = `webhook_nonce:${nonce}`;
      const existing = await getString(nonceKey);
      if (existing) {
        return res.status(401).json({ error: "Duplicate nonce — possible replay attack" });
      }
      // Store nonce with TTL to prevent replay
      await setWithTtl(nonceKey, "1", NONCE_TTL_SECONDS);
    } catch (redisErr: any) {
      // Fail open — log warning but continue (don't block webhook if Redis is down)
      console.warn("[WebhookValidation] Redis unavailable for nonce check:", redisErr.message);
    }

    // Get the shared secret
    const secret = await getSecret(req);
    if (!secret) {
      return res.status(401).json({ error: "Unknown webhook source" });
    }

    // Reconstruct and verify HMAC-SHA256 signature
    // Format: HMAC-SHA256(timestamp + "." + nonce + "." + rawBody)
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const payload = `${timestamp}.${nonce}.${rawBody}`;
    const expectedSignature = createHmac("sha256", secret).update(payload).digest("hex");

    // Use timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    next();
  };
}
