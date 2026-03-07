import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { validateBody } from "../middleware/validation.js";
import { stripeConnectRateLimiter } from "../middleware/rateLimiter.js";
import { createConnectAccount, createOnboardingLink, getConnectAccountStatus } from "../services/stripeConnectService.js";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, authorize("admin"), tenantIsolation);

const createAccountSchema = z.object({
  email: z.string().email(),
});

const onboardingLinkSchema = z.object({
  returnUrl: z.string().url(),
  refreshUrl: z.string().url(),
});

// Create Stripe Connect account
router.post(
  "/create-account",
  stripeConnectRateLimiter,
  validateBody(createAccountSchema),
  async (req: Request, res: Response) => {
    try {
      const account = await createConnectAccount(req.tenantId!, req.body.email);
      res.status(201).json({ accountId: account.id });
    } catch (err: any) {
      logger.error("Failed to create Stripe account", { error: err.message });
      res.status(500).json({ error: "Failed to create Stripe account" });
    }
  }
);

// Create onboarding link
router.post(
  "/onboarding-link",
  stripeConnectRateLimiter,
  validateBody(onboardingLinkSchema),
  async (req: Request, res: Response) => {
    try {
      const link = await createOnboardingLink(req.tenantId!, req.body.returnUrl, req.body.refreshUrl);
      res.json({ url: link.url, expiresAt: link.expires_at });
    } catch (err: any) {
      logger.error("Failed to create onboarding link", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// Get account status
router.get("/status", stripeConnectRateLimiter, async (req: Request, res: Response) => {
  try {
    const status = await getConnectAccountStatus(req.tenantId!);
    if (!status) {
      res.status(404).json({ error: "No Stripe account found" });
      return;
    }
    res.json(status);
  } catch (err: any) {
    logger.error("Failed to get Stripe account status", { error: err.message });
    res.status(500).json({ error: "Failed to get account status" });
  }
});

export default router;
