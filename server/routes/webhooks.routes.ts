import { Router, type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { db } from "../db";
import { companyWebhooks } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { WEBHOOK_EVENTS, type WebhookEvent } from "../services/webhookDispatcher";
import { logSystemEvent } from "../lib/systemEvents";
import crypto from "crypto";
import { z } from "zod";

const router = Router();

const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]])).min(1),
});

const updateWebhookSchema = z.object({
  url: z.string().url().max(2048).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]])).min(1).optional(),
  active: z.boolean().optional(),
});

// POST /api/webhooks — Create webhook endpoint
router.post(
  "/api/webhooks",
  authMiddleware,
  requireRole("COMPANY_ADMIN", "ADMIN", "SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });

      const parsed = createWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten().fieldErrors });
      }

      const { url, events } = parsed.data;
      const id = crypto.randomUUID();
      const secret = crypto.randomBytes(32).toString("hex");

      const [webhook] = await db.insert(companyWebhooks).values({
        id,
        companyId,
        url,
        secret,
        events,
        active: true,
      }).returning();

      await logSystemEvent({
        companyId,
        eventType: "webhook_created",
        entityType: "webhook",
        entityId: id,
        payload: { url, events },
        userId: req.user?.userId,
      }).catch(() => {});

      res.status(201).json({
        id: webhook.id,
        url: webhook.url,
        secret: webhook.secret,
        events: webhook.events,
        active: webhook.active,
        createdAt: webhook.createdAt,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// GET /api/webhooks — List company webhooks
router.get(
  "/api/webhooks",
  authMiddleware,
  requireRole("COMPANY_ADMIN", "ADMIN", "SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });

      const webhooks = await db
        .select({
          id: companyWebhooks.id,
          url: companyWebhooks.url,
          events: companyWebhooks.events,
          active: companyWebhooks.active,
          createdAt: companyWebhooks.createdAt,
        })
        .from(companyWebhooks)
        .where(eq(companyWebhooks.companyId, companyId));

      res.json(webhooks);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// PATCH /api/webhooks/:id — Update webhook
router.patch(
  "/api/webhooks/:id",
  authMiddleware,
  requireRole("COMPANY_ADMIN", "ADMIN", "SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });

      const parsed = updateWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten().fieldErrors });
      }

      // Verify ownership
      const [existing] = await db
        .select()
        .from(companyWebhooks)
        .where(and(eq(companyWebhooks.id, req.params.id), eq(companyWebhooks.companyId, companyId)));

      if (!existing) {
        return res.status(404).json({ message: "Webhook not found" });
      }

      const updates: Record<string, unknown> = {};
      if (parsed.data.url !== undefined) updates.url = parsed.data.url;
      if (parsed.data.events !== undefined) updates.events = parsed.data.events;
      if (parsed.data.active !== undefined) updates.active = parsed.data.active;

      const [updated] = await db
        .update(companyWebhooks)
        .set(updates)
        .where(and(eq(companyWebhooks.id, req.params.id), eq(companyWebhooks.companyId, companyId)))
        .returning();

      await logSystemEvent({
        companyId,
        eventType: "webhook_updated",
        entityType: "webhook",
        entityId: req.params.id,
        payload: updates,
        userId: req.user?.userId,
      }).catch(() => {});

      res.json({
        id: updated.id,
        url: updated.url,
        events: updated.events,
        active: updated.active,
        createdAt: updated.createdAt,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// DELETE /api/webhooks/:id — Deactivate webhook
router.delete(
  "/api/webhooks/:id",
  authMiddleware,
  requireRole("COMPANY_ADMIN", "ADMIN", "SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ message: "Company context required" });

      const [existing] = await db
        .select()
        .from(companyWebhooks)
        .where(and(eq(companyWebhooks.id, req.params.id), eq(companyWebhooks.companyId, companyId)));

      if (!existing) {
        return res.status(404).json({ message: "Webhook not found" });
      }

      await db
        .update(companyWebhooks)
        .set({ active: false })
        .where(and(eq(companyWebhooks.id, req.params.id), eq(companyWebhooks.companyId, companyId)));

      await logSystemEvent({
        companyId,
        eventType: "webhook_deactivated",
        entityType: "webhook",
        entityId: req.params.id,
        userId: req.user?.userId,
      }).catch(() => {});

      res.json({ message: "Webhook deactivated" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

export function registerWebhookRoutes(app: import("express").Express) {
  app.use(router);
}
