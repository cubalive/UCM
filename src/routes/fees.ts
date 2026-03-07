import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { validateBody, validateParams, uuidParam } from "../middleware/validation.js";
import { billingRateLimiter } from "../middleware/rateLimiter.js";
import { validateFeeRule, invalidateFeeCache } from "../services/feeService.js";
import { getDb } from "../db/index.js";
import { feeRules } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, tenantIsolation);

const createFeeRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  type: z.enum(["flat", "per_mile", "per_trip", "surcharge", "percentage"]),
  amount: z.number().min(0),
  currency: z.string().length(3).default("usd"),
  conditions: z.record(z.unknown()).optional(),
  priority: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  effectiveFrom: z.coerce.date().optional(),
  effectiveTo: z.coerce.date().optional(),
});

const updateFeeRuleSchema = createFeeRuleSchema.partial();

// List fee rules
router.get("/", billingRateLimiter, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const results = await db
      .select()
      .from(feeRules)
      .where(eq(feeRules.tenantId, req.tenantId!))
      .orderBy(feeRules.priority);

    res.json({ data: results });
  } catch (err: any) {
    logger.error("Failed to list fee rules", { error: err.message });
    res.status(500).json({ error: "Failed to list fee rules" });
  }
});

// Create fee rule
router.post(
  "/",
  billingRateLimiter,
  authorize("admin", "billing"),
  validateBody(createFeeRuleSchema),
  async (req: Request, res: Response) => {
    try {
      const errors = validateFeeRule(req.body);
      if (errors.length > 0) {
        res.status(400).json({ error: "Invalid fee rule", details: errors });
        return;
      }

      const db = getDb();
      const [rule] = await db
        .insert(feeRules)
        .values({
          tenantId: req.tenantId!,
          ...req.body,
          amount: req.body.amount.toString(),
        })
        .returning();

      await invalidateFeeCache(req.tenantId!);
      res.status(201).json(rule);
    } catch (err: any) {
      logger.error("Failed to create fee rule", { error: err.message });
      res.status(500).json({ error: "Failed to create fee rule" });
    }
  }
);

// Update fee rule
router.put(
  "/:id",
  billingRateLimiter,
  authorize("admin", "billing"),
  validateParams(uuidParam),
  validateBody(updateFeeRuleSchema),
  async (req: Request, res: Response) => {
    try {
      if (req.body.type && req.body.amount !== undefined) {
        const errors = validateFeeRule({ type: req.body.type, amount: req.body.amount, conditions: req.body.conditions });
        if (errors.length > 0) {
          res.status(400).json({ error: "Invalid fee rule", details: errors });
          return;
        }
      }

      const db = getDb();
      const updateData: Record<string, unknown> = { ...req.body, updatedAt: new Date() };
      if (updateData.amount != null) {
        updateData.amount = String(updateData.amount);
      }

      const [updated] = await db
        .update(feeRules)
        .set(updateData)
        .where(and(eq(feeRules.id, req.params.id as string), eq(feeRules.tenantId, req.tenantId!)))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Fee rule not found" });
        return;
      }

      await invalidateFeeCache(req.tenantId!);
      res.json(updated);
    } catch (err: any) {
      logger.error("Failed to update fee rule", { error: err.message });
      res.status(500).json({ error: "Failed to update fee rule" });
    }
  }
);

// Delete fee rule (soft delete — set inactive)
router.delete(
  "/:id",
  billingRateLimiter,
  authorize("admin", "billing"),
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const [updated] = await db
        .update(feeRules)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(feeRules.id, req.params.id as string), eq(feeRules.tenantId, req.tenantId!)))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Fee rule not found" });
        return;
      }

      await invalidateFeeCache(req.tenantId!);
      res.json({ deleted: true });
    } catch (err: any) {
      logger.error("Failed to delete fee rule", { error: err.message });
      res.status(500).json({ error: "Failed to delete fee rule" });
    }
  }
);

export default router;
