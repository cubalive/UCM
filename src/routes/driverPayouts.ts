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

// Check payout status (driver or admin)
router.get(
  "/status/:stripeAccountId",
  async (req: Request, res: Response) => {
    try {
      const status = await getDriverPayoutStatus(req.params.stripeAccountId as string);
      res.json(status);
    } catch (err: any) {
      logger.error("Failed to get payout status", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// Get driver's Stripe Express dashboard link
router.get(
  "/dashboard/:stripeAccountId",
  async (req: Request, res: Response) => {
    try {
      const url = await getDriverDashboardLink(req.params.stripeAccountId as string);
      res.json({ url });
    } catch (err: any) {
      logger.error("Failed to get dashboard link", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
