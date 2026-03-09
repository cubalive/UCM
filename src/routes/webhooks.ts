import { Router, Request, Response } from "express";
import { verifyAndStoreWebhook, processWebhookEvent, replayWebhookEvent, getWebhookDashboardData } from "../services/webhookService.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { webhookRateLimiter } from "../middleware/rateLimiter.js";
import { validateParams, uuidParam } from "../middleware/validation.js";
import logger from "../lib/logger.js";

const router = Router();

// Stripe webhook endpoint — raw body required, no auth (verified via signature)
router.post(
  "/stripe",
  webhookRateLimiter,
  async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"] as string;
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    try {
      const rawBody = (req as any).rawBody as Buffer;
      if (!rawBody) {
        res.status(400).json({ error: "Raw body not available" });
        return;
      }

      const { event, isNew } = await verifyAndStoreWebhook(rawBody, signature);

      if (!isNew) {
        // Idempotent: duplicate event, acknowledge without reprocessing
        res.json({ received: true, duplicate: true });
        return;
      }

      // Process async — respond quickly to Stripe
      processWebhookEvent(event).catch((err) => {
        logger.error("Async webhook processing failed", { eventId: event.id, error: err.message });
      });

      res.json({ received: true });
    } catch (err: any) {
      logger.error("Webhook verification failed", { error: err.message });
      res.status(400).json({ error: "Webhook verification failed" });
    }
  }
);

// Webhook dashboard — admin only
router.get(
  "/dashboard",
  authenticate,
  authorize("admin"),
  async (_req: Request, res: Response) => {
    try {
      const data = await getWebhookDashboardData();
      res.json(data);
    } catch (err: any) {
      logger.error("Failed to get webhook dashboard", { error: err.message });
      res.status(500).json({ error: "Failed to load webhook dashboard" });
    }
  }
);

// Replay a failed/dead-letter webhook event — admin only
router.post(
  "/:id/replay",
  authenticate,
  authorize("admin"),
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      await replayWebhookEvent(req.params.id as string);
      res.json({ replayed: true });
    } catch (err: any) {
      logger.error("Failed to replay webhook", { error: err.message, webhookId: req.params.id as string });
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

export default router;
