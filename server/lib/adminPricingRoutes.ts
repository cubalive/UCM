import type { Express } from "express";
import { z } from "zod";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { db } from "../db";
import { clinicMemberships, clinics } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import {
  getPricingSettings,
  updatePricingSettings,
  resolveDiscountPercent,
} from "./pricingSettings";

export function registerAdminPricingRoutes(app: Express) {
  app.get("/api/admin/settings/pricing", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const settings = await getPricingSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/settings/pricing", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        platform_tariffs_enabled: z.boolean().optional(),
        default_discount_percent: z.number().min(0).max(100).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
      }

      const updated = await updatePricingSettings(parsed.data);

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "UPDATE_PRICING_SETTINGS",
        entity: "app_settings",
        entityId: 0,
        details: `Updated pricing settings: ${JSON.stringify(parsed.data)}`,
        cityId: null,
      });

      console.log(JSON.stringify({
        event: "pricing_settings_updated",
        updatedBy: req.user!.userId,
        platform_tariffs_enabled: updated.platform_tariffs_enabled,
        default_discount_percent: updated.default_discount_percent,
      }));

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/discount/resolve", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinicId ? parseInt(req.query.clinicId as string) : null;
      const result = await resolveDiscountPercent(clinicId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/clinics/:clinicId/discount", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(req.params.clinicId as string);
      const [clinic] = await db.select({ discountPercent: clinics.discountPercent }).from(clinics).where(eq(clinics.id, clinicId));
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });
      const resolved = await resolveDiscountPercent(clinicId);
      res.json({ clinicDiscountPercent: clinic.discountPercent, resolved });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/clinics/:clinicId/discount", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(req.params.clinicId as string);
      const schema = z.object({ discount_percent: z.number().min(0).max(100).nullable() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data" });

      const discountVal = parsed.data.discount_percent !== null
        ? String(parsed.data.discount_percent) : null;

      await db.update(clinics)
        .set({ discountPercent: discountVal })
        .where(eq(clinics.id, clinicId));

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "UPDATE_CLINIC_DISCOUNT",
        entity: "clinics",
        entityId: clinicId,
        details: `Set discount_percent to ${parsed.data.discount_percent}`,
        cityId: null,
      });

      res.json({ success: true, discount_percent: parsed.data.discount_percent });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/memberships", authMiddleware, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res) => {
    try {
      const memberships = await db.select().from(clinicMemberships);
      res.json(memberships);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/clinics/:clinicId/membership", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(req.params.clinicId as string);
      const [membership] = await db.select().from(clinicMemberships).where(eq(clinicMemberships.clinicId, clinicId));
      res.json(membership || null);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/clinics/:clinicId/membership", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(req.params.clinicId as string);
      const schema = z.object({
        plan_code: z.enum(["basic", "pro", "enterprise"]),
        status: z.enum(["inactive", "trialing", "active", "past_due", "canceled"]).default("inactive"),
        included_discount_percent: z.number().min(0).max(100).default(0),
        monthly_fee_cents: z.number().int().min(0).default(0),
        stripe_customer_id: z.string().optional(),
        stripe_subscription_id: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });

      const [clinic] = await db.select({ id: clinics.id, companyId: clinics.companyId }).from(clinics).where(eq(clinics.id, clinicId));
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });

      const existing = await db.select().from(clinicMemberships).where(eq(clinicMemberships.clinicId, clinicId));
      let result;
      if (existing.length > 0) {
        [result] = await db.update(clinicMemberships)
          .set({
            planCode: parsed.data.plan_code,
            status: parsed.data.status,
            includedDiscountPercent: String(parsed.data.included_discount_percent),
            monthlyFeeCents: parsed.data.monthly_fee_cents,
            stripeCustomerId: parsed.data.stripe_customer_id || existing[0].stripeCustomerId,
            stripeSubscriptionId: parsed.data.stripe_subscription_id || existing[0].stripeSubscriptionId,
            updatedAt: new Date(),
          })
          .where(eq(clinicMemberships.clinicId, clinicId))
          .returning();
      } else {
        [result] = await db.insert(clinicMemberships)
          .values({
            clinicId,
            companyId: clinic.companyId,
            planCode: parsed.data.plan_code,
            status: parsed.data.status,
            includedDiscountPercent: String(parsed.data.included_discount_percent),
            monthlyFeeCents: parsed.data.monthly_fee_cents,
            stripeCustomerId: parsed.data.stripe_customer_id || null,
            stripeSubscriptionId: parsed.data.stripe_subscription_id || null,
          })
          .returning();
      }

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: existing.length > 0 ? "UPDATE_MEMBERSHIP" : "CREATE_MEMBERSHIP",
        entity: "clinic_memberships",
        entityId: result.id,
        details: `${existing.length > 0 ? "Updated" : "Created"} membership for clinic ${clinicId}: plan=${parsed.data.plan_code}, status=${parsed.data.status}`,
        cityId: null,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/clinics/:clinicId/membership/checkout", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(req.params.clinicId as string);
      const schema = z.object({
        price_id: z.string(),
        success_url: z.string().url(),
        cancel_url: z.string().url(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data" });

      const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId));
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });

      const stripe = (await import("stripe")).default;
      const stripeClient = new stripe(process.env.STRIPE_SECRET_KEY || "");

      let customerId: string | undefined;
      const [membership] = await db.select().from(clinicMemberships).where(eq(clinicMemberships.clinicId, clinicId));
      if (membership?.stripeCustomerId) {
        customerId = membership.stripeCustomerId;
      }

      const session = await stripeClient.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        customer_email: customerId ? undefined : (clinic.email || undefined),
        line_items: [{ price: parsed.data.price_id, quantity: 1 }],
        success_url: parsed.data.success_url,
        cancel_url: parsed.data.cancel_url,
        metadata: { clinic_id: String(clinicId), company_id: String(clinic.companyId || "") },
      });

      res.json({ checkoutUrl: session.url, sessionId: session.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
