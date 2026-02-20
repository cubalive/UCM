import { Router, type Response } from "express";
import express from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  getCompanySubSettings,
  upsertCompanySubSettings,
  getCompanySubscription,
  getAllSubscriptions,
  createSubscription,
  createPortalSession,
  cancelSubscriptionAtPeriodEnd,
  reactivateSubscription,
  handleSubscriptionWebhook,
  checkCompanyAccess,
  getStripeSubscriptionCheck,
} from "../services/subscriptionService";

const router = Router();

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
      const settings = await getCompanySubSettings(companyId);
      const access = await checkCompanyAccess(companyId);
      res.json({ subscription: sub, settings, access });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/subscriptions/company/:companyId/settings",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(String(req.params.companyId));
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });
      const { subscriptionEnabled, subscriptionRequiredForAccess } = req.body;
      const result = await upsertCompanySubSettings(companyId, {
        subscriptionEnabled,
        subscriptionRequiredForAccess,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/subscriptions/company/:companyId/start",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(String(req.params.companyId));
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });

      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(500).json({ message: "Stripe is not configured" });
      }

      const url = await createSubscription(companyId);
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
      const result = await cancelSubscriptionAtPeriodEnd(companyId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/subscriptions/company/:companyId/reactivate",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(String(req.params.companyId));
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });
      const result = await reactivateSubscription(companyId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  }
);

router.get(
  "/api/system/stripe-subscription-check",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(String(req.query.companyId));
      if (isNaN(companyId)) return res.status(400).json({ message: "companyId query param required" });
      const result = await getStripeSubscriptionCheck(companyId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

export function registerSubscriptionRoutes(app: express.Express) {
  app.use(router);
}

export function registerSubscriptionWebhook(app: express.Express) {
  const webhookHandler = async (req: any, res: any) => {
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
  };

  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    webhookHandler
  );

  app.post(
    "/api/webhooks/stripe/subscription",
    express.raw({ type: "application/json" }),
    webhookHandler
  );
}
