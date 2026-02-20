import { Router, type Response } from "express";
import express from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  getSubscriptionSettings,
  updateSubscriptionSettings,
  getCompanySubscription,
  getAllSubscriptions,
  createCheckoutSession,
  createPortalSession,
  cancelSubscription,
  handleSubscriptionWebhook,
  checkCompanyAccess,
} from "../services/subscriptionService";

const router = Router();

router.get(
  "/api/admin/subscriptions/settings",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res: Response) => {
    try {
      const settings = await getSubscriptionSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/subscriptions/settings",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { monthlySubscriptionEnabled, monthlySubscriptionPriceId, subscriptionRequiredForAccess, gracePeriodDays } = req.body;
      const updated = await updateSubscriptionSettings({
        monthlySubscriptionEnabled,
        monthlySubscriptionPriceId,
        subscriptionRequiredForAccess,
        gracePeriodDays: gracePeriodDays != null ? Number(gracePeriodDays) : undefined,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/api/admin/subscriptions",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await getAllSubscriptions();
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/api/admin/subscriptions/company/:companyId",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(String(req.params.companyId));
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });
      const sub = await getCompanySubscription(companyId);
      const access = await checkCompanyAccess(companyId);
      res.json({ subscription: sub, access });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/subscriptions/company/:companyId/checkout",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(String(req.params.companyId));
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });

      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const url = await createCheckoutSession(companyId);
      res.json({ url });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/subscriptions/company/:companyId/portal",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(String(req.params.companyId));
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });

      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const url = await createPortalSession(companyId);
      res.json({ url });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/subscriptions/company/:companyId/cancel",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(String(req.params.companyId));
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });
      const result = await cancelSubscription(companyId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  }
);

export function registerSubscriptionRoutes(app: express.Express) {
  app.use(router);
}

export function registerSubscriptionWebhook(app: express.Express) {
  app.post(
    "/api/webhooks/stripe/subscription",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const sig = req.headers["stripe-signature"];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!sig || !webhookSecret) {
        return res.status(400).json({ message: "Missing signature or webhook secret" });
      }

      try {
        const Stripe = require("stripe").default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

        await handleSubscriptionWebhook(event);
        res.json({ received: true });
      } catch (err: any) {
        console.error("[SUBSCRIPTION WEBHOOK] Error:", err.message);
        res.status(400).json({ message: `Webhook error: ${err.message}` });
      }
    }
  );
}
