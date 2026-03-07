import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { validateBody } from "../middleware/validation.js";
import { paymentRateLimiter } from "../middleware/rateLimiter.js";
import {
  createDriverStripeAccount,
  getDriverOnboardingLink,
  getDriverPayoutStatus,
  getDriverDashboardLink,
} from "../services/driverPayoutService.js";
import {
  getDriverBalance,
  getDriverEarningsHistory,
  requestPayout,
} from "../services/driverEarningsService.js";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, tenantIsolation);

const createAccountSchema = z.object({
  driverId: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

// Create Stripe Express account for a driver (admin/dispatch only)
router.post(
  "/create-account",
  paymentRateLimiter,
  authorize("admin", "dispatcher"),
  validateBody(createAccountSchema),
  async (req: Request, res: Response) => {
    try {
      const result = await createDriverStripeAccount(
        req.body.driverId,
        req.tenantId!,
        req.body.email,
        req.body.firstName,
        req.body.lastName
      );
      res.status(201).json(result);
    } catch (err: any) {
      logger.error("Failed to create driver Stripe account", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  }
);

// Get onboarding link (driver or admin can request)
router.post(
  "/onboarding-link",
  paymentRateLimiter,
  validateBody(z.object({ stripeAccountId: z.string() })),
  async (req: Request, res: Response) => {
    try {
      const url = await getDriverOnboardingLink(req.body.stripeAccountId);
      res.json({ url });
    } catch (err: any) {
      logger.error("Failed to create onboarding link", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// Check payout status (driver or admin) — validates account belongs to tenant
router.get(
  "/status/:stripeAccountId",
  async (req: Request, res: Response) => {
    try {
      const { getDb } = await import("../db/index.js");
      const { users } = await import("../db/schema.js");
      const { eq, and } = await import("drizzle-orm");
      const db = getDb();
      const [owner] = await db.select({ id: users.id }).from(users).where(
        and(eq(users.stripeAccountId, req.params.stripeAccountId as string), eq(users.tenantId, req.tenantId!))
      );
      if (!owner) {
        res.status(404).json({ error: "Stripe account not found for this tenant" });
        return;
      }
      const status = await getDriverPayoutStatus(req.params.stripeAccountId as string);
      res.json(status);
    } catch (err: any) {
      logger.error("Failed to get payout status", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// Get driver's Stripe Express dashboard link — validates account belongs to tenant
router.get(
  "/dashboard/:stripeAccountId",
  async (req: Request, res: Response) => {
    try {
      const { getDb } = await import("../db/index.js");
      const { users } = await import("../db/schema.js");
      const { eq, and } = await import("drizzle-orm");
      const db = getDb();
      const [owner] = await db.select({ id: users.id }).from(users).where(
        and(eq(users.stripeAccountId, req.params.stripeAccountId as string), eq(users.tenantId, req.tenantId!))
      );
      if (!owner) {
        res.status(404).json({ error: "Stripe account not found for this tenant" });
        return;
      }
      const url = await getDriverDashboardLink(req.params.stripeAccountId as string);
      res.json({ url });
    } catch (err: any) {
      logger.error("Failed to get dashboard link", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /driver/earnings — driver's balance and earnings history
router.get(
  "/earnings",
  authorize("driver"),
  async (req: Request, res: Response) => {
    try {
      const [balance, history] = await Promise.all([
        getDriverBalance(req.user!.id, req.tenantId!),
        getDriverEarningsHistory(req.user!.id, req.tenantId!),
      ]);
      res.json({ ...balance, history });
    } catch (err: any) {
      logger.error("Failed to get driver earnings", { error: err.message });
      res.status(500).json({ error: "Failed to get earnings" });
    }
  }
);

// POST /driver/payout — request payout
router.post(
  "/payout",
  paymentRateLimiter,
  authorize("driver"),
  async (req: Request, res: Response) => {
    try {
      const result = await requestPayout(req.user!.id, req.tenantId!);
      res.json(result);
    } catch (err: any) {
      logger.error("Driver payout failed", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

export default router;
